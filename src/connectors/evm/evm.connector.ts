import { Logger } from '@nestjs/common';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
  formatEther,
  formatUnits,
  type Hex,
  type PublicClient,
  type Chain,
} from 'viem';
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
import {
  deriveStealthKeys,
  generateStealthAddress,
  scanAnnouncements,
  deriveStealthPrivateKey,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
  signNameRegistration,
  metaAddressToBytes,
  fetchAnnouncements as sdkFetchAnnouncements,
  SCHEME_ID,
  STEALTH_SIGNING_MESSAGE,
  SENDER_ABI,
  NAMES_ABI,
  type HexString,
  type Announcement,
  type StealthKeys,
} from '@wraith-protocol/sdk/chains/evm';

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export interface EvmChainConfig {
  chain: string;
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  subgraphUrl: string;
  senderAddress: Hex;
  namesAddress: Hex;
  faucetUrl: string;
  deployerKey: Hex;
  tokens: Record<string, { address: string; decimals: number }>;
}

export class EvmConnector implements ChainConnector {
  readonly chain: string;
  private readonly logger: Logger;
  private readonly config: EvmChainConfig;
  private readonly viemChain: Chain;
  private readonly publicClient: PublicClient;

  constructor(config: EvmChainConfig) {
    this.chain = config.chain;
    this.config = config;
    this.logger = new Logger(`EvmConnector[${config.chain}]`);

    this.viemChain = {
      id: config.chainId,
      name: config.chainName,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    } as Chain;

    this.publicClient = createPublicClient({
      chain: this.viemChain,
      transport: http(config.rpcUrl),
    }) as PublicClient;
  }

  async deriveKeys(seed: Uint8Array): Promise<DerivedKeys> {
    const privateKey = `0x${Buffer.from(seed).toString('hex')}` as Hex;
    const account = privateKeyToAccount(privateKey);

    const signature = await account.signMessage({ message: STEALTH_SIGNING_MESSAGE });
    const stealthKeys = deriveStealthKeys(signature as HexString);
    const metaAddress = encodeStealthMetaAddress(
      stealthKeys.spendingPubKey,
      stealthKeys.viewingPubKey,
    );

    return {
      address: account.address,
      metaAddress,
      stealthKeys: {
        spendingKey: stealthKeys.spendingKey,
        viewingKey: stealthKeys.viewingKey,
        spendingPubKey: stealthKeys.spendingPubKey,
        viewingPubKey: stealthKeys.viewingPubKey,
      },
    };
  }

  async sendPayment(params: SendPaymentParams): Promise<TxResult> {
    const { recipientMetaAddress, amount, asset = 'ETH' } = params;

    let metaAddress: string;
    if (recipientMetaAddress.startsWith('st:eth:0x')) {
      metaAddress = recipientMetaAddress;
    } else {
      const cleanName = recipientMetaAddress.replace(/\.wraith$/, '');
      const resolved = await this.resolveName(cleanName);
      if (!resolved) throw new Error(`Could not resolve name "${cleanName}.wraith"`);
      metaAddress = resolved.metaAddress;
    }

    const decoded = decodeStealthMetaAddress(metaAddress);
    const stealth = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
    const viewTagByte = `0x${stealth.viewTag.toString(16).padStart(2, '0')}` as Hex;

    const deployerAccount = privateKeyToAccount(this.config.deployerKey);
    const walletClient = createWalletClient({
      account: deployerAccount,
      chain: this.viemChain,
      transport: http(this.config.rpcUrl),
    });

    let txHash: Hex;
    const assetUpper = asset.toUpperCase();

    if (assetUpper === 'ETH') {
      txHash = await walletClient.writeContract({
        address: this.config.senderAddress,
        abi: SENDER_ABI,
        functionName: 'sendETH',
        args: [
          SCHEME_ID,
          stealth.stealthAddress as Hex,
          stealth.ephemeralPubKey as Hex,
          viewTagByte,
        ],
        value: parseEther(amount),
      });
    } else {
      const tokenConfig = this.config.tokens[assetUpper];
      if (!tokenConfig || tokenConfig.address === 'native') {
        throw new Error(`Unsupported token: ${asset}`);
      }
      const tokenAddress = tokenConfig.address as Hex;
      const parsedAmount = parseUnits(amount, tokenConfig.decimals);

      const approveTx = await walletClient.writeContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [this.config.senderAddress, parsedAmount],
      });
      await (this.publicClient as any).waitForTransactionReceipt({ hash: approveTx });

      txHash = await walletClient.writeContract({
        address: this.config.senderAddress,
        abi: SENDER_ABI,
        functionName: 'sendERC20',
        args: [
          tokenAddress,
          parsedAmount,
          SCHEME_ID,
          stealth.stealthAddress as Hex,
          stealth.ephemeralPubKey as Hex,
          viewTagByte,
        ],
      });
    }

    return {
      txHash,
      txLink: this.getExplorerUrl('tx', txHash),
    };
  }

  async scanPayments(stealthKeys: ChainStealthKeys): Promise<DetectedPayment[]> {
    const keys = stealthKeys as unknown as StealthKeys;
    const announcements = await this.fetchAnnouncementEvents();
    const matched = scanAnnouncements(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingKey,
    );

    const results: DetectedPayment[] = [];
    for (const match of matched) {
      let balance = '0';
      try {
        const bal = await this.publicClient.getBalance({ address: match.stealthAddress as Hex });
        balance = formatEther(bal);
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
      const ethBalance = await this.publicClient.getBalance({ address: address as Hex });
      tokens['ETH'] = formatEther(ethBalance);

      for (const [symbol, tokenConfig] of Object.entries(this.config.tokens)) {
        if (tokenConfig.address === 'native') continue;
        try {
          const tokenBalance = await this.publicClient.readContract({
            address: tokenConfig.address as Hex,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [address as Hex],
          });
          const formatted = formatUnits(tokenBalance as bigint, tokenConfig.decimals);
          if (parseFloat(formatted) > 0) {
            tokens[symbol] = formatted;
          }
        } catch {}
      }
    } catch {}
    return { native: tokens['ETH'] || '0', tokens };
  }

  async withdraw(params: WithdrawParams): Promise<TxResult> {
    const { stealthKeys, from, to, amount } = params;
    const keys = stealthKeys as unknown as StealthKeys;

    const announcements = await this.fetchAnnouncementEvents();
    const matched = scanAnnouncements(
      announcements,
      keys.viewingKey,
      keys.spendingPubKey,
      keys.spendingKey,
    );
    const matchedEntry = matched.find((m) => m.stealthAddress.toLowerCase() === from.toLowerCase());
    if (!matchedEntry) throw new Error('Stealth address not found in your payments');

    const balance = await this.publicClient.getBalance({ address: from as Hex });
    if (balance === 0n) throw new Error('Stealth address has no funds');

    const stealthPrivateKey = deriveStealthPrivateKey(
      keys.spendingKey,
      matchedEntry.ephemeralPubKey,
      keys.viewingKey,
    );

    const stealthAccount = privateKeyToAccount(stealthPrivateKey as Hex);
    const stealthWallet = createWalletClient({
      account: stealthAccount,
      chain: this.viemChain,
      transport: http(this.config.rpcUrl),
    });

    const gasLimit = 21000n;
    const gasPrice = await this.publicClient.getGasPrice();
    const gasCost = gasPrice * gasLimit * 2n;

    let sendable: bigint;
    const isAll = !amount || amount.toLowerCase() === 'all';

    if (isAll) {
      sendable = balance - gasCost;
      if (sendable <= 0n) {
        throw new Error(
          `Balance (${formatEther(balance)} ETH) too low to cover gas (~${formatEther(gasCost)} ETH)`,
        );
      }
    } else {
      sendable = parseEther(amount);
      if (sendable + gasCost > balance) {
        throw new Error(
          `Cannot withdraw ${amount} ETH — balance is ${formatEther(balance)} ETH, gas ~${formatEther(gasCost)} ETH`,
        );
      }
    }

    const txHash = await stealthWallet.sendTransaction({
      to: to as Hex,
      value: sendable,
    });

    return {
      txHash,
      txLink: this.getExplorerUrl('tx', txHash),
    };
  }

  async withdrawAll(stealthKeys: ChainStealthKeys, to: string): Promise<WithdrawAllResult> {
    const payments = await this.scanPayments(stealthKeys);
    const results: Array<{ from: string; txHash: string; amount: string }> = [];
    let totalWithdrawn = 0n;

    for (const p of payments) {
      if (parseFloat(p.balance) > 0) {
        try {
          const result = await this.withdraw({
            stealthKeys,
            from: p.stealthAddress,
            to,
          });
          const balance = await this.publicClient.getBalance({
            address: p.stealthAddress as Hex,
          });
          const withdrawn = parseEther(p.balance) - balance;
          totalWithdrawn += withdrawn;
          results.push({
            from: p.stealthAddress,
            txHash: result.txHash,
            amount: p.balance,
          });
          await new Promise((r) => setTimeout(r, 1500));
        } catch (err: any) {
          this.logger.warn(`Failed to withdraw from ${p.stealthAddress}: ${err.message}`);
        }
      }
    }

    return { results, totalWithdrawn: formatEther(totalWithdrawn) };
  }

  async registerName(name: string, stealthKeys: ChainStealthKeys): Promise<TxResult> {
    const keys = stealthKeys as unknown as StealthKeys;
    if (!this.config.deployerKey) {
      throw new Error('DEPLOYER_KEY not configured — cannot register name on-chain');
    }

    const cleanName = name.replace(/\.wraith$/, '');
    const metaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
    const metaBytes = metaAddressToBytes(metaAddress);
    const signature = signNameRegistration(cleanName, metaBytes, keys.spendingKey);

    const deployerAccount = privateKeyToAccount(this.config.deployerKey);
    const walletClient = createWalletClient({
      account: deployerAccount,
      chain: this.viemChain,
      transport: http(this.config.rpcUrl),
    });

    const txHash = await walletClient.writeContract({
      address: this.config.namesAddress,
      abi: NAMES_ABI,
      functionName: 'register',
      args: [cleanName, metaBytes, signature],
    });

    return { txHash, txLink: this.getExplorerUrl('tx', txHash) };
  }

  async resolveName(name: string): Promise<ResolvedName | null> {
    try {
      const cleanName = name.replace(/\.wraith$/, '');
      const resultBytes = await this.publicClient.readContract({
        address: this.config.namesAddress,
        abi: NAMES_ABI,
        functionName: 'resolve',
        args: [cleanName],
      });

      const bytes = resultBytes as Hex;
      if (bytes && bytes.length === 134) {
        const spendHex = bytes.slice(2, 68);
        const viewHex = bytes.slice(68);
        return { metaAddress: `st:eth:0x${spendHex}${viewHex}` };
      }
      return null;
    } catch {
      return null;
    }
  }

  async fundWallet(address: string): Promise<TxResult> {
    const res = await fetch(`${this.config.faucetUrl}/api/trpc/faucet.requestFaucetFunds?batch=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        '0': {
          json: {
            rollupSubdomain: 'horizen-testnet',
            recipientAddress: address,
            turnstileToken: '',
            tokenRollupAddress: null,
          },
          meta: { values: { tokenRollupAddress: ['undefined'] } },
        },
      }),
    });
    const data = await res.json();
    const result = data?.[0]?.result?.data?.json;

    if (result?.success) {
      return {
        txHash: result.transactionHash,
        txLink: this.getExplorerUrl('tx', result.transactionHash),
      };
    }
    throw new Error('Faucet request failed — may be rate-limited, try again later');
  }

  getExplorerUrl(type: 'tx' | 'address', value: string): string {
    return `${this.config.explorerUrl}/${type}/${value}`;
  }

  private async fetchAnnouncementEvents(): Promise<Announcement[]> {
    const all: Announcement[] = [];
    try {
      let skip = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const query = {
          query: `query($first: Int!, $skip: Int!) {
            announcements(first: $first, skip: $skip, where: { schemeId: "1" }, orderBy: block_number, orderDirection: asc) {
              schemeId, stealthAddress, caller, ephemeralPubKey, metadata
            }
          }`,
          variables: { first: batchSize, skip },
        };

        const res = await fetch(this.config.subgraphUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(query),
        });
        const data = await res.json();
        const announcements = data.data?.announcements ?? [];

        for (const ann of announcements) {
          all.push({
            schemeId: BigInt(ann.schemeId),
            stealthAddress: ann.stealthAddress as HexString,
            caller: ann.caller as HexString,
            ephemeralPubKey: ann.ephemeralPubKey as HexString,
            metadata: ann.metadata as HexString,
          });
        }

        if (announcements.length < batchSize) hasMore = false;
        else skip += batchSize;
      }
    } catch {}
    return all;
  }
}
