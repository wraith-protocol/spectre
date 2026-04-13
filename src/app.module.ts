import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { AgentEntity } from './storage/entities/agent.entity';
import { ConversationEntity } from './storage/entities/conversation.entity';
import { MessageEntity } from './storage/entities/message.entity';
import { InvoiceEntity } from './storage/entities/invoice.entity';
import { NotificationEntity } from './storage/entities/notification.entity';
import { ScheduledPaymentEntity } from './storage/entities/scheduled-payment.entity';
import { SeenStealthEntity } from './storage/entities/seen-stealth.entity';
import { MemoryEntity } from './storage/entities/memory.entity';
import { PendingActionEntity } from './storage/entities/pending-action.entity';
import { AgentSettingsEntity } from './storage/entities/agent-settings.entity';
import { StorageModule } from './storage/storage.module';
import { TeeModule } from './tee/tee.module';
import { HealthModule } from './health/health.module';

const logger = new Logger('AppModule');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('database.host', 'localhost');
        const port = config.get<number>('database.port', 5432);

        logger.log(`Connecting to PostgreSQL at ${host}:${port}`);

        return {
          type: 'postgres',
          host,
          port,
          database: config.get<string>('database.name', 'wraith'),
          username: config.get<string>('database.user', 'wraith'),
          password: config.get<string>('database.password', 'wraith'),
          entities: [
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
          ],
          synchronize: true,
          retryAttempts: 5,
          retryDelay: 3000,
        };
      },
    }),

    StorageModule,
    TeeModule,
    HealthModule,
  ],
})
export class AppModule {}
