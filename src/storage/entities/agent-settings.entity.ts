import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('agent_settings')
export class AgentSettingsEntity {
  @PrimaryColumn({ name: 'agent_id' })
  agentId: string;

  @Column({ name: 'auto_withdraw', default: false })
  autoWithdraw: boolean;

  @Column({ name: 'privacy_threshold', type: 'int', default: 50 })
  privacyThreshold: number;

  @Column({ name: 'preferred_withdraw_address', type: 'varchar', nullable: true })
  preferredWithdrawAddress: string | null;

  @Column({ name: 'max_stealth_accumulation', type: 'int', default: 5 })
  maxStealthAccumulation: number;
}
