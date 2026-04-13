import { Entity, PrimaryColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { AgentEntity } from './agent.entity';

@Entity('scheduled_payments')
export class ScheduledPaymentEntity {
  @PrimaryColumn()
  id: string;

  @Column({ name: 'agent_id' })
  agentId: string;

  @Column()
  recipient: string;

  @Column()
  amount: string;

  @Column({ default: 'ETH' })
  asset: string;

  @Column({ type: 'varchar', nullable: true })
  memo: string | null;

  @Column()
  cron: string;

  @Column({ name: 'next_run', type: 'int' })
  nextRun: number;

  @Column({ name: 'last_run', type: 'int', nullable: true })
  lastRun: number | null;

  @Column({ name: 'ends_at', type: 'int', nullable: true })
  endsAt: number | null;

  @Column({ default: 'active' })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => AgentEntity)
  @JoinColumn({ name: 'agent_id' })
  agent: AgentEntity;
}
