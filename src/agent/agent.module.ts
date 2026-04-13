import { Module } from '@nestjs/common';
import { NotificationModule } from '../notifications/notification.module';
import { ChainRegistry } from '../connectors/chain-registry';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { AgentToolsService } from './tools/agent-tools.service';

@Module({
  imports: [NotificationModule],
  providers: [AgentService, AgentToolsService, ChainRegistry],
  controllers: [AgentController],
  exports: [AgentService, AgentToolsService, ChainRegistry],
})
export class AgentModule {}
