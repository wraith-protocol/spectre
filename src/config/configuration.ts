export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),

  horizen: {
    chainId: parseInt(process.env.HORIZEN_CHAIN_ID || '2651420', 10),
    rpcUrl: process.env.HORIZEN_RPC_URL || 'https://horizen-testnet.rpc.caldera.xyz/http',
    explorerUrl: process.env.HORIZEN_EXPLORER_URL || 'https://horizen-testnet.explorer.caldera.xyz',
    subgraphUrl:
      process.env.HORIZEN_SUBGRAPH_URL ||
      'https://api.goldsky.com/api/public/project_cmhp1xyw0qu8901xcdayke69d/subgraphs/wraith-stealth-horizen-testnet-horizen-testnet/2.0.0/gn',
    announcerAddress:
      process.env.HORIZEN_ANNOUNCER_ADDRESS || '0x8AE65c05E7eb48B9bA652781Bc0a3DBA09A484F3',
    registryAddress:
      process.env.HORIZEN_REGISTRY_ADDRESS || '0x953E6cEdcdfAe321796e7637d33653F6Ce05c527',
    senderAddress:
      process.env.HORIZEN_SENDER_ADDRESS || '0x226C5eb4e139D9fa01cc09eA318638b090b12095',
    withdrawerAddress:
      process.env.HORIZEN_WITHDRAWER_ADDRESS || '0x9F7f1C9d8B5a83245c6fC8415Ef744C458101711',
    namesAddress: process.env.HORIZEN_NAMES_ADDRESS || '0x3d46f709a99A3910f52bD292211Eb5D557F882D6',
    faucetUrl: process.env.HORIZEN_FAUCET_URL || 'https://horizen-testnet.hub.caldera.xyz/faucet',
    deployerKey: process.env.DEPLOYER_KEY || '',
    tokens: {
      ETH: { address: 'native', decimals: 18 },
      ZEN: { address: '0x4b36cb6E7c257E9aA246122a997be0F7Dc1eFCd1', decimals: 18 },
      USDC: { address: '0x01c7AEb2A0428b4159c0E333712f40e127aF639E', decimals: 6 },
    },
  },

  stellar: {
    networkPassphrase:
      process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
    horizonUrl: process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
    sorobanUrl: process.env.STELLAR_SOROBAN_URL || 'https://soroban-testnet.stellar.org',
    announcerContractId: process.env.STELLAR_ANNOUNCER_CONTRACT_ID || '',
    friendbotUrl: process.env.STELLAR_FRIENDBOT_URL || 'https://friendbot.stellar.org',
  },

  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    explorerUrl: process.env.SOLANA_EXPLORER_URL || 'https://explorer.solana.com',
    cluster: process.env.SOLANA_CLUSTER || 'devnet',
    announcerProgramId: process.env.SOLANA_ANNOUNCER_PROGRAM_ID || '',
    senderProgramId: process.env.SOLANA_SENDER_PROGRAM_ID || '',
    namesProgramId: process.env.SOLANA_NAMES_PROGRAM_ID || '',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
  },

  database: (() => {
    const url = process.env.DATABASE_URL;
    if (url) {
      const parsed = new URL(url);
      return {
        host: parsed.hostname,
        port: parseInt(parsed.port || '5432', 10),
        name: parsed.pathname.slice(1),
        user: parsed.username,
        password: parsed.password,
      };
    }
    return {
      host: process.env.DATABASE_HOST || 'db',
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      name: process.env.DATABASE_NAME || 'wraith',
      user: process.env.DATABASE_USER || 'wraith',
      password: process.env.DATABASE_PASSWORD || 'wraith',
    };
  })(),
});
