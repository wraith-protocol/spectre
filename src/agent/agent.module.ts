import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationModule } from '../notifications/notification.module';
import { ChainRegistry } from '../connectors/chain-registry';
import { EvmConnector } from '../connectors/evm/evm.connector';
import { StellarConnector } from '../connectors/stellar/stellar.connector';
import { SolanaConnector } from '../connectors/solana/solana.connector';
import { CKBConnector } from '../connectors/ckb/ckb.connector';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { AgentToolsService } from './tools/agent-tools.service';
import type { Hex } from 'viem';

@Module({
  imports: [NotificationModule],
  providers: [
    AgentService,
    AgentToolsService,
    {
      provide: ChainRegistry,
      useFactory: (config: ConfigService) => {
        const registry = new ChainRegistry();

        registry.register(
          'horizen',
          new EvmConnector({
            chain: 'horizen',
            chainId: config.get<number>('horizen.chainId')!,
            chainName: 'Horizen Testnet',
            rpcUrl: config.get<string>('horizen.rpcUrl')!,
            explorerUrl: config.get<string>('horizen.explorerUrl')!,
            subgraphUrl: config.get<string>('horizen.subgraphUrl')!,
            senderAddress: config.get<string>('horizen.senderAddress')! as Hex,
            namesAddress: config.get<string>('horizen.namesAddress')! as Hex,
            faucetUrl: config.get<string>('horizen.faucetUrl')!,
            deployerKey: config.get<string>('horizen.deployerKey')! as Hex,
            tokens: config.get('horizen.tokens')!,
          }),
        );

        registry.register(
          'stellar',
          new StellarConnector({
            chain: 'stellar',
            networkPassphrase: config.get<string>('stellar.networkPassphrase')!,
            horizonUrl: config.get<string>('stellar.horizonUrl')!,
            sorobanUrl: config.get<string>('stellar.sorobanUrl')!,
            announcerContractId: config.get<string>('stellar.announcerContractId')!,
            namesContractId: '',
            friendbotUrl: config.get<string>('stellar.friendbotUrl')!,
            explorerUrl: 'https://stellar.expert/explorer/testnet',
          }),
        );

        registry.register(
          'solana',
          new SolanaConnector({
            chain: 'solana',
            rpcUrl: config.get<string>('solana.rpcUrl')!,
            explorerUrl: config.get<string>('solana.explorerUrl')!,
            contracts: {
              announcer: config.get<string>('solana.announcerProgramId')!,
              sender: config.get<string>('solana.senderProgramId')!,
              names: config.get<string>('solana.namesProgramId')!,
            },
            cluster: config.get<string>('solana.cluster')! as 'devnet' | 'testnet' | 'mainnet-beta',
          }),
        );

        registry.register(
          'ckb',
          new CKBConnector({
            chain: 'ckb',
            rpcUrl: config.get<string>('ckb.rpcUrl') || 'https://testnet.ckbapp.dev',
            explorerUrl:
              config.get<string>('ckb.explorerUrl') || 'https://pudge.explorer.nervos.org',
            stealthLockCodeHash:
              config.get<string>('ckb.stealthLockCodeHash') ||
              '0x31f6ab9c7e7a26ecba980b838ac3b5bd6c3a2f1b945e75b7cf7e6a46cb19cb87',
            cellDeps: {
              stealthLock: {
                txHash:
                  config.get<string>('ckb.stealthLockCellDepTxHash') ||
                  '0xde1e8e4bed2d1d7102b9ad3d7a74925ace007800ae49498f9c374cb4968dd32b',
                index: 0,
              },
              ckbAuth: {
                txHash:
                  config.get<string>('ckb.ckbAuthCellDepTxHash') ||
                  '0xa0e99b29fd154385815142b76668d5f4ecf30ae85bc2942bd21e9e51b9066f97',
                index: 0,
              },
            },
          }),
        );

        return registry;
      },
      inject: [ConfigService],
    },
  ],
  controllers: [AgentController],
  exports: [AgentService, AgentToolsService, ChainRegistry],
})
export class AgentModule {}
