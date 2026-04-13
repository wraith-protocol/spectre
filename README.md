# Wraith Spectre — TEE Agent Server

> **Internal** — not published to npm.

Spectre is the TEE server infrastructure for the Wraith multichain stealth address platform. It runs on Phala TEE (Intel TDX) hardware and handles agent lifecycle, AI chat, tool execution, and chain operations.

## Architecture

```
Client SDK → Spectre TEE Server → Chain Connectors → Blockchains
                  ↓
              PostgreSQL
```

- **NestJS** application with modular architecture
- **TypeORM** with PostgreSQL for persistence
- **Phala DStack SDK** for deterministic key derivation inside TEE
- **Google Gemini** for AI chat with multi-turn tool calling
- **Chain connectors** for EVM (Horizen) and Stellar

## Supported Chains

| Chain   | Family  | Status | Native Asset |
| ------- | ------- | ------ | ------------ |
| Horizen | EVM     | Live   | ETH          |
| Stellar | Stellar | Live   | XLM          |

## API Endpoints

| Method | Path                                        | Purpose              |
| ------ | ------------------------------------------- | -------------------- |
| GET    | `/health`                                   | TEE runtime status   |
| GET    | `/tee/info`                                 | TEE environment info |
| GET    | `/tee/attest/:agentId`                      | TEE attestation      |
| POST   | `/agent/create`                             | Create agent         |
| GET    | `/agents`                                   | List all agents      |
| GET    | `/agent/:id`                                | Get agent            |
| GET    | `/agent/info/:name`                         | Get by .wraith name  |
| GET    | `/agent/wallet/:address`                    | Get by wallet        |
| GET    | `/agent/:id/status`                         | Agent status         |
| POST   | `/agent/:id/export`                         | Export private key   |
| POST   | `/agent/:id/chat`                           | Chat with AI agent   |
| GET    | `/invoice/:id`                              | Get invoice          |
| POST   | `/invoice/:id/paid`                         | Mark invoice paid    |
| GET    | `/agent/:id/conversations`                  | List conversations   |
| POST   | `/agent/:id/conversations`                  | Create conversation  |
| GET    | `/agent/:id/conversations/:convId/messages` | Get messages         |
| DELETE | `/agent/:id/conversations/:convId`          | Delete conversation  |
| GET    | `/agent/:id/notifications`                  | Get notifications    |
| POST   | `/agent/:id/notifications/read`             | Mark all read        |
| DELETE | `/agent/:id/notifications`                  | Delete all           |

## Environment Variables

See `.env.example` for all configuration options.

## Development

```bash
pnpm install
pnpm start:dev
```

## Docker

```bash
docker compose up -d
```

## Deployment (Phala TEE)

```bash
docker buildx build --platform linux/amd64 -t wraith-protocol/spectre:latest --push .
phala deploy --cvm-id <app_id>
```

## Security

- Agent keys are derived deterministically inside TEE hardware and **never stored** in the database
- Every payment goes to a fresh one-time stealth address
- Remote attestation proves code integrity
- Wallet signature verification required for agent creation and key export
