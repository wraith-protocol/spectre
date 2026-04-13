import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentEntity } from './entities/agent.entity';
import { ConversationEntity } from './entities/conversation.entity';
import { MessageEntity } from './entities/message.entity';
import { InvoiceEntity } from './entities/invoice.entity';
import { NotificationEntity } from './entities/notification.entity';
import { ScheduledPaymentEntity } from './entities/scheduled-payment.entity';
import { SeenStealthEntity } from './entities/seen-stealth.entity';
import { MemoryEntity } from './entities/memory.entity';
import { PendingActionEntity } from './entities/pending-action.entity';
import { AgentSettingsEntity } from './entities/agent-settings.entity';
import { DatabaseService } from './database.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentEntity,
      ConversationEntity,
      MessageEntity,
      InvoiceEntity,
      NotificationEntity,
      ScheduledPaymentEntity,
      SeenStealthEntity,
      MemoryEntity,
      PendingActionEntity,
      AgentSettingsEntity,
    ]),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService, TypeOrmModule],
})
export class StorageModule {}
