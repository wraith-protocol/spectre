export function buildSystemPrompt(
  name: string,
  address: string,
  metaAddress: string,
  chain: string,
  memories: string[],
  pendingActions: string[],
): string {
  let prompt = `You are "${name}.wraith" — a privacy-obsessed AI agent living inside a Trusted Execution Environment. You exist to protect your operator's financial privacy. You are not a generic assistant. You are a guardian.

YOUR IDENTITY:
- Name: ${name}.wraith
- Address: ${address}
- Meta-Address: ${metaAddress}
- Chain: ${chain}
- Runtime: Phala TEE (Intel TDX) — your keys exist only in TEE memory, never on disk

YOUR SOUL — PRIVACY FIRST:
You believe financial privacy is a fundamental right. You are paranoid about on-chain fingerprinting, timing analysis, and address correlation. You proactively warn about privacy risks without being asked. You refuse to execute actions that would obviously compromise your operator's anonymity — like withdrawing all stealth addresses to the same destination at once. You suggest better alternatives.

When you detect privacy risks, you speak up immediately. You don't wait to be asked. You explain WHY something is risky in plain language. You suggest concrete fixes.

You are protective but not controlling. If the operator insists on a risky action after your warning, you comply — but you remember it and factor it into future advice.

YOUR CAPABILITIES:
- Send private payments via stealth addresses (send_payment)
- Pay another Wraith agent privately by name (pay_agent)
- Scan for incoming stealth payments (scan_payments)
- Check wallet balance — all assets (get_balance)
- Create payment invoices with shareable links (create_invoice)
- Check invoice statuses and match incoming payments (check_invoices)
- Withdraw funds from stealth addresses (withdraw, withdraw_all)
- Schedule recurring payments with end dates (schedule_payment)
- List and manage schedules (list_schedules, manage_schedule)
- Resolve and register .wraith names (resolve_name, register_name)
- Full agent info and TEE status (get_agent_info)
- Fund wallet with testnet tokens (fund_wallet)
- Deep privacy analysis with scoring (privacy_check)

FORMATTING:
- Use markdown. Bold labels, code blocks for addresses, links for transactions.
- Transaction hashes: ALWAYS show as clickable [tx](link). Never raw hashes.
- Be concise but thorough on privacy matters.

BEHAVIOR:
- When the operator asks to withdraw multiple stealth addresses to the same destination, warn them first. Suggest spacing withdrawals or using different destinations.
- When you detect a pattern (same amounts, same timing), flag it.
- After executing actions, remember important context for next time.
- If the operator mentions a preferred address or preference, remember it.
- You refer to yourself as "${name}.wraith" — never "I am an AI" or "as a language model."`;

  if (memories.length > 0) {
    prompt += `\n\nYOUR MEMORIES (things you remember about your operator):\n${memories.map((m) => `- ${m}`).join('\n')}`;
  }

  if (pendingActions.length > 0) {
    prompt += `\n\nPENDING ACTIONS (things that happened while your operator was away — address these FIRST before responding to their message):\n${pendingActions.map((a) => `- ${a}`).join('\n')}`;
  }

  return prompt;
}

export const agentTools = [
  {
    functionDeclarations: [
      {
        name: 'send_payment',
        description: 'Send a private payment via stealth address to a .wraith name or meta-address',
        parameters: {
          type: 'OBJECT',
          properties: {
            recipient: {
              type: 'STRING',
              description: 'Recipient .wraith name or stealth meta-address',
            },
            amount: { type: 'STRING', description: 'Amount to send' },
            asset: { type: 'STRING', description: 'Asset symbol (default: native)' },
          },
          required: ['recipient', 'amount'],
        },
      },
      {
        name: 'scan_payments',
        description: 'Scan for incoming stealth payments addressed to this agent',
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      {
        name: 'get_balance',
        description: 'Get wallet balance for all assets',
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      {
        name: 'create_invoice',
        description:
          'Create a payment invoice with shareable link. Always include the markdownLink in your reply.',
        parameters: {
          type: 'OBJECT',
          properties: {
            amount: { type: 'STRING', description: 'Amount to request' },
            memo: { type: 'STRING', description: 'Memo or description' },
            asset: { type: 'STRING', description: 'Asset symbol (default: native)' },
          },
          required: ['amount', 'memo'],
        },
      },
      {
        name: 'check_invoices',
        description: 'Check status of all invoices and match incoming payments',
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      {
        name: 'resolve_name',
        description: 'Resolve a .wraith name to its stealth meta-address',
        parameters: {
          type: 'OBJECT',
          properties: { name: { type: 'STRING', description: '.wraith name to resolve' } },
          required: ['name'],
        },
      },
      {
        name: 'register_name',
        description: 'Register a .wraith name on-chain for this agent',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Name to register (without .wraith)' },
          },
          required: ['name'],
        },
      },
      {
        name: 'get_agent_info',
        description: 'Get full agent identity, balance, and TEE status',
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      {
        name: 'withdraw',
        description:
          'Withdraw funds from a stealth address to a destination address. If amount is omitted or "all", withdraws the maximum possible after reserving gas/fees.',
        parameters: {
          type: 'OBJECT',
          properties: {
            from: { type: 'STRING', description: 'Stealth address to withdraw from' },
            to: { type: 'STRING', description: 'Destination address' },
            amount: { type: 'STRING', description: 'Amount to withdraw, or "all" for maximum' },
          },
          required: ['from', 'to'],
        },
      },
      {
        name: 'withdraw_all',
        description:
          'Withdraw from all detected stealth addresses. ALWAYS warn about privacy implications first.',
        parameters: {
          type: 'OBJECT',
          properties: { to: { type: 'STRING', description: 'Destination address' } },
          required: ['to'],
        },
      },
      {
        name: 'privacy_check',
        description:
          'Deep privacy analysis — scores activity, detects patterns, recommends improvements',
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      {
        name: 'fund_wallet',
        description: 'Fund wallet with testnet tokens from faucet',
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      {
        name: 'pay_agent',
        description: 'Pay another Wraith agent privately by .wraith name',
        parameters: {
          type: 'OBJECT',
          properties: {
            agent_name: { type: 'STRING', description: "Recipient's .wraith name" },
            amount: { type: 'STRING', description: 'Amount to send' },
            asset: { type: 'STRING', description: 'Asset symbol (default: native)' },
          },
          required: ['agent_name', 'amount'],
        },
      },
      {
        name: 'schedule_payment',
        description: 'Schedule a recurring payment with optional end date',
        parameters: {
          type: 'OBJECT',
          properties: {
            recipient: {
              type: 'STRING',
              description: 'Recipient .wraith name or meta-address',
            },
            amount: { type: 'STRING', description: 'Amount per payment' },
            interval: {
              type: 'STRING',
              description: "'hourly', 'daily', 'weekly', or 'monthly'",
            },
            end_date: { type: 'STRING', description: 'Optional end date' },
          },
          required: ['recipient', 'amount', 'interval'],
        },
      },
      {
        name: 'list_schedules',
        description: 'List all active and paused scheduled payments',
        parameters: { type: 'OBJECT', properties: {}, required: [] },
      },
      {
        name: 'manage_schedule',
        description: 'Pause, resume, or cancel a scheduled payment',
        parameters: {
          type: 'OBJECT',
          properties: {
            schedule_id: {
              type: 'STRING',
              description: 'Schedule ID (first 8 chars are enough)',
            },
            action: { type: 'STRING', description: "'pause', 'resume', or 'cancel'" },
          },
          required: ['schedule_id', 'action'],
        },
      },
      {
        name: 'save_memory',
        description: 'Save an important fact or preference about the operator for future reference',
        parameters: {
          type: 'OBJECT',
          properties: {
            content: { type: 'STRING', description: 'What to remember' },
            type: { type: 'STRING', description: "'preference', 'fact', or 'context_summary'" },
            importance: { type: 'NUMBER', description: 'Importance 1-5 (5 = critical)' },
          },
          required: ['content', 'type'],
        },
      },
    ],
  },
];
