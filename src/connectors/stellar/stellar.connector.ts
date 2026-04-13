import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  Keypair,
  TransactionBuilder,
  Account,
  Contract,
  xdr,
  nativeToScVal,
  Address,
  Operation,
  Asset,
  rpc,
} from '@stellar/stellar-sdk';
import {
  type ChainConnector,
  type DerivedKeys,
  type ChainStealthKeys,
  type SendPaymentParams,
  type WithdrawParams,
  type DetectedPayment,
  type ChainBalance,
  type ResolvedName,
  type TxResult,
  type WithdrawAllResult,
} from '../chain-connector.interface';
import {
  deriveStealthKeys,
  generateStealthAddress,
  scanAnnouncements,
  signStellarTransaction,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  bytesToHex,
  hexToBytes,
  SCHEME_ID,
  type StealthKeys,
  type Announcement,
} from './stellar-crypto';

export interface StellarChainConfig {
  chain: string;
  networkPassphrase: string;
  horizonUrl: string;
  sorobanUrl: string;
  announcerContractId: string;
  namesContractId: string;
  friendbotUrl: string;
  explorerUrl: string;
}

export class StellarConnector implements ChainConnector {
  readonly chain: string;
  private readonly logger: Logger;
  private readonly config: StellarChainConfig;

  constructor(config: StellarChainConfig) {
    this.chain = config.chain;
    this.config = config;
    this.logger = new Logger(`StellarConnector[${config.chain}]`);
  }

  async deriveKeys(seed: Uint8Array): Promise<DerivedKeys> {
    const keypair = Keypair.fromRawEd25519Seed(Buffer.from(seed));
    const rawSecret = keypair.rawSecretKey();

    const syntheticSig = new Uint8Array(64);
    syntheticSig.set(
      createHash('sha256')
        .update(Buffer.from([...rawSecret, 0x01]))
        .digest(),
      0,
    );
    syntheticSig.set(
      createHash('sha256')
        .update(Buffer.from([...rawSecret, 0x02]))
        .digest(),
      32,
    );

    const stealthKeys = deriveStealthKeys(syntheticSig);
    const metaAddress = encodeStealthMetaAddress(
      stealthKeys.spendingPubKey,
      stealthKeys.viewingPubKey,
    );

    return {
      address: keypair.publicKey(),
      metaAddress,
      stealthKeys: {
        spendingKey: stealthKeys.spendingKey,
        viewingKey: stealthKeys.viewingKey,
        spendingPubKey: stealthKeys.spendingPubKey,
        viewingPubKey: stealthKeys.viewingPubKey,
        spendingScalar: stealthKeys.spendingScalar,
        viewingScalar: stealthKeys.viewingScalar,
      },
    };
  }

  async sendPayment(params: SendPaymentParams): Promise<TxResult> {
    const { senderKeys, senderAddress, recipientMetaAddress, amount, asset = 'XLM' } = params;

    let metaAddress: string;
    if (recipientMetaAddress.startsWith('st:xlm:')) {
      metaAddress = recipientMetaAddress;
    } else {
      const cleanName = recipientMetaAddress.replace(/\.wraith$/, '');
      const resolved = await this.resolveName(cleanName);
      if (!resolved) throw new Error(`Could not resolve name "${cleanName}.wraith"`);
      metaAddress = resolved.metaAddress;
    }

    const decoded = decodeStealthMetaAddress(metaAddress);
    const stealth = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
    const exists = await this.accountExists(stealth.stealthAddress);
    const stellarAsset = asset === 'USDC' ? new Asset('USDC', '') : Asset.native();

    const keypair = Keypair.fromPublicKey(senderAddress);
    const sourceAccount = await this.loadAccount(senderAddress);

    let tx;
    if (exists) {
      tx = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: this.config.networkPassphrase,
      })
        .addOperation(
          Operation.payment({ destination: stealth.stealthAddress, asset: stellarAsset, amount }),
        )
        .setTimeout(30)
        .build();
    } else {
      tx = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: this.config.networkPassphrase,
      })
        .addOperation(
          Operation.createAccount({
            destination: stealth.stealthAddress,
            startingBalance: amount,
          }),
        )
        .setTimeout(30)
        .build();
    }

    const txHash = await this.submitClassicTx(tx, keypair);

    try {
      const freshAccount = await this.loadAccount(senderAddress);
      const contract = new Contract(this.config.announcerContractId);
      const announceTx = new TransactionBuilder(freshAccount, {
        fee: '100',
        networkPassphrase: this.config.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'announce',
            nativeToScVal(SCHEME_ID, { type: 'u32' }),
            new Address(stealth.stealthAddress).toScVal(),
            xdr.ScVal.scvBytes(Buffer.from(stealth.ephemeralPubKey)),
            xdr.ScVal.scvBytes(Buffer.from([stealth.viewTag])),
          ),
        )
        .setTimeout(30)
        .build();
      await this.simulateAndSubmitSoroban(announceTx, keypair);
    } catch (err: any) {
      this.logger.error(`Announcement FAILED: ${err.message}`);
    }

    return { txHash, txLink: this.getExplorerUrl('tx', txHash) };
  }

  async scanPayments(stealthKeys: ChainStealthKeys): Promise<DetectedPayment[]> {
    const keys = stealthKeys as unknown as StealthKeys;
    const announcements = await this.fetchAnnouncementEvents();
    const matched = scanAnnouncements(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );

    const results: DetectedPayment[] = [];
    for (const match of matched) {
      let balance = '0';
      try {
        const res = await fetch(`${this.config.horizonUrl}/accounts/${match.stealthAddress}`);
        if (res.ok) {
          const data = await res.json();
          const native = data.balances?.find((b: any) => b.asset_type === 'native');
          if (native) balance = native.balance;
        }
      } catch {}
      results.push({
        stealthAddress: match.stealthAddress,
        ephemeralPubKey: match.ephemeralPubKey,
        balance,
      });
    }
    return results;
  }

  async getBalance(address: string): Promise<ChainBalance> {
    const tokens: Record<string, string> = {};
    try {
      const res = await fetch(`${this.config.horizonUrl}/accounts/${address}`);
      if (res.ok) {
        const data = await res.json();
        for (const b of data.balances || []) {
          if (b.asset_type === 'native') {
            tokens['XLM'] = b.balance;
          } else if (b.asset_code) {
            tokens[b.asset_code] = b.balance;
          }
        }
      }
    } catch {}
    return { native: tokens['XLM'] || '0', tokens };
  }

  async withdraw(params: WithdrawParams): Promise<TxResult> {
    const { stealthKeys, from, to } = params;
    const keys = stealthKeys as unknown as StealthKeys;

    const announcements = await this.fetchAnnouncementEvents();
    const matched = scanAnnouncements(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingScalar,
    );
    const matchedEntry = matched.find((m) => m.stealthAddress === from);
    if (!matchedEntry) throw new Error('Stealth address not found in your payments');

    const res = await fetch(`${this.config.horizonUrl}/accounts/${from}`);
    if (!res.ok) throw new Error('Stealth address has no funds');
    const data = await res.json();
    const native = data.balances?.find((b: any) => b.asset_type === 'native');
    if (!native) throw new Error('No native balance found');

    const sendable = (parseFloat(native.balance) - 1.5).toFixed(7);
    if (parseFloat(sendable) <= 0) throw new Error('Balance too low to withdraw');

    const sourceAccount = new Account(from, data.sequence);
    const withdrawTx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(Operation.payment({ destination: to, asset: Asset.native(), amount: sendable }))
      .addOperation(Operation.accountMerge({ destination: to }))
      .setTimeout(30)
      .build();

    const txHashBytes = withdrawTx.hash();
    const signature = signStellarTransaction(
      txHashBytes,
      matchedEntry.stealthPrivateScalar,
      matchedEntry.stealthPubKeyBytes,
    );
    withdrawTx.addSignature(from, Buffer.from(signature).toString('base64'));

    const submitRes = await fetch(`${this.config.horizonUrl}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `tx=${encodeURIComponent(withdrawTx.toEnvelope().toXDR('base64'))}`,
    });
    const submitData = await submitRes.json();
    if (!submitRes.ok) {
      throw new Error(submitData.extras?.result_codes?.transaction || 'Transaction failed');
    }

    return { txHash: submitData.hash, txLink: this.getExplorerUrl('tx', submitData.hash) };
  }

  async withdrawAll(stealthKeys: ChainStealthKeys, to: string): Promise<WithdrawAllResult> {
    const payments = await this.scanPayments(stealthKeys);
    const results: Array<{ from: string; txHash: string; amount: string }> = [];
    let totalWithdrawn = 0;

    for (const p of payments) {
      if (parseFloat(p.balance) > 1.5) {
        try {
          const result = await this.withdraw({ stealthKeys, from: p.stealthAddress, to });
          totalWithdrawn += parseFloat(p.balance) - 1.5;
          results.push({ from: p.stealthAddress, txHash: result.txHash, amount: p.balance });
          await new Promise((r) => setTimeout(r, 1500));
        } catch (err: any) {
          this.logger.warn(`Failed to withdraw from ${p.stealthAddress}: ${err.message}`);
        }
      }
    }

    return { results, totalWithdrawn: totalWithdrawn.toFixed(7) };
  }

  async registerName(name: string, stealthKeys: ChainStealthKeys): Promise<TxResult> {
    throw new Error('Name registration requires a funded keypair — use agent service directly');
  }

  async resolveName(name: string): Promise<ResolvedName | null> {
    try {
      const cleanName = name.replace(/\.wraith$/, '');
      const DUMMY_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
      const contract = new Contract(this.config.namesContractId);
      const tx = new TransactionBuilder(new Account(DUMMY_ACCOUNT, '0'), {
        fee: '100',
        networkPassphrase: this.config.networkPassphrase,
      })
        .addOperation(contract.call('resolve', xdr.ScVal.scvString(cleanName)))
        .setTimeout(30)
        .build();

      const server = new rpc.Server(this.config.sorobanUrl);
      const simulated = await server.simulateTransaction(tx);
      if (!('error' in simulated) && 'result' in simulated && (simulated as any).result?.retval) {
        const retval = (simulated as any).result.retval;
        const resultXdr = xdr.ScVal.fromXDR(retval.toXDR());
        const bytes = resultXdr.bytes();
        if (bytes && bytes.length === 64) {
          const spendHex = bytesToHex(new Uint8Array(bytes.slice(0, 32)));
          const viewHex = bytesToHex(new Uint8Array(bytes.slice(32)));
          return { metaAddress: `st:xlm:${spendHex}${viewHex}` };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async fundWallet(address: string): Promise<TxResult> {
    const res = await fetch(`${this.config.friendbotUrl}/?addr=${address}`);
    if (res.ok) {
      return { txHash: '', txLink: this.getExplorerUrl('address', address) };
    }
    throw new Error('Friendbot funding failed — account may already be funded');
  }

  getExplorerUrl(type: 'tx' | 'address', value: string): string {
    return `${this.config.explorerUrl}/${type}/${value}`;
  }

  private async loadAccount(publicKey: string): Promise<Account> {
    const res = await fetch(`${this.config.horizonUrl}/accounts/${publicKey}`);
    if (!res.ok) throw new Error(`Failed to load account ${publicKey}`);
    const data = await res.json();
    return new Account(publicKey, data.sequence);
  }

  private async accountExists(publicKey: string): Promise<boolean> {
    const res = await fetch(`${this.config.horizonUrl}/accounts/${publicKey}`);
    return res.ok;
  }

  private async submitClassicTx(tx: any, keypair: Keypair): Promise<string> {
    tx.sign(keypair);
    const txXdr = tx.toEnvelope().toXDR('base64');
    const res = await fetch(`${this.config.horizonUrl}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `tx=${encodeURIComponent(txXdr)}`,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.extras?.result_codes?.transaction || data.title || 'Transaction failed');
    }
    return data.hash as string;
  }

  private async simulateAndSubmitSoroban(tx: any, keypair: Keypair): Promise<string> {
    const server = new rpc.Server(this.config.sorobanUrl);
    const simulated = await server.simulateTransaction(tx);
    if ('error' in simulated) throw new Error((simulated as any).error);
    const assembled = rpc
      .assembleTransaction(tx, simulated as rpc.Api.SimulateTransactionSuccessResponse)
      .build();
    assembled.sign(keypair);
    const response = await server.sendTransaction(assembled);
    if (response.status === 'ERROR') throw new Error('Soroban transaction failed');
    let attempts = 0;
    while (attempts < 30) {
      const result = await server.getTransaction(response.hash);
      if (result.status === 'SUCCESS') return response.hash;
      if (result.status === 'FAILED') throw new Error('Soroban transaction failed on-chain');
      if (result.status !== 'NOT_FOUND') break;
      attempts++;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return response.hash;
  }

  private async fetchAnnouncementEvents(): Promise<Announcement[]> {
    const all: Announcement[] = [];
    try {
      let startLedger = 1;
      const probeRes = await fetch(this.config.sorobanUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          method: 'getEvents',
          params: {
            startLedger: 1,
            filters: [{ type: 'contract', contractIds: [this.config.announcerContractId] }],
            pagination: { limit: 1 },
          },
        }),
      });
      const probeData = await probeRes.json();
      if (probeData.error?.message) {
        const match = probeData.error.message.match(/range:\s*(\d+)\s*-\s*(\d+)/);
        if (match) {
          const oldest = parseInt(match[1], 10);
          const latest = parseInt(match[2], 10);
          startLedger = Math.max(oldest, latest - 5000);
        } else return all;
      }

      let cursor: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const eventParams: any = {
          filters: [{ type: 'contract', contractIds: [this.config.announcerContractId] }],
          pagination: { limit: 1000 },
        };
        if (cursor) eventParams.pagination.cursor = cursor;
        else eventParams.startLedger = startLedger;

        const res = await fetch(this.config.sorobanUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getEvents', params: eventParams }),
        });
        const data = await res.json();
        const events = data.result?.events ?? [];
        for (const event of events) {
          try {
            const ann = this.parseAnnouncementEvent(event);
            if (ann) all.push(ann);
          } catch {}
        }
        if (events.length < 1000) hasMore = false;
        else {
          cursor = data.result?.cursor;
          if (!cursor) hasMore = false;
        }
      }
    } catch {}
    return all;
  }

  private parseAnnouncementEvent(event: any): Announcement | null {
    const topics = event.topic;
    if (!topics || topics.length < 3) return null;
    const schemeIdScVal = xdr.ScVal.fromXDR(topics[1], 'base64');
    const stealthScVal = xdr.ScVal.fromXDR(topics[2], 'base64');
    const stealthAddress = Address.fromScAddress(stealthScVal.address()).toString();
    const valueScVal = xdr.ScVal.fromXDR(event.value, 'base64');
    const valueVec = valueScVal.vec();
    if (!valueVec || valueVec.length < 3) return null;
    const caller = Address.fromScAddress(valueVec[0].address()).toString();
    const ephPubKeyBytes = valueVec[1].bytes();
    const viewTagBytes = valueVec[2].bytes();
    if (!ephPubKeyBytes || !viewTagBytes) return null;
    return {
      schemeId: schemeIdScVal.u32(),
      stealthAddress,
      caller,
      ephemeralPubKey: bytesToHex(new Uint8Array(ephPubKeyBytes)),
      metadata: bytesToHex(new Uint8Array(viewTagBytes)),
    };
  }
}
