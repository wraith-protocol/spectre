import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmRawTransaction,
} from '@solana/web3.js';
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
  signSolanaTransaction,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  bytesToHex,
  hexToBytes,
  SCHEME_ID,
  STEALTH_SIGNING_MESSAGE,
  type StealthKeys,
  type Announcement,
} from '@wraith-protocol/sdk/chains/solana';

export interface SolanaConnectorConfig {
  chain: string;
  rpcUrl: string;
  explorerUrl: string;
  contracts: {
    announcer: string;
    sender: string;
    names: string;
  };
  cluster: 'devnet' | 'testnet' | 'mainnet-beta';
}

export class SolanaConnector implements ChainConnector {
  readonly chain: string;
  private readonly logger: Logger;
  private readonly config: SolanaConnectorConfig;
  private readonly connection: Connection;
  private readonly programIds: { announcer: PublicKey; sender: PublicKey; names: PublicKey };

  constructor(config: SolanaConnectorConfig) {
    this.chain = config.chain;
    this.config = config;
    this.logger = new Logger(`SolanaConnector[${config.chain}]`);
    this.connection = new Connection(config.rpcUrl);
    this.programIds = {
      announcer: new PublicKey(config.contracts.announcer),
      sender: new PublicKey(config.contracts.sender),
      names: new PublicKey(config.contracts.names),
    };
  }

  async deriveKeys(seed: Uint8Array): Promise<DerivedKeys> {
    const keypair = Keypair.fromSeed(seed);

    const syntheticSig = new Uint8Array(64);
    syntheticSig.set(
      createHash('sha256')
        .update(Buffer.from([...keypair.secretKey.slice(0, 32), 0x01]))
        .digest(),
      0,
    );
    syntheticSig.set(
      createHash('sha256')
        .update(Buffer.from([...keypair.secretKey.slice(0, 32), 0x02]))
        .digest(),
      32,
    );

    const stealthKeys = deriveStealthKeys(syntheticSig);
    const metaAddress = encodeStealthMetaAddress(
      stealthKeys.spendingPubKey,
      stealthKeys.viewingPubKey,
    );

    return {
      address: keypair.publicKey.toBase58(),
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
    const { senderAddress, recipientMetaAddress, amount } = params;

    let metaAddress: string;
    if (recipientMetaAddress.startsWith('st:sol:')) {
      metaAddress = recipientMetaAddress;
    } else {
      const cleanName = recipientMetaAddress.replace(/\.wraith$/, '');
      const resolved = await this.resolveName(cleanName);
      if (!resolved) throw new Error(`Could not resolve name "${cleanName}.wraith"`);
      metaAddress = resolved.metaAddress;
    }

    const decoded = decodeStealthMetaAddress(metaAddress);
    const stealth = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
    const stealthPubKey = new PublicKey(stealth.stealthAddress);
    const senderPubKey = new PublicKey(senderAddress);
    const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: senderPubKey,
        toPubkey: stealthPubKey,
        lamports,
      }),
    );

    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = senderPubKey;

    const txHash = await this.connection.sendTransaction(tx, [Keypair.fromSeed(Buffer.alloc(32))]);

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
        const pubKey = new PublicKey(match.stealthAddress);
        const lamports = await this.connection.getBalance(pubKey);
        balance = (lamports / LAMPORTS_PER_SOL).toFixed(9);
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
      const pubKey = new PublicKey(address);
      const lamports = await this.connection.getBalance(pubKey);
      tokens['SOL'] = (lamports / LAMPORTS_PER_SOL).toFixed(9);

      const tokenAccounts = await this.connection.getTokenAccountsByOwner(pubKey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      });
      for (const { account } of tokenAccounts.value) {
        try {
          const data = account.data;
          const mintBytes = data.slice(0, 32);
          const amountBytes = data.slice(64, 72);
          const mint = new PublicKey(mintBytes).toBase58();
          const rawAmount = Number(amountBytes.readBigUInt64LE(0));
          if (rawAmount > 0) {
            tokens[mint] = (rawAmount / 1e9).toFixed(9);
          }
        } catch {}
      }
    } catch {}
    return { native: tokens['SOL'] || '0', tokens };
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

    const fromPubKey = new PublicKey(from);
    const toPubKey = new PublicKey(to);
    const lamports = await this.connection.getBalance(fromPubKey);
    if (lamports === 0) throw new Error('Stealth address has no funds');

    const txFee = 5000;
    const sendable = lamports - txFee;
    if (sendable <= 0) throw new Error('Balance too low to cover transaction fee');

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromPubKey,
        toPubkey: toPubKey,
        lamports: sendable,
      }),
    );

    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = fromPubKey;

    const messageBytes = tx.serializeMessage();
    const signature = signSolanaTransaction(
      messageBytes,
      matchedEntry.stealthPrivateScalar,
      matchedEntry.stealthPubKeyBytes,
    );
    tx.addSignature(fromPubKey, Buffer.from(signature));

    const rawTx = tx.serialize();
    const txHash = await sendAndConfirmRawTransaction(this.connection, rawTx);

    return { txHash, txLink: this.getExplorerUrl('tx', txHash) };
  }

  async withdrawAll(stealthKeys: ChainStealthKeys, to: string): Promise<WithdrawAllResult> {
    const payments = await this.scanPayments(stealthKeys);
    const results: Array<{ from: string; txHash: string; amount: string }> = [];
    let totalWithdrawn = 0;

    for (const p of payments) {
      if (parseFloat(p.balance) > 0.001) {
        try {
          const result = await this.withdraw({ stealthKeys, from: p.stealthAddress, to });
          totalWithdrawn += parseFloat(p.balance);
          results.push({ from: p.stealthAddress, txHash: result.txHash, amount: p.balance });
          await new Promise((r) => setTimeout(r, 1500));
        } catch (err: any) {
          this.logger.warn(`Failed to withdraw from ${p.stealthAddress}: ${err.message}`);
        }
      }
    }

    return { results, totalWithdrawn: totalWithdrawn.toFixed(9) };
  }

  async registerName(name: string, stealthKeys: ChainStealthKeys): Promise<TxResult> {
    throw new Error('Name registration requires a funded keypair — use agent service directly');
  }

  async resolveName(name: string): Promise<ResolvedName | null> {
    try {
      const cleanName = name.replace(/\.wraith$/, '');
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('name'), Buffer.from(cleanName)],
        this.programIds.names,
      );

      const accountInfo = await this.connection.getAccountInfo(pda);
      if (!accountInfo || !accountInfo.data) return null;

      const data = accountInfo.data;
      // Skip Anchor discriminator (8 bytes) + name string (4 byte length prefix + content)
      const nameLen = data.readUInt32LE(8);
      const metaOffset = 8 + 4 + nameLen;

      if (data.length < metaOffset + 64) return null;

      const metaBytes = data.slice(metaOffset, metaOffset + 64);
      const spendHex = bytesToHex(new Uint8Array(metaBytes.slice(0, 32)));
      const viewHex = bytesToHex(new Uint8Array(metaBytes.slice(32)));
      return { metaAddress: `st:sol:${spendHex}${viewHex}` };
    } catch {
      return null;
    }
  }

  async fundWallet(address: string): Promise<TxResult> {
    const pubKey = new PublicKey(address);
    const sig = await this.connection.requestAirdrop(pubKey, 2 * LAMPORTS_PER_SOL);
    await this.connection.confirmTransaction(sig);
    return { txHash: sig, txLink: this.getExplorerUrl('tx', sig) };
  }

  getExplorerUrl(type: 'tx' | 'address', value: string): string {
    const cluster = this.config.cluster !== 'mainnet-beta' ? `?cluster=${this.config.cluster}` : '';
    return `${this.config.explorerUrl}/${type}/${value}${cluster}`;
  }

  private async fetchAnnouncementEvents(): Promise<Announcement[]> {
    const all: Announcement[] = [];
    try {
      const signatures = await this.connection.getSignaturesForAddress(this.programIds.announcer, {
        limit: 1000,
      });

      for (const sig of signatures) {
        try {
          const tx = await this.connection.getTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });
          if (!tx) continue;
          const parsed = this.parseAnnouncementFromTransaction(tx);
          if (parsed) all.push(parsed);
        } catch {}
      }
    } catch {}
    return all;
  }

  private parseAnnouncementFromTransaction(tx: any): Announcement | null {
    const logs = tx.meta?.logMessages ?? [];
    for (const log of logs) {
      if (!log.startsWith('Program data:')) continue;
      try {
        const b64 = log.slice('Program data: '.length);
        const data = Buffer.from(b64, 'base64');

        // Anchor event discriminator (8 bytes) + data
        if (data.length < 8 + 4 + 32 + 32 + 32) continue;

        const offset = 8;
        const schemeId = data.readUInt32LE(offset);
        const stealthAddressBytes = data.slice(offset + 4, offset + 36);
        const callerBytes = data.slice(offset + 36, offset + 68);
        const ephPubKeyBytes = data.slice(offset + 68, offset + 100);

        const metadataLenOffset = offset + 100;
        if (data.length < metadataLenOffset + 4) continue;
        const metadataLen = data.readUInt32LE(metadataLenOffset);
        const metadataBytes = data.slice(
          metadataLenOffset + 4,
          metadataLenOffset + 4 + metadataLen,
        );

        return {
          schemeId,
          stealthAddress: new PublicKey(stealthAddressBytes).toBase58(),
          caller: new PublicKey(callerBytes).toBase58(),
          ephemeralPubKey: bytesToHex(new Uint8Array(ephPubKeyBytes)),
          metadata: bytesToHex(new Uint8Array(metadataBytes)),
        };
      } catch {}
    }
    return null;
  }
}
