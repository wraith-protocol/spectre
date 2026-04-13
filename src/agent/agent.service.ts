import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { verifyMessage, type Hex } from 'viem';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { DatabaseService } from '../storage/database.service';
import { TeeService } from '../tee/tee.service';
import { ChainRegistry } from '../connectors/chain-registry';
import { NotificationService } from '../notifications/notification.service';
import { AgentToolsService } from './tools/agent-tools.service';
import { agentTools, buildSystemPrompt } from './tools/tool-definitions';

export interface AgentInfo {
  id: string;
  name: string;
  chain: string;
  address: string;
  metaAddress: string;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tee: TeeService,
    private readonly config: ConfigService,
    private readonly chainRegistry: ChainRegistry,
    private readonly notifs: NotificationService,
    private readonly tools: AgentToolsService,
  ) {}

  private async verifyWalletSignature(
    address: string,
    signature: string,
    message: string,
  ): Promise<boolean> {
    try {
      return await verifyMessage({
        address: address as Hex,
        message,
        signature: signature as Hex,
      });
    } catch (err: any) {
      this.logger.error(`Signature verification error: ${err.message}`);
      return false;
    }
  }

  async createAgent(
    name: string,
    ownerWallet: string,
    signature: string,
    message: string,
    chain: string,
  ): Promise<AgentInfo> {
    this.logger.log(
      `createAgent: name=${name}, chain=${chain}, wallet=${ownerWallet?.slice(0, 12)}...`,
    );

    if (!ownerWallet || !signature || !message) {
      throw new BadRequestException('Wallet address, signature, and message are required.');
    }

    const isValid = await this.verifyWalletSignature(ownerWallet, signature, message);
    if (!isValid) {
      throw new BadRequestException('Signature verification failed.');
    }

    const cleanName = name.replace(/\.wraith$/, '');
    const connector = this.chainRegistry.get(chain);
    const id = randomUUID();

    const seed = await this.tee.deriveAgentSeed(id, chain);
    const derivedKeys = await connector.deriveKeys(seed);

    try {
      await connector.fundWallet(derivedKeys.address);
      this.logger.log(`Faucet funded agent ${derivedKeys.address.slice(0, 12)}...`);
    } catch (err: any) {
      this.logger.warn(`Faucet funding failed: ${err.message}`);
    }

    await this.db.agents.save({
      id,
      name: cleanName,
      chain,
      ownerWallet,
      address: derivedKeys.address,
      metaAddress: derivedKeys.metaAddress,
    });

    try {
      await connector.registerName(cleanName, derivedKeys.stealthKeys);
    } catch (err: any) {
      this.logger.warn(`Failed to register name "${cleanName}.wraith": ${err.message}`);
    }

    this.logger.log(`Agent created: ${cleanName}.wraith on ${chain}`);
    return {
      id,
      name: cleanName,
      chain,
      address: derivedKeys.address,
      metaAddress: derivedKeys.metaAddress,
    };
  }

  async getAgent(id: string): Promise<AgentInfo | null> {
    const agent = await this.db.agents.findOneBy({ id });
    if (!agent) return null;
    return {
      id: agent.id,
      name: agent.name,
      chain: agent.chain,
      address: agent.address,
      metaAddress: agent.metaAddress,
    };
  }

  async getAgentByName(name: string): Promise<AgentInfo | null> {
    const cleanName = name.replace(/\.wraith$/, '');
    const agent = await this.db.agents.findOneBy({ name: cleanName });
    if (!agent) return null;
    return {
      id: agent.id,
      name: agent.name,
      chain: agent.chain,
      address: agent.address,
      metaAddress: agent.metaAddress,
    };
  }

  async getAgentByWallet(wallet: string): Promise<AgentInfo[] | null> {
    const agents = await this.db.agents.find({ where: { ownerWallet: wallet } });
    if (agents.length === 0) return null;
    return agents.map((a) => ({
      id: a.id,
      name: a.name,
      chain: a.chain,
      address: a.address,
      metaAddress: a.metaAddress,
    }));
  }

  async getAllAgents() {
    return this.db.agents.find({ order: { createdAt: 'DESC' } });
  }

  async exportAgentKey(agentId: string, signature: string, message: string) {
    if (!signature || !message) {
      throw new BadRequestException('Signature and message are required to export key.');
    }

    const agent = await this.db.agents.findOneBy({ id: agentId });
    if (!agent) throw new NotFoundException('Agent not found');
    if (!agent.ownerWallet) {
      throw new BadRequestException('Agent has no owner wallet.');
    }

    const isValid = await verifyMessage({
      address: agent.ownerWallet as Hex,
      message,
      signature: signature as Hex,
    });
    if (!isValid) {
      throw new BadRequestException('Invalid signature. Must be signed by the agent owner wallet.');
    }

    const privateKey = await this.tee.deriveAgentPrivateKey(agentId, agent.chain);
    return { secret: privateKey };
  }

  async getAgentStatus(agentId: string) {
    const agent = await this.db.agents.findOneBy({ id: agentId });
    if (!agent) return { error: 'Agent not found' };

    const connector = this.chainRegistry.get(agent.chain);
    const balance = await connector.getBalance(agent.address);

    const pendingInvoices = await this.db.invoices.count({
      where: { agentId, status: 'pending' },
    });
    const activeSchedules = await this.db.schedules.count({
      where: { agentId, status: 'active' },
    });
    const unreadNotifications = await this.db.notifications.count({
      where: { agentId, read: false },
    });
    const pendingActionsList = await this.db.pendingActions.find({
      where: { agentId, delivered: false },
      order: { createdAt: 'ASC' },
    });

    const parts: string[] = [];
    parts.push(`**${agent.name}.wraith** is online on ${agent.chain}.`);
    parts.push(`**Balance:** ${balance.native}`);
    if (pendingInvoices > 0) parts.push(`**Pending invoices:** ${pendingInvoices}`);
    if (activeSchedules > 0) parts.push(`**Active schedules:** ${activeSchedules}`);
    if (unreadNotifications > 0) parts.push(`**Unread notifications:** ${unreadNotifications}`);

    if (pendingActionsList.length > 0) {
      parts.push('');
      parts.push('**While you were away:**');
      for (const action of pendingActionsList) {
        parts.push(`- ${action.message}`);
      }
      await this.db.pendingActions.update(
        pendingActionsList.map((a) => a.id),
        { delivered: true },
      );
    }

    return {
      statusMessage: parts.join('\n'),
      balance: balance.native,
      tokens: balance.tokens,
      pendingInvoices,
      activeSchedules,
      unreadNotifications,
      pendingActions: pendingActionsList.length,
    };
  }

  private async loadMemories(agentId: string): Promise<string[]> {
    const memories = await this.db.memory.find({
      where: { agentId },
      order: { importance: 'DESC', createdAt: 'DESC' },
      take: 20,
    });
    return memories.map((m) => `[${m.type}] ${m.content}`);
  }

  private async loadPendingActions(agentId: string): Promise<string[]> {
    const actions = await this.db.pendingActions.find({
      where: { agentId, delivered: false },
      order: { createdAt: 'ASC' },
    });
    if (actions.length > 0) {
      await this.db.pendingActions.update(
        actions.map((a) => a.id),
        { delivered: true },
      );
    }
    return actions.map((a) => `[${a.type}] ${a.message}`);
  }

  private async extractMemories(agentId: string, userMessage: string) {
    const lowerMsg = userMessage.toLowerCase();
    if (
      lowerMsg.includes('always ') ||
      lowerMsg.includes('prefer') ||
      lowerMsg.includes('my address') ||
      lowerMsg.includes('default')
    ) {
      await this.db.memory.save({
        agentId,
        type: 'preference',
        content: userMessage,
        importance: 4,
      });
    }

    const addressMatch = userMessage.match(/0x[a-fA-F0-9]{40}|G[A-Z2-7]{55}/);
    if (
      addressMatch &&
      (lowerMsg.includes('withdraw') ||
        lowerMsg.includes('send to') ||
        lowerMsg.includes('destination'))
    ) {
      await this.db.memory.save({
        agentId,
        type: 'preference',
        content: `Operator mentioned address ${addressMatch[0]} for withdrawals/transfers`,
        importance: 3,
      });
    }
  }

  async chat(
    agentId: string,
    message: string,
    history: Array<{ role: string; text: string }>,
    clientOrigin?: string,
  ) {
    const agent = await this.db.agents.findOneBy({ id: agentId });
    if (!agent) throw new NotFoundException('Agent not found');

    const connector = this.chainRegistry.get(agent.chain);
    const seed = await this.tee.deriveAgentSeed(agentId, agent.chain);
    const derivedKeys = await connector.deriveKeys(seed);

    const memories = await this.loadMemories(agentId);
    const pendingActions = await this.loadPendingActions(agentId);

    const apiKey = this.config.get<string>('gemini.apiKey');
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: buildSystemPrompt(
        agent.name,
        derivedKeys.address,
        agent.metaAddress,
        agent.chain,
        memories,
        pendingActions,
      ),
      tools: agentTools as any,
    });

    const chatHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
    for (const entry of history) {
      if (!entry.text || entry.text.trim() === '') continue;
      const role = entry.role === 'user' ? 'user' : 'model';
      if (chatHistory.length === 0 && role === 'model') continue;
      if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === role) continue;
      chatHistory.push({ role, parts: [{ text: entry.text }] });
    }
    if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') {
      chatHistory.pop();
    }

    const chatSession = model.startChat({ history: chatHistory });
    let result = await chatSession.sendMessage(message);
    const toolCallResults: Array<{ name: string; status: string; detail?: string }> = [];

    let maxIterations = 10;
    while (maxIterations > 0) {
      maxIterations--;
      const candidate = result.response.candidates?.[0];
      if (!candidate) break;

      const parts = candidate.content?.parts ?? [];
      const functionCalls = parts.filter((p: any) => p.functionCall);
      if (functionCalls.length === 0) break;

      const functionResponses: Array<{
        functionResponse: { name: string; response: Record<string, unknown> };
      }> = [];

      for (const part of functionCalls) {
        const fc = (part as any).functionCall;
        const toolResult = await this.tools.executeTool(
          fc.name,
          fc.args || {},
          agentId,
          agent,
          derivedKeys.address,
          derivedKeys.stealthKeys,
          clientOrigin,
        );

        toolCallResults.push({
          name: fc.name,
          status: toolResult.status || 'ok',
          detail: toolResult.detail,
        });

        functionResponses.push({
          functionResponse: { name: fc.name, response: toolResult.result },
        });
      }

      result = await chatSession.sendMessage(functionResponses as any);
    }

    const responseText =
      result.response.candidates?.[0]?.content?.parts
        ?.filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join('\n') || 'I could not generate a response.';

    try {
      await this.extractMemories(agentId, message);
    } catch {}

    return { response: responseText, toolCalls: toolCallResults };
  }
}
