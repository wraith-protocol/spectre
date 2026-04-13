import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { AgentService } from './agent.service';
import { DatabaseService } from '../storage/database.service';
import { NotificationService } from '../notifications/notification.service';
import { ChainRegistry } from '../connectors/chain-registry';

@ApiTags('Agent')
@Controller()
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly db: DatabaseService,
    private readonly notifService: NotificationService,
    private readonly chainRegistry: ChainRegistry,
  ) {}

  @Post('agent/create')
  @ApiOperation({ summary: 'Create a new AI agent with TEE-derived keys' })
  async create(
    @Body()
    body: {
      name: string;
      ownerWallet: string;
      signature: string;
      message: string;
      chain: string;
    },
  ) {
    try {
      return await this.agentService.createAgent(
        body.name,
        body.ownerWallet,
        body.signature,
        body.message,
        body.chain,
      );
    } catch (err: any) {
      this.logger.error(`Create agent failed: ${err.message}`);
      throw err;
    }
  }

  @Get('agents')
  @ApiOperation({ summary: 'List all registered agents' })
  async listAgents() {
    return this.agentService.getAllAgents();
  }

  @Get('agent/:id')
  @ApiOperation({ summary: 'Get agent by ID' })
  async getAgent(@Param('id') id: string) {
    const agent = await this.agentService.getAgent(id);
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  @Get('agent/info/:name')
  @ApiOperation({ summary: 'Get agent by .wraith name' })
  async getAgentByName(@Param('name') name: string) {
    const agent = await this.agentService.getAgentByName(name);
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  @Get('agent/wallet/:address')
  @ApiOperation({ summary: 'Get agents by owner wallet address' })
  async getAgentByWallet(@Param('address') address: string) {
    const agents = await this.agentService.getAgentByWallet(address);
    if (!agents) throw new NotFoundException('No agent found for this wallet');
    return agents;
  }

  @Get('agent/:id/status')
  @ApiOperation({ summary: 'Get agent status — balance, invoices, schedules' })
  async getStatus(@Param('id') id: string) {
    return this.agentService.getAgentStatus(id);
  }

  @Post('agent/:id/export')
  @ApiOperation({ summary: 'Export agent private key (requires owner signature)' })
  async exportKey(@Param('id') id: string, @Body() body: { signature: string; message: string }) {
    return this.agentService.exportAgentKey(id, body.signature, body.message);
  }

  @Post('agent/:id/chat')
  @ApiOperation({ summary: 'Chat with agent via Gemini AI' })
  async chat(
    @Param('id') id: string,
    @Body()
    body: {
      message: string;
      history?: any[];
      conversationId?: string;
      clientOrigin?: string;
    },
    @Req() req: any,
  ) {
    try {
      let convId = body.conversationId;
      if (!convId) {
        convId = randomUUID();
        const title = body.message.length > 50 ? body.message.slice(0, 50) + '...' : body.message;
        await this.db.conversations.save({ id: convId, agentId: id, title });
      }

      const clientOrigin = body.clientOrigin || req.headers?.origin || 'https://wraith.vercel.app';
      const result = await this.agentService.chat(
        id,
        body.message,
        body.history || [],
        clientOrigin,
      );

      await this.db.messages.save({ conversationId: convId, role: 'user', text: body.message });
      if (result.response) {
        await this.db.messages.save({
          conversationId: convId,
          role: 'agent',
          text: result.response,
        });
      }
      for (const tc of result.toolCalls || []) {
        await this.db.messages.save({
          conversationId: convId,
          role: 'tool',
          text: `${tc.name}\n${tc.detail || tc.status}`,
        });
      }
      await this.db.conversations.update(convId, { updatedAt: new Date() });

      return { ...result, conversationId: convId };
    } catch (err: any) {
      this.logger.error(`Chat error (agent=${id.slice(0, 8)}): ${err.message}`);
      throw err;
    }
  }

  @Get('invoice/:id')
  @ApiOperation({ summary: 'Get invoice by ID' })
  async getInvoice(@Param('id') id: string) {
    const invoice = await this.db.invoices.findOne({ where: { id }, relations: ['agent'] });
    if (!invoice) return { error: 'Invoice not found' };
    return {
      id: invoice.id,
      agentName: invoice.agent.name,
      amount: invoice.amount,
      memo: invoice.memo,
      status: invoice.status,
      metaAddress: invoice.agent.metaAddress,
      chain: invoice.agent.chain,
      txHash: invoice.txHash || null,
    };
  }

  @Post('invoice/:id/paid')
  @ApiOperation({ summary: 'Mark invoice as paid' })
  async markInvoicePaid(@Param('id') id: string, @Body() body: { txHash?: string }) {
    const invoice = await this.db.invoices.findOne({ where: { id }, relations: ['agent'] });
    if (!invoice) return { updated: false };
    if (invoice.status === 'paid') return { updated: false, message: 'Invoice already paid' };

    await this.db.invoices.update(id, { status: 'paid', txHash: body.txHash || null });

    const connector = this.chainRegistry.get(invoice.agent.chain);
    const txLink = body.txHash ? connector.getExplorerUrl('tx', body.txHash) : '';

    await this.notifService.create(
      invoice.agentId,
      'invoice_paid',
      'Invoice Paid',
      `Invoice for ${invoice.amount} ("${invoice.memo}") has been paid.${txLink ? ` [tx](${txLink})` : ''}`,
    );

    await this.db.pendingActions.save({
      agentId: invoice.agentId,
      type: 'payment_received',
      message: `Invoice for ${invoice.amount} ("${invoice.memo}") was paid.${txLink ? ` [tx](${txLink})` : ''}`,
    });

    return { updated: true };
  }

  @Get('agent/:id/conversations')
  async getConversations(@Param('id') agentId: string) {
    return this.db.conversations.find({ where: { agentId }, order: { updatedAt: 'DESC' } });
  }

  @Post('agent/:id/conversations')
  async createConversation(@Param('id') agentId: string, @Body() body: { title?: string }) {
    const id = randomUUID();
    return this.db.conversations.save({ id, agentId, title: body.title || 'New Chat' });
  }

  @Get('agent/:id/conversations/:convId/messages')
  async getMessages(@Param('convId') convId: string) {
    return this.db.messages.find({
      where: { conversationId: convId },
      order: { createdAt: 'ASC' },
    });
  }

  @Delete('agent/:id/conversations/:convId')
  async deleteConversation(@Param('convId') convId: string) {
    await this.db.messages.delete({ conversationId: convId });
    await this.db.conversations.delete({ id: convId });
    return { deleted: true };
  }
}
