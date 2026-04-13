import { Entity, PrimaryColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { AgentEntity } from './agent.entity';

@Entity('invoices')
export class InvoiceEntity {
  @PrimaryColumn()
  id: string;

  @Column({ name: 'agent_id' })
  agentId: string;

  @Column()
  amount: string;

  @Column()
  memo: string;

  @Column({ default: 'ETH' })
  asset: string;

  @Column({ default: 'pending' })
  status: string;

  @Column({ name: 'tx_hash', type: 'varchar', nullable: true })
  txHash: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => AgentEntity)
  @JoinColumn({ name: 'agent_id' })
  agent: AgentEntity;
}
