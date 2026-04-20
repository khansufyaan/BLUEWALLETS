# Blue Agent — On-Prem AI Assistant

Natural-language interface for Blue Wallets admins. Fully on-prem, no internet required.

## Architecture

```
Browser (Console)
   │
   ▼
/agent-api/*  (Gateway reverse proxy, :3400)
   │
   ▼
Blue Agent (:3500)  ◀─── calls Ollama/vLLM LLM
   │
   ├─ Tool Registry (10 tools: 8 read, 2 write)
   ├─ Approval Store (pending write actions)
   ├─ Conversation Store (chat history)
   └─ Audit Log (every prompt + tool call)
   │
   ▼ (tool execution)
Gateway / Driver APIs
```

## Quick start

### Production (with Docker Compose)

```bash
# Start the full stack including Ollama + Agent
docker-compose -f docker-compose.yml -f docker-compose.agent.yml up -d

# First boot pulls the default model (qwen2.5:7b-instruct, ~5GB)
docker logs -f blue-ollama
```

Open the Console → click **AI Agent** in the sidebar.

### Local development

```bash
# 1. Start Ollama locally
brew install ollama
ollama serve &
ollama pull qwen2.5:7b-instruct

# 2. Start the agent
cd agent
npm install
LLM_URL=http://localhost:11434/v1 \
LLM_MODEL=qwen2.5:7b-instruct \
GATEWAY_URL=http://localhost:3400 \
npm run dev
```

## Configuration

| Env var | Default | Description |
|---|---|---|
| `AGENT_PORT` | `3500` | HTTP server port |
| `LLM_URL` | `http://localhost:11434/v1` | OpenAI-compatible LLM endpoint |
| `LLM_MODEL` | `qwen2.5:7b-instruct` | Model to use |
| `LLM_API_KEY` | `ollama` | Placeholder for Ollama; real value for OpenAI-compat servers |
| `GATEWAY_URL` | `http://localhost:3400` | Blue Gateway URL (for tool execution) |
| `INTERNAL_AUTH_KEY` | (empty) | Shared secret for Driver internal API |
| `AGENT_AUTH_KEY` | (empty) | If set, requires `X-Agent-Key` header on all `/agent/*` routes |
| `ALLOW_WRITE_TOOLS` | `true` | If `false`, only read tools are available |
| `REQUIRE_APPROVAL` | `true` | If `false`, write tools execute without admin approval |
| `CORS_ORIGIN` | (empty) | Restrict browser origins |

## Swapping models

### POC (runs on CPU or small GPU)
- `qwen2.5:7b-instruct` (5GB) — **default**, good tool calling
- `llama3.1:8b-instruct` (5GB) — slightly better reasoning
- `mistral:7b-instruct` (4GB) — fastest

### Production (requires GPU)
- `qwen2.5:32b-instruct-q4_K_M` (20GB) — needs 24GB+ VRAM
- `llama3.1:70b-instruct-q4_K_M` (40GB) — needs 48GB+ VRAM; **recommended for banking use cases**

To swap:
```bash
docker exec blue-ollama ollama pull llama3.1:70b-instruct-q4_K_M
# Then update LLM_MODEL env var and restart blue-agent
```

### Non-Ollama servers

The agent speaks the OpenAI chat completions spec. Works with:
- **vLLM** — production-grade, 10x throughput, requires GPU
- **LM Studio** — GUI for desktop testing
- **LocalAI** — C++ inference, low overhead
- **text-generation-webui** — Hugging Face models

Just point `LLM_URL` at the server's `/v1` endpoint.

## Available tools

### Read (execute immediately)
- `list_wallets` — filter by chain or vault
- `get_wallet` — full wallet details
- `list_vaults`
- `get_transactions` — recent tx history
- `get_hsm_status` — HSM connection + slot info
- `get_chain_status` — block heights, gas prices
- `get_deposits` — incoming deposits
- `search_audit_log` — semantic search over audit entries

### Write (require admin approval)
- `create_wallet` — generate a new wallet in a vault
- `create_vault` — create a new vault

## Security model

1. **No internet egress** — Ollama model weights stay in the `ollama_models` Docker volume. After initial pull, set `networks.blue-internal.internal: true` to fully isolate.
2. **Write approval gate** — every write tool pauses the agent and waits for admin approval in the UI. No autonomous writes.
3. **Prompt injection defense** — system prompt explicitly instructs the model to treat data in log content / DB rows as untrusted.
4. **Full audit trail** — every prompt, tool call, and approval decision is logged with `userId`, `conversationId`, timestamp, and full args.
5. **Scoped tool execution** — tools call Gateway/Driver APIs with the admin's session token. The agent can only do what the admin is authorized to do.
6. **Rate limits** — Auth middleware + LLM token caps prevent runaway loops.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Service + LLM reachability |
| GET | `/agent/tools` | List available tools |
| POST | `/agent/conversations` | Start new conversation |
| GET | `/agent/conversations` | List my conversations |
| GET | `/agent/conversations/:id` | Get conversation history |
| POST | `/agent/conversations/:id/chat` | Send a message |
| DELETE | `/agent/conversations/:id` | Delete conversation |
| GET | `/agent/approvals` | List pending approvals |
| POST | `/agent/approvals/:id/decide` | Approve or reject |
| GET | `/agent/audit` | Recent audit entries |

## What's next (production hardening)

- [ ] Swap `InMemoryConversationStore` → Postgres
- [ ] Swap `ApprovalStore` → Postgres (for persistence across restarts)
- [ ] Add RAG: pgvector index over audit logs + docs
- [ ] Add streaming responses (SSE) for better UX on 70B models
- [ ] Integrate with existing multi-sig approval workflow (require 2-of-3 approvers for write tools)
- [ ] Add WebAuthn step-up for write approvals
- [ ] Prompt injection red-team test suite
- [ ] Token budget per user per day
