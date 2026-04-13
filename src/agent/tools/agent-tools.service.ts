import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ChainRegistry } from '../../connectors/chain-registry';
import { ChainConnector, ChainStealthKeys } from '../../connectors/chain-connector.interface';
import { DatabaseService } from '../../storage/database.service';
import { NotificationService } from '../../notifications/notification.service';
import { AgentEntity } from '../../storage/entities/agent.entity';

@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger(AgentToolsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly notifs: NotificationService,
    private readonly chainRegistry: ChainRegistry,
  ) {}

  async executeTool(
    toolName: string,
    args: Record<string, any>,
    agentId: string,
    agent: AgentEntity,
    address: string,
    stealthKeys: ChainStealthKeys,
    clientOrigin?: string,
  ): Promise<{ result: Record<string, unknown>; status?: string; detail?: string }> {
    let result: Record<string, unknown> = {};
    let detail = '';
    let status = 'ok';
    const connector = this.chainRegistry.get(agent.chain);

    try {
      switch (toolName) {
        case 'send_payment': {
          const sendAsset = ((args.asset as string) || '').toUpperCase() || undefined;
          const txResult = await connector.sendPayment({
            senderKeys: stealthKeys,
            senderAddress: address,
            recipientMetaAddress: args.recipient,
            amount: args.amount,
            asset: sendAsset,
          });
          result = {
            ...txResult,
            amount: args.amount,
            asset: sendAsset,
            recipient: args.recipient,
          };
          detail = `Sent ${args.amount} to ${args.recipient}`;
          await this.notifs.create(agentId, 'payment_sent', 'Payment Sent', detail);
          break;
        }
        case 'scan_payments': {
          const payments = await connector.scanPayments(stealthKeys);
          result = { payments, count: payments.length };
          detail = `Found ${payments.length} stealth payment(s)`;
          if (payments.length > 0) {
            await this.notifs.create(
              agentId,
              'payment_received',
              'Payments Detected',
              `Found ${payments.length} incoming stealth payment(s).`,
            );
          }
          break;
        }
        case 'get_balance': {
          const balance = await connector.getBalance(address);
          const assets = Object.entries(balance.tokens).map(([asset, bal]) => ({
            asset,
            balance: bal,
          }));
          result = { address, balance: balance.native, assets };
          detail = assets.map((a) => `${a.balance} ${a.asset}`).join(', ') || balance.native;
          break;
        }
        case 'create_invoice': {
          const invoiceId = randomUUID();
          const invoiceAsset = args.asset || 'native';
          await this.db.invoices.save({
            id: invoiceId,
            agentId,
            amount: args.amount,
            memo: args.memo,
            asset: invoiceAsset,
            status: 'pending',
          });
          const payUrl = `${clientOrigin || 'https://wraith.vercel.app'}/pay/invoice/${invoiceId}`;
          result = {
            invoiceId,
            payTo: `${agent.name}.wraith`,
            amount: args.amount,
            memo: args.memo,
            status: 'pending',
            paymentLink: payUrl,
            markdownLink: `[Pay ${args.amount} →](${payUrl})`,
          };
          detail = `Invoice created for ${args.amount}`;
          break;
        }
        case 'check_invoices': {
          const allInvoices = await this.db.invoices.find({ where: { agentId } });
          const pendingCount = allInvoices.filter((i) => i.status === 'pending').length;
          const paidCount = allInvoices.filter((i) => i.status === 'paid').length;
          result = {
            summary: { total: allInvoices.length, pending: pendingCount, paid: paidCount },
            invoices: allInvoices.map((i) => ({
              id: i.id,
              amount: i.amount,
              memo: i.memo,
              status: i.status,
              txHash: i.txHash || null,
              txLink: i.txHash ? connector.getExplorerUrl('tx', i.txHash) : null,
            })),
          };
          detail = `Invoices: ${paidCount} paid, ${pendingCount} pending`;
          break;
        }
        case 'resolve_name': {
          const resolved = await connector.resolveName(args.name);
          result = resolved
            ? { metaAddress: resolved.metaAddress, address: resolved.address }
            : { error: `Name "${args.name}" not found` };
          detail = resolved
            ? `Resolved to ${resolved.metaAddress.slice(0, 20)}...`
            : `Name "${args.name}" not found`;
          if (!resolved) status = 'error';
          break;
        }
        case 'register_name': {
          const txResult = await connector.registerName(args.name, stealthKeys);
          result = { name: args.name, ...txResult };
          detail = `Registered name "${args.name}.wraith"`;
          break;
        }
        case 'get_agent_info': {
          const balance = await connector.getBalance(address);
          const assets = Object.entries(balance.tokens).map(([asset, bal]) => ({
            asset,
            balance: bal,
          }));
          result = {
            name: `${agent.name}.wraith`,
            address,
            metaAddress: agent.metaAddress,
            chain: agent.chain,
            runtime: 'Phala TEE (Intel TDX)',
            balance: balance.native,
            assets,
          };
          detail = `Agent info for ${agent.name}.wraith`;
          break;
        }
        case 'fund_wallet': {
          try {
            const txResult = await connector.fundWallet(address);
            result = { success: true, message: 'Wallet funded via faucet', ...txResult };
            detail = 'Wallet funded via faucet';
          } catch (err: any) {
            result = { success: false, error: err.message };
            detail = 'Faucet request failed';
            status = 'error';
          }
          break;
        }
        case 'pay_agent': {
          const recipientName = (args.agent_name as string).replace(/\.wraith$/, '');
          const payAsset = ((args.asset as string) || '').toUpperCase() || undefined;
          const txResult = await connector.sendPayment({
            senderKeys: stealthKeys,
            senderAddress: address,
            recipientMetaAddress: recipientName,
            amount: args.amount,
            asset: payAsset,
          });
          result = { ...txResult, amount: args.amount, recipient: recipientName };
          detail = `Paid ${args.amount} to ${recipientName}.wraith`;
          await this.notifs.create(agentId, 'payment_sent', 'Agent Payment Sent', detail);
          break;
        }
        case 'withdraw': {
          const txResult = await connector.withdraw({
            stealthKeys,
            from: args.from,
            to: args.to,
            amount: args.amount,
          });
          result = { ...txResult, from: args.from, to: args.to };
          detail = `Withdrew from ${args.from}`;
          await this.notifs.create(agentId, 'withdrawal', 'Withdrawal Complete', detail);
          break;
        }
        case 'withdraw_all': {
          const withdrawResult = await connector.withdrawAll(stealthKeys, args.to);
          result = {
            results: withdrawResult.results,
            count: withdrawResult.results.length,
            totalWithdrawn: withdrawResult.totalWithdrawn,
          };
          detail = `Withdrew from ${withdrawResult.results.length} address(es)`;
          break;
        }
        case 'privacy_check': {
          result = await this.privacyCheck(connector, stealthKeys, agentId);
          detail = `Privacy score: ${result.privacyScore}/100`;
          break;
        }
        case 'schedule_payment': {
          result = await this.schedulePayment(agentId, args);
          detail = `Scheduled ${args.amount} to ${args.recipient}`;
          if (result.scheduleId) {
            await this.notifs.create(
              agentId,
              'schedule_created',
              'Payment Scheduled',
              `${args.amount} to ${args.recipient} — ${args.interval}.`,
            );
          }
          break;
        }
        case 'list_schedules': {
          const schedules = await this.db.schedules.find({
            where: { agentId, status: 'active' },
            order: { createdAt: 'DESC' },
          });
          result = {
            count: schedules.length,
            schedules: schedules.map((s) => ({
              id: s.id.slice(0, 8),
              recipient: s.recipient,
              amount: s.amount,
              frequency: s.cron,
              status: s.status,
              nextPayment:
                s.status === 'active' ? new Date(s.nextRun * 1000).toLocaleString() : '—',
            })),
          };
          detail = `${schedules.length} scheduled payment(s)`;
          break;
        }
        case 'manage_schedule': {
          result = await this.manageSchedule(agentId, args.schedule_id, args.action);
          detail = `Schedule ${args.action}d`;
          break;
        }
        case 'save_memory': {
          await this.db.memory.save({
            agentId,
            type: args.type || 'fact',
            content: args.content,
            importance: args.importance || 3,
          });
          result = { saved: true, content: args.content };
          detail = `Memory saved: ${(args.content as string).slice(0, 50)}`;
          break;
        }
        default:
          result = { error: `Unknown tool: ${toolName}` };
          status = 'error';
      }
    } catch (err: any) {
      this.logger.error(`Tool ${toolName} failed: ${err.message}`);
      result = { error: err.message };
      status = 'error';
      detail = err.message;
    }

    return { result, status, detail };
  }

  private async privacyCheck(
    connector: ChainConnector,
    stealthKeys: ChainStealthKeys,
    agentId: string,
  ) {
    const payments = await connector.scanPayments(stealthKeys);
    const issues: Array<{ severity: string; issue: string; recommendation: string }> = [];
    let privacyScore = 100;

    if (payments.length > 0) {
      const balances = payments.map((p) => parseFloat(p.balance)).filter((b) => b > 0);
      if (balances.length > 5) {
        issues.push({
          severity: 'medium',
          issue: `${balances.length} unspent stealth addresses`,
          recommendation: 'Withdraw periodically with time delays.',
        });
        privacyScore -= 10;
      }
      const uniqueBalances = new Set(balances.map((b) => b.toFixed(4)));
      if (balances.length > 2 && uniqueBalances.size < balances.length * 0.5) {
        issues.push({
          severity: 'medium',
          issue: 'Similar balances across addresses',
          recommendation: 'Vary payment amounts to avoid correlation.',
        });
        privacyScore -= 15;
      }
    }

    const agent = await this.db.agents.findOneBy({ id: agentId });
    if (agent?.ownerWallet) {
      issues.push({
        severity: 'info',
        issue: 'Connected wallet is public',
        recommendation: `Never withdraw stealth funds to ${agent.ownerWallet.slice(0, 8)}...`,
      });
    }

    return {
      privacyScore: Math.max(0, privacyScore),
      rating: privacyScore >= 80 ? 'Good' : privacyScore >= 50 ? 'Fair' : 'Poor',
      addressCount: payments.length,
      issues,
      bestPractices: [
        'Use a fresh destination for each withdrawal',
        'Space withdrawals at least 1 hour apart',
        'Never withdraw to your connected wallet',
        'Vary payment amounts to avoid correlation',
      ],
    };
  }

  private async schedulePayment(agentId: string, args: any) {
    const interval = (args.interval as string).toLowerCase();
    const intervalSecs: Record<string, number> = {
      hourly: 3600,
      daily: 86400,
      weekly: 604800,
      monthly: 2592000,
    };
    if (!intervalSecs[interval])
      return { error: 'Invalid interval. Use: hourly, daily, weekly, monthly' };

    const id = randomUUID();
    const nextRun = Math.floor(Date.now() / 1000) + intervalSecs[interval];
    let endsAt: number | null = null;
    if (args.end_date) {
      const parsed = Date.parse(args.end_date);
      if (!isNaN(parsed)) endsAt = Math.floor(parsed / 1000);
    }

    await this.db.schedules.save({
      id,
      agentId,
      recipient: args.recipient,
      amount: args.amount,
      memo: args.memo || null,
      cron: interval,
      nextRun,
      endsAt,
    });

    return {
      scheduleId: id.slice(0, 8),
      recipient: args.recipient,
      amount: args.amount,
      frequency: interval,
      nextPayment: new Date(nextRun * 1000).toLocaleString(),
      endsOn: endsAt ? new Date(endsAt * 1000).toLocaleString() : 'No end date',
      status: 'active',
    };
  }

  private async manageSchedule(agentId: string, scheduleId: string, action: string) {
    const all = await this.db.schedules.find({ where: { agentId } });
    const sched = all.find((s) => s.id.startsWith(scheduleId));
    if (!sched) return { error: 'Schedule not found' };

    if (action === 'pause') {
      await this.db.schedules.update(sched.id, { status: 'paused' });
      return { status: 'paused', id: sched.id.slice(0, 8), recipient: sched.recipient };
    } else if (action === 'resume') {
      const intervalSecs: Record<string, number> = {
        hourly: 3600,
        daily: 86400,
        weekly: 604800,
        monthly: 2592000,
      };
      const nextRun = Math.floor(Date.now() / 1000) + (intervalSecs[sched.cron] || 86400);
      await this.db.schedules.update(sched.id, { status: 'active', nextRun });
      return {
        status: 'active',
        id: sched.id.slice(0, 8),
        recipient: sched.recipient,
        nextPayment: new Date(nextRun * 1000).toLocaleString(),
      };
    } else if (action === 'cancel') {
      await this.db.schedules.update(sched.id, { status: 'cancelled' });
      return { status: 'cancelled', id: sched.id.slice(0, 8), recipient: sched.recipient };
    }
    return { error: 'Invalid action. Use: pause, resume, cancel' };
  }
}
