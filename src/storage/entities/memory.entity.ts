import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('agent_memory')
export class MemoryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'agent_id' })
  agentId: string;

  @Column()
  type: string;

  @Column('text')
  content: string;

  @Column({ default: 1 })
  importance: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
