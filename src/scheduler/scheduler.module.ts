import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { NotificationModule } from '../notifications/notification.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [AgentModule, NotificationModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
