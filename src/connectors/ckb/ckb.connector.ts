import { Logger } from '@nestjs/common';
import {
  deriveStealthKeys,
  generateStealthAddress,
  scanStealthCells,
  deriveStealthPrivateKey,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  fetchStealthCells,
  SCHEME_ID,
  STEALTH_SIGNING_MESSAGE,
  type HexString,
  type StealthKeys,
  type StealthCell,
} from '@wraith-protocol/sdk/chains/ckb';
import { sha256 } from '@noble/hashes/sha256';
import { secp256k1 } from '@noble/curves/secp256k1';
import { toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
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

export interface CKBConnectorConfig {
  chain: string;
  rpcUrl: string;
  explorerUrl: string;
  stealthLockCodeHash: string;
  cellDeps: {
    stealthLock: { txHash: string; index: number };
    ckbAuth: { txHash: string; index: number };
  };
}

export class CKBConnector implements ChainConnector {
  readonly chain: string;
  readonly nativeAsset = 'CKB';
  readonly addressFormat = 'ckb' as const;
  private readonly logger = new Logger('CKBConnector');
  private readonly config: CKBConnectorConfig;

  constructor(config: CKBConnectorConfig) {
    this.chain = config.chain;
    this.config = config;
  }

  async deriveKeys(seed: Uint8Array): Promise<DerivedKeys> {
    const hash = sha256(seed);
    const privateKey = `0x${toHex(hash).slice(2)}` as HexString;
    const account = privateKeyToAccount(privateKey);
    const signature = await account.signMessage({
      message: STEALTH_SIGNING_MESSAGE,
    });
    const keys = deriveStealthKeys(signature as HexString);
    const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    return {
      address: account.address,
      stealthKeys: keys as unknown as ChainStealthKeys,
      metaAddress,
    };
  }

  async sendPayment(params: SendPaymentParams): Promise<TxResult> {
    const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(params.recipientMetaAddress);
    const stealth = generateStealthAddress(spendingPubKey, viewingPubKey);

    // Build CKB transaction with stealth-lock Cell
    // The Cell output uses stealth-lock with args = lockArgs (53 bytes)
    // This requires CKB transaction building which is chain-specific
    const txHash = await this.buildAndSendStealthTransaction(
      params.senderAddress,
      stealth.lockArgs,
      params.amount,
      params.senderKeys,
    );

    return {
      txHash,
      txLink: this.getExplorerUrl('tx', txHash),
    };
  }

  async scanPayments(stealthKeys: ChainStealthKeys): Promise<DetectedPayment[]> {
    const keys = stealthKeys as unknown as StealthKeys;
    const cells = await fetchStealthCells('ckb');

    const matched = scanStealthCells(cells, keys.viewingKey, keys.spendingPubKey, keys.spendingKey);

    const results: DetectedPayment[] = [];
    for (const cell of matched) {
      results.push({
        stealthAddress: cell.stealthPubKeyHash,
        balance: (Number(cell.capacity) / 1e8).toString(),
        ephemeralPubKey: cell.ephemeralPubKey,
      });
    }
    return results;
  }

  async getBalance(address: string): Promise<ChainBalance> {
    try {
      const res = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 0,
          jsonrpc: '2.0',
          method: 'get_cells_capacity',
          params: [
            {
              script: {
                code_hash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
                hash_type: 'type',
                args: address,
              },
              script_type: 'lock',
            },
          ],
        }),
      });
      const data = await res.json();
      const capacityHex = data.result?.capacity || '0x0';
      const capacity = BigInt(capacityHex);
      return {
        native: (Number(capacity) / 1e8).toString(),
        tokens: {},
      };
    } catch {
      return { native: '0', tokens: {} };
    }
  }

  async withdraw(params: WithdrawParams): Promise<TxResult> {
    const keys = params.stealthKeys as unknown as StealthKeys;
    const cells = await fetchStealthCells('ckb');

    const matched = scanStealthCells(cells, keys.viewingKey, keys.spendingPubKey, keys.spendingKey);

    const targetCell = matched.find(
      (c) =>
        c.stealthPubKeyHash.toLowerCase() === params.from.toLowerCase() ||
        c.txHash.toLowerCase() === params.from.toLowerCase(),
    );

    if (!targetCell) {
      return { txHash: '', txLink: 'Error: stealth cell not found' };
    }

    const stealthKey = deriveStealthPrivateKey(
      keys.spendingKey,
      targetCell.ephemeralPubKey as HexString,
      keys.viewingKey,
    );

    // Build withdrawal transaction consuming the stealth Cell
    const txHash = await this.buildWithdrawTransaction(targetCell, params.to, stealthKey);

    return {
      txHash,
      txLink: this.getExplorerUrl('tx', txHash),
    };
  }

  async withdrawAll(stealthKeys: ChainStealthKeys, to: string): Promise<WithdrawAllResult> {
    const keys = stealthKeys as unknown as StealthKeys;
    const cells = await fetchStealthCells('ckb');
    const matched = scanStealthCells(cells, keys.viewingKey, keys.spendingPubKey, keys.spendingKey);

    const results: Array<{ from: string; txHash: string; amount: string }> = [];
    let totalWithdrawn = 0;

    for (const cell of matched) {
      try {
        const stealthKey = deriveStealthPrivateKey(
          keys.spendingKey,
          cell.ephemeralPubKey as HexString,
          keys.viewingKey,
        );
        const txHash = await this.buildWithdrawTransaction(cell, to, stealthKey);
        const amount = Number(cell.capacity) / 1e8;
        totalWithdrawn += amount;
        results.push({
          from: cell.stealthPubKeyHash,
          txHash,
          amount: amount.toString(),
        });
      } catch {
        // skip failed withdrawals
      }
    }

    return {
      results,
      totalWithdrawn: totalWithdrawn.toString(),
    };
  }

  async registerName(): Promise<TxResult> {
    return { txHash: '', txLink: 'CKB names not yet supported' };
  }

  async resolveName(): Promise<ResolvedName | null> {
    return null;
  }

  async fundWallet(address: string): Promise<TxResult> {
    // CKB testnet faucet
    try {
      const res = await fetch('https://faucet.nervos.org/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      return {
        txHash: data.txHash || '',
        txLink: data.txHash ? this.getExplorerUrl('tx', data.txHash) : 'Faucet request submitted',
      };
    } catch (err: any) {
      return { txHash: '', txLink: `Faucet error: ${err.message}` };
    }
  }

  getExplorerUrl(type: 'tx' | 'address', value: string): string {
    if (type === 'tx') {
      return `${this.config.explorerUrl}/transaction/${value}`;
    }
    return `${this.config.explorerUrl}/address/${value}`;
  }

  private async buildAndSendStealthTransaction(
    _senderAddress: string,
    _lockArgs: HexString,
    _amount: string,
    _senderKeys: ChainStealthKeys,
  ): Promise<string> {
    // CKB transaction building requires:
    // 1. Collect input cells from sender
    // 2. Build output cell with stealth-lock script
    // 3. Build change cell back to sender
    // 4. Sign with sender's key
    // 5. Submit via RPC
    this.logger.warn('CKB send transaction building not yet fully implemented');
    return '0x';
  }

  private async buildWithdrawTransaction(
    _cell: any,
    _destination: string,
    _stealthKey: HexString,
  ): Promise<string> {
    // CKB withdrawal requires:
    // 1. Input: the stealth cell
    // 2. Output: destination cell with standard lock
    // 3. Sign with derived stealth key
    // 4. Submit via RPC
    this.logger.warn('CKB withdraw transaction building not yet fully implemented');
    return '0x';
  }
}
