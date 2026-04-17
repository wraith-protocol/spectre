import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationModule } from '../notifications/notification.module';
import { ChainRegistry } from '../connectors/chain-registry';
import { EvmConnector } from '../connectors/evm/evm.connector';
import { StellarConnector } from '../connectors/stellar/stellar.connector';
import { SolanaConnector } from '../connectors/solana/solana.connector';
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

        return registry;
      },
      inject: [ConfigService],
    },
  ],
  controllers: [AgentController],
  exports: [AgentService, AgentToolsService, ChainRegistry],
})
export class AgentModule {}
