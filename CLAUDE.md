# Wraith Spectre — TEE Agent Server

You are building Spectre — the TEE server infrastructure for the Wraith multichain stealth address platform. This is the managed backend that handles agent lifecycle, AI chat, tool execution, and chain operations. It runs on Phala TEE (Intel TDX) hardware.

This repo is INTERNAL — it is never published to npm. It depends on `@wraith-protocol/sdk`.

## What This Server Does

- Creates and manages AI agents with stealth payment capabilities
- Derives agent keys deterministically inside TEE hardware (never stored)
- Routes operations to the correct chain via pluggable chain connectors
- Handles AI chat with Gemini (or developer-provided models) and multi-turn tool calling
- Manages invoices, scheduled payments, notifications, conversations, and agent memory
- Supports multichain agents (one agent ID, keys on multiple chains)

## Reference Code

- `reference/horizen/` — Working Horizen TEE server (`packages/tee/src/`)
- `reference/stellar/` — Working Stellar TEE server (`packages/tee/src/`)
- `reference/docs/` — Full implementation specs

Key reference docs:

- `reference/docs/04-chain-connector-interface.md` — ChainConnector interface
- `reference/docs/05-tee-server.md` — Full server architecture, API, DB schema
- `reference/docs/09-ai-agent-behavior.md` — System prompt, tools, conversation loop

## Implementation Steps

Commit after each step. Each step must build before moving on.

### Step 1 — Scaffold

NestJS project with modules:

```
src/
  main.ts                    # bootstrap, CORS, Swagger
  app.module.ts              # imports all modules
  config/configuration.ts    # centralized env config
  health/                    # GET /health
```

- `package.json` with deps: `@nestjs/*`, `typeorm`, `pg`, `@google/generative-ai`, `viem`, `@wraith-protocol/sdk`
- `tsconfig.json`
- `docker-compose.yml` (app + postgres)

Verify: `pnpm build` compiles, server starts, `/health` responds.

### Step 2 — Database & Storage

TypeORM entities — see `reference/docs/05-tee-server.md` for full schema:

| Entity                   | Key Columns                                                      |
| ------------------------ | ---------------------------------------------------------------- |
| `AgentEntity`            | id, name, **chain** (VARCHAR), ownerWallet, address, metaAddress |
| `ConversationEntity`     | id, agentId, title, createdAt, updatedAt                         |
| `MessageEntity`          | id, conversationId, role, text                                   |
| `InvoiceEntity`          | id, agentId, amount, asset, memo, status, txHash                 |
| `NotificationEntity`     | id, agentId, type, title, body, read                             |
| `ScheduledPaymentEntity` | id, agentId, recipient, amount, asset, interval, status, nextRun |
| `PendingActionEntity`    | id, agentId, type, message                                       |
| `MemoryEntity`           | id, agentId, content, type, importance                           |
| `SeenStealthEntity`      | id, agentId, stealthAddress                                      |
| `AgentSettingsEntity`    | id, agentId, key, value                                          |

The `chain` column on agents is critical — it determines which connector handles the agent.

For multichain agents, store one row per chain: same `name` and `ownerWallet`, different `chain`, `address`, `metaAddress`. Group by a shared `agentGroupId` or just by name + ownerWallet.

`DatabaseService` provides repository access for all entities.

Verify: server starts, tables auto-created in postgres.

### Step 3 — TEE Service

DStack SDK integration for deterministic key derivation:

```ts
class TeeService {
  async deriveAgentPrivateKey(agentId: string, chain: string): Promise<Hex> {
    const raw = await dstack.getKey(`wraith/agent/${agentId}/${chain}`);
    const hash = sha256(raw);
    return `0x${toHex(hash)}`;
  }
}
```

Path includes chain to produce different keys per chain for the same agent ID.

Also: TEE info endpoint (`/tee/info`), attestation endpoint (`/tee/attest/:agentId`).

### Step 4 — Chain Connector Interface

Define the `ChainConnector` interface — see `reference/docs/04-chain-connector-interface.md`:

```ts
interface ChainConnector {
  readonly chain: string;
  deriveKeys(seed: Uint8Array): Promise<DerivedKeys>;
  sendPayment(params): Promise<TxResult>;
  scanPayments(stealthKeys): Promise<DetectedPayment[]>;
  getBalance(address: string): Promise<ChainBalance>;
  withdraw(params): Promise<TxResult>;
  registerName(name, stealthKeys): Promise<TxResult>;
  resolveName(name): Promise<ResolvedName | null>;
  fundWallet(address): Promise<TxResult>;
  getExplorerUrl(type, value): string;
}
```

`ChainRegistry` class with `register(chain, connector)` and `get(chain)`.

### Step 5 — EVM Connector

Port from `reference/horizen/packages/tee/src/agent/tools/agent-tools.service.ts`.

Single class that handles ALL EVM chains via config (chainId, rpcUrl, contracts, subgraphUrl, faucetUrl, tokens).

Key implementations:

- `sendPayment` → `decodeStealthMetaAddress` → `generateStealthAddress` → `writeContract(WraithSender, "sendETH")`
- `scanPayments` → query subgraph → `scanAnnouncements()` → fetch balances
- `withdraw` → `deriveStealthPrivateKey` → `sendTransaction({ to, value: balance - gasCost })` — let viem handle gas estimation, use 2x buffer on gas cost calculation
- `fundWallet` → POST to Caldera faucet API
- `registerName` → `signNameRegistration` → `writeContract(WraithNames, "register")`

### Step 6 — Stellar Connector

Port from `reference/stellar/packages/tee/src/agent/tools/agent-tools.service.ts`.

Key differences from EVM:

- Uses ed25519 / `@stellar/stellar-sdk`
- `sendPayment` → `Operation.createAccount` (Stellar accounts must exist) + Soroban announcer
- `scanPayments` → `sorobanServer.getEvents()` instead of subgraph
- `withdraw` → `deriveStealthPrivateScalar` → `signStellarTransaction` → submit to Horizon
- `fundWallet` → Stellar Friendbot
- Account model differences (minimum balance, trustlines for non-native assets)

### Step 7 — Agent Controller & Service

HTTP API — see `reference/docs/05-tee-server.md` for full endpoint table:

| Method | Path                | Purpose                                       |
| ------ | ------------------- | --------------------------------------------- |
| POST   | `/agent/create`     | Create agent (name, wallet, signature, chain) |
| GET    | `/agents`           | List all agents                               |
| GET    | `/agent/:id`        | Get agent                                     |
| POST   | `/agent/:id/chat`   | Chat with AI agent                            |
| POST   | `/agent/:id/export` | Export key (requires wallet signature)        |
| etc.   |                     | See full table in docs                        |

Agent creation flow:

1. Verify wallet signature
2. Derive keys via TEE → chain connector
3. Fund via chain faucet
4. Store in DB
5. Register .wraith name (best effort)
6. For multichain: repeat steps 2-5 for each chain

Chat flow:

1. Load agent, re-derive keys from TEE
2. Build Gemini chat with system prompt + tool declarations
3. Send user message
4. Loop: execute tool calls → return results → Gemini processes → may call more tools
5. Return final text + tool call log

Error logging: wrap chat handler in try/catch, log errors with agent ID context.

### Step 8 — Tool Definitions & Execution

17 tools — see `reference/docs/09-ai-agent-behavior.md` for all declarations.

System prompt: dynamically built per agent with identity, memories, pending actions. For multichain agents, list all chain identities.

Tool execution routes through chain connector:

```ts
const connector = this.chainRegistry.get(agent.chain);
const result = await connector.sendPayment({ ... });
```

### Step 9 — Supporting Features

- **Notifications**: create, list, mark read, clear. Idempotent `markInvoicePaid` (check status before creating notification)
- **Invoices**: create with payment link, check statuses, mark paid
- **Scheduled payments**: cron-based scheduler, execute due payments via connector
- **Conversations**: CRUD, message history
- **Agent memory**: `save_memory` tool stores facts, loaded into system prompt
- **Faucet integration**: per-chain (Caldera for EVM, Friendbot for Stellar)

### Step 10 — Docker & Deployment

```dockerfile
FROM node:22-alpine
RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

`docker-compose.yml`:

```yaml
services:
  app:
    image: wraith-protocol/spectre:latest
    ports: ['3000:3000']
    volumes: ['/var/run/dstack.sock:/var/run/dstack.sock']
    environment:
      - DATABASE_URL=postgresql://wraith:${POSTGRES_PASSWORD}@db:5432/wraith
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - DEPLOYER_KEY=${DEPLOYER_KEY}
    depends_on:
      db: { condition: service_healthy }
  db:
    image: postgres:16-alpine
    volumes: [pgdata:/var/lib/postgresql/data]
```

Build for TEE: `docker buildx build --platform linux/amd64 --push ...`

## Final Structure

```
spectre/
  package.json
  tsconfig.json
  nest-cli.json
  Dockerfile
  docker-compose.yml
  .env.example
  src/
    main.ts
    app.module.ts
    config/
      configuration.ts
    tee/
      tee.module.ts
      tee.service.ts
      tee.controller.ts
    connectors/
      chain-connector.interface.ts
      chain-registry.ts
      evm.connector.ts
      stellar.connector.ts
    agent/
      agent.module.ts
      agent.controller.ts
      agent.service.ts
      tools/
        tool-definitions.ts
        agent-tools.service.ts
    storage/
      storage.module.ts
      database.service.ts
      entities/
        agent.entity.ts
        conversation.entity.ts
        message.entity.ts
        invoice.entity.ts
        notification.entity.ts
        scheduled-payment.entity.ts
        pending-action.entity.ts
        memory.entity.ts
        seen-stealth.entity.ts
        agent-settings.entity.ts
    notifications/
      notification.module.ts
      notification.service.ts
      notification.controller.ts
    scheduler/
      scheduler.module.ts
      scheduler.service.ts
    health/
      health.module.ts
      health.controller.ts
  reference/                      # DO NOT MODIFY
    horizen/                      # existing Horizen TEE
    stellar/                      # existing Stellar TEE
    docs/                         # implementation specs
```

## Code Quality Tooling

### Prettier

Add `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

Add `.prettierignore`:

```
dist
node_modules
reference
```

Add scripts to `package.json`:

```json
{
  "format": "prettier --write .",
  "format:check": "prettier --check ."
}
```

### Husky + Commitlint

Install: `husky`, `@commitlint/cli`, `@commitlint/config-conventional`, `prettier`

Add `commitlint.config.js`:

```js
module.exports = { extends: ['@commitlint/config-conventional'] };
```

Husky hooks:

- `.husky/pre-commit`: `pnpm format:check && pnpm build`
- `.husky/commit-msg`: `npx --no -- commitlint --edit $1`

### CI

Add `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run format:check
      - run: pnpm build
```

## README

Create a README.md covering: what Spectre is (TEE agent server for Wraith Protocol), architecture overview, supported chains, API endpoints summary, environment variables, Docker setup, and deployment instructions. Mark it as internal/not published. Keep it concise and technical.

## Rules

- NEVER add Co-Authored-By lines to commits
- NEVER commit, modify, or delete anything in the reference/ folder — it is gitignored and read-only
- NEVER add numbered step comments in code
- NEVER strip existing NatSpec/docs from reference code when porting
- All commit messages MUST follow conventional commits format (feat:, fix:, chore:, docs:, test:, refactor:)
- Commit after each completed step
- Push to origin after each completed step
- This repo is internal — never publish to npm
- Chain connectors MUST implement the ChainConnector interface
- Keys are NEVER stored in the database — always derived from TEE on demand
- Withdrawal must let viem/stellar-sdk handle gas estimation — use 2x buffer on gas cost, subtract from balance
- Invoice paid notifications must be idempotent (check if already paid before creating)
- Chat errors must be logged with agent ID context
