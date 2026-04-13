import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

@Injectable()
export class DatabaseService {
  constructor(
    @InjectRepository(AgentEntity)
    readonly agents: Repository<AgentEntity>,
    @InjectRepository(ConversationEntity)
    readonly conversations: Repository<ConversationEntity>,
    @InjectRepository(MessageEntity)
    readonly messages: Repository<MessageEntity>,
    @InjectRepository(InvoiceEntity)
    readonly invoices: Repository<InvoiceEntity>,
    @InjectRepository(NotificationEntity)
    readonly notifications: Repository<NotificationEntity>,
    @InjectRepository(ScheduledPaymentEntity)
    readonly schedules: Repository<ScheduledPaymentEntity>,
    @InjectRepository(SeenStealthEntity)
    readonly seenStealth: Repository<SeenStealthEntity>,
    @InjectRepository(MemoryEntity)
    readonly memory: Repository<MemoryEntity>,
    @InjectRepository(PendingActionEntity)
    readonly pendingActions: Repository<PendingActionEntity>,
    @InjectRepository(AgentSettingsEntity)
    readonly settings: Repository<AgentSettingsEntity>,
  ) {}
}
