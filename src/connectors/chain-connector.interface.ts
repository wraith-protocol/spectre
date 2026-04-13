import type { Hex } from 'viem';

export interface DerivedKeys {
  address: string;
  metaAddress: string;
  stealthKeys: ChainStealthKeys;
}

export interface ChainStealthKeys {
  spendingKey: Hex | Uint8Array;
  viewingKey: Hex | Uint8Array;
  spendingPubKey: Hex | Uint8Array;
  viewingPubKey: Hex | Uint8Array;
  /** ed25519-specific scalar form of spending key */
  spendingScalar?: bigint;
  /** ed25519-specific scalar form of viewing key */
  viewingScalar?: bigint;
}

export interface SendPaymentParams {
  senderKeys: ChainStealthKeys;
  senderAddress: string;
  recipientMetaAddress: string;
  amount: string;
  asset?: string;
}

export interface WithdrawParams {
  stealthKeys: ChainStealthKeys;
  from: string;
  to: string;
  amount?: string;
}

export interface DetectedPayment {
  stealthAddress: string;
  ephemeralPubKey: string;
  balance: string;
}

export interface ChainBalance {
  native: string;
  tokens: Record<string, string>;
}

export interface ResolvedName {
  metaAddress: string;
  address?: string;
}

export interface TxResult {
  txHash: string;
  txLink: string;
}

export interface WithdrawAllResult {
  results: Array<{ from: string; txHash: string; amount: string }>;
  totalWithdrawn: string;
}

export interface ChainConnector {
  readonly chain: string;

  deriveKeys(seed: Uint8Array): Promise<DerivedKeys>;

  sendPayment(params: SendPaymentParams): Promise<TxResult>;

  scanPayments(stealthKeys: ChainStealthKeys): Promise<DetectedPayment[]>;

  getBalance(address: string): Promise<ChainBalance>;

  withdraw(params: WithdrawParams): Promise<TxResult>;

  withdrawAll(stealthKeys: ChainStealthKeys, to: string): Promise<WithdrawAllResult>;

  registerName(name: string, stealthKeys: ChainStealthKeys): Promise<TxResult>;

  resolveName(name: string): Promise<ResolvedName | null>;

  fundWallet(address: string): Promise<TxResult>;

  getExplorerUrl(type: 'tx' | 'address', value: string): string;
}
