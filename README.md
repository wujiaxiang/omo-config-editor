# OMO Config Editor

A web UI for editing AI agent model mappings and model gateway routing/fallback chains.

> **OMO** = oh-my-openagent, an agent model mapping system for the OpenCode AI framework.  
> **CCR** = Claude Code Router, a model gateway that routes AI client requests to upstream providers.

## What it does

Two editors in one tool:

1. **Agent/Category Model Mapping** — Edit which model each AI agent or task category uses (backed by a JSON config file)
2. **Model Gateway Routing** — Edit the gateway's provider routing rules, fallback chains, and model aliases (backed by the gateway's config database via RPC)

It connects to the gateway's built-in RPC API for safe writes — no direct database manipulation.

## Architecture

```
AI Client (OpenCode / Claude Code CLI / etc.)
  ├── Agent Model Config (JSON file)
  │     └── OMO Config Editor edits this (direct file read/write)
  └── Model Gateway (CCR / LiteLLM / custom)
        └── Gateway Config (SQLite / DB)
              └── OMO Config Editor edits this (RPC API only)
```

- **Agent Model Config**: Maps each agent or task category to a specific model (e.g. `oracle → claude-opus-4.8`, `explore → deepseek-v4-flash`). The framework reads this at startup.
- **Model Gateway**: A reverse proxy that receives requests from AI clients, routes them to upstream providers, handles model aliasing, and manages failover chains when a provider returns errors or rate-limits.

### Backend settings (`server.js`)

The server reads these from `process.env` or hardcoded defaults:

| Setting | Default | Description |
|---|---|---|
| `PORT` | `34560` | HTTP server port |
| `CONFIG_PATH` | `~/.config/opencode/oh-my-openagent.json` | Path to the agent model JSON |
| `CCR_DB_PATH` | `~/.claude-code-router/config.sqlite` | Path to the gateway's SQLite database (read fallback only) |
| `CCR_RPC_URL` | `http://127.0.0.1:3458/api/ccr/rpc` | Gateway RPC endpoint (primary read/write path) |
| `CCR_RPC_ERROR_LOG` | `/var/log/omo-config-editor-ccr-errors.log` | Log file for RPC failures |

## Why this exists

- The agent model JSON is tedious to edit by hand and easy to break.
- The gateway's config database must not be written directly — bypassing schema validation can trigger the gateway's self-heal mechanism, wiping the entire config.
- Two configs that need to stay in sync: "which model does this agent use?" and "which provider/fallback chain serves that model?".
- A single UI makes it practical to manage both at once.

## Features

### Agent/Category Config
- Lists all agents and categories from the JSON config
- Picks available models from `opencode models` (or equivalent CLI; 5-minute cache)
- Saves back to the JSON file

### Gateway Routing Config
- Per-model fallback chains: configure which models to try in sequence when the primary fails
- Provider → Model two-level selector
- Automatically generates the condition expression (`==` with fully-qualified model name — some gateways strip non-`==` operators like `ends-with`)
- Automatically adds no-op rewrites (condition-type rules without rewrites may be marked `inactive` in some gateways, making their fallback chains unreachable)
- Adjustable retry count per chain
- Saves to the gateway's database via RPC (never by direct DB write)

## Quick start

```bash
# Install dependencies (once)
cd omo-config-editor
npm install

# Start the server
node server.js

# Open in browser
# http://localhost:34560
```

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/` | Frontend page |
| GET / POST | `/api/config` | Read / write agent model JSON |
| GET | `/api/models` | List available models (5 min cache) |
| GET | `/api/ccr/config` | Read gateway config (RPC → DB read fallback) |
| POST | `/api/ccr/config` | Write gateway config (RPC only, no direct DB write) |
| GET | `/api/ccr/providers` | List gateway providers |
| GET | `/api/ccr/routes` | List gateway routing rules |

## Design constraints

| Rule | Why |
|---|---|
| ❌ Never write the gateway's DB directly | Bypasses schema validation → gateway's self-heal can wipe the config |
| ❌ Never write the AI client's local settings file | Crosses architecture boundary; client settings belong to the client's domain |
| ✅ Always write gateway config via RPC | RPC validates schema and keeps the gateway's in-memory config in sync |
| ✅ Condition must use `==` with fully-qualified model name | Some gateways (CCR) strip non-`==` operators during config normalization (`Nm()`) |
| ✅ Condition rules need a no-op rewrite | Rules without rewrites can be marked `inactive` (`pTe()` check), skipping their fallback chains |

## File structure

```
omo-config-editor/
├── README.md          ← This file — general project overview
├── AGENTS.md          ← Technical field-by-field design docs (for AI agent reference)
├── server.js          ← Express backend
├── public/
│   └── index.html     ← Frontend (vanilla HTML/JS, no build step)
└── package.json
```

## Related docs (external, not in this repo)

For in-depth understanding of the gateway's internals and debugging methodology, refer to:

- **Gateway config deep-dive**: Provider configuration, rule anatomy, known pitfalls
- **Troubleshooting methodology**: Evidence pyramid, anti-patterns, systematic debugging
- These docs are maintained alongside the deployment environment, not in this repository

## License

MIT
