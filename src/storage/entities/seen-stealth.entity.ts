import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('seen_stealth_addresses')
export class SeenStealthEntity {
  @PrimaryColumn()
  address: string;

  @Column({ name: 'agent_id' })
  agentId: string;

  @Column({ default: '0' })
  balance: string;

  @CreateDateColumn({ name: 'first_seen' })
  firstSeen: Date;
}
