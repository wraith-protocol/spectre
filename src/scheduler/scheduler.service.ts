import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThanOrEqual } from 'typeorm';
import { DatabaseService } from '../storage/database.service';
import { TeeService } from '../tee/tee.service';
import { ChainRegistry } from '../connectors/chain-registry';
import { NotificationService } from '../notifications/notification.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tee: TeeService,
    private readonly chainRegistry: ChainRegistry,
    private readonly notifs: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async executeScheduledPayments() {
    const now = Math.floor(Date.now() / 1000);

    await this.db.schedules
      .createQueryBuilder()
      .update()
      .set({ status: 'ended' })
      .where('status = :status AND ends_at IS NOT NULL AND ends_at <= :now', {
        status: 'active',
        now,
      })
      .execute();

    const due = await this.db.schedules.find({
      where: { status: 'active', nextRun: LessThanOrEqual(now) },
    });

    for (const sched of due) {
      try {
        const agent = await this.db.agents.findOneBy({ id: sched.agentId });
        if (!agent) continue;

        const connector = this.chainRegistry.get(agent.chain);
        const seed = await this.tee.deriveAgentSeed(sched.agentId, agent.chain);
        const derivedKeys = await connector.deriveKeys(seed);

        await connector.sendPayment({
          senderKeys: derivedKeys.stealthKeys,
          senderAddress: derivedKeys.address,
          recipientMetaAddress: sched.recipient,
          amount: sched.amount,
          asset: sched.asset,
        });

        const intervalSecs: Record<string, number> = {
          hourly: 3600,
          daily: 86400,
          weekly: 604800,
          monthly: 2592000,
        };
        const nextRun = now + (intervalSecs[sched.cron] || 86400);
        await this.db.schedules.update(sched.id, { lastRun: now, nextRun });

        await this.db.pendingActions.save({
          agentId: sched.agentId,
          type: 'schedule_result',
          message: `Scheduled payment executed: sent ${sched.amount} ${sched.asset} to ${sched.recipient}. Next at ${new Date(nextRun * 1000).toLocaleString()}.`,
        });

        await this.notifs.create(
          sched.agentId,
          'scheduled_payment',
          'Scheduled Payment Sent',
          `Auto-paid ${sched.amount} ${sched.asset} to ${sched.recipient}.`,
        );

        this.logger.log(`Scheduled: ${sched.amount} to ${sched.recipient} for agent ${agent.name}`);
      } catch (err: any) {
        this.logger.error(`Schedule ${sched.id} failed: ${err.message}`);

        await this.db.pendingActions.save({
          agentId: sched.agentId,
          type: 'schedule_result',
          message: `Scheduled payment FAILED: could not send ${sched.amount} ${sched.asset} to ${sched.recipient}. Error: ${err.message}`,
        });

        await this.notifs.create(
          sched.agentId,
          'schedule_error',
          'Scheduled Payment Failed',
          `Failed: ${err.message}`,
        );
      }
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async backgroundScan() {
    const agents = await this.db.agents.find();
    if (agents.length === 0) return;

    for (const agent of agents) {
      try {
        const connector = this.chainRegistry.get(agent.chain);
        const seed = await this.tee.deriveAgentSeed(agent.id, agent.chain);
        const derivedKeys = await connector.deriveKeys(seed);

        const payments = await connector.scanPayments(derivedKeys.stealthKeys);
        const seen = await this.db.seenStealth.find({ where: { agentId: agent.id } });
        const seenSet = new Set(seen.map((s) => s.address));

        for (const p of payments) {
          if (!seenSet.has(p.stealthAddress) && parseFloat(p.balance) > 0) {
            await this.db.seenStealth.save({
              address: p.stealthAddress,
              agentId: agent.id,
              balance: p.balance,
            });

            await this.db.pendingActions.save({
              agentId: agent.id,
              type: 'payment_received',
              message: `Received ${p.balance} at stealth address ${p.stealthAddress.slice(0, 8)}...${p.stealthAddress.slice(-4)}. This payment is private and unlinkable.`,
            });

            await this.notifs.create(
              agent.id,
              'payment_received',
              'Payment Received',
              `Received ${p.balance} at stealth address ${p.stealthAddress.slice(0, 8)}...${p.stealthAddress.slice(-4)}.`,
            );

            this.logger.log(`New payment for ${agent.name}.wraith: ${p.balance}`);
          }
        }

        await this.privacyAutoPilot(agent.id, seen.length + payments.length);
      } catch (err: any) {
        this.logger.error(`Scan error for ${agent.name}: ${err.message}`);
      }
    }
  }

  private async privacyAutoPilot(agentId: string, stealthCount: number) {
    const settings = await this.db.settings.findOneBy({ agentId });
    const threshold = settings?.maxStealthAccumulation || 5;
    if (stealthCount <= threshold) return;

    const recentAlert = await this.db.pendingActions.findOne({
      where: { agentId, type: 'privacy_alert', delivered: false },
    });
    if (recentAlert) return;

    await this.db.pendingActions.save({
      agentId,
      type: 'privacy_alert',
      message: `Privacy alert: you have ${stealthCount} stealth addresses with funds (threshold: ${threshold}). I recommend withdrawing some using different destination addresses with time delays between each withdrawal.`,
    });
  }
}
