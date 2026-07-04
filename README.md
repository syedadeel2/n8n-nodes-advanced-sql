# n8n-nodes-advanced-sql

An n8n community node for running SQL against **Microsoft SQL / Azure SQL** and **PostgreSQL** with a
**pluggable enterprise authentication layer** — Azure Managed Identity, service principal, OAuth2 client
credentials, certificate/JWT bearer, static access token, and legacy username/password.

It is a **backward-compatible superset** of the built-in SQL nodes: existing username/password usage keeps
working unchanged, and modern auth is opt-in per credential.

## Highlights

- 🔐 **Azure Managed Identity** via the official [`@azure/identity`](https://www.npmjs.com/package/@azure/identity)
  (`ManagedIdentityCredential`, with opt-in `DefaultAzureCredential` fallback for local dev).
- 🧩 **Pluggable auth strategies** — one class per method, selected by a credential discriminator.
- ♻️ **Token caching + refresh** with single-flight and a 5-minute expiry skew.
- 🛡️ Secrets never logged or emitted in node output; TLS on by default.
- 🔄 Fully backward compatible; legacy credentials map 1:1.

## Install (self-hosted n8n)

```bash
npm install n8n-nodes-advanced-sql
# then install the driver(s) you use (they are optional peer deps):
npm install mssql   # Microsoft SQL / Azure SQL
npm install pg      # PostgreSQL
```

Set `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE` / register the community package per the
[n8n community nodes docs](https://docs.n8n.io/integrations/community-nodes/installation/).

## Develop

```bash
npm install
npm run build     # tsc + copy icons/codex into dist/
npm test          # jest unit + node-execute tests
npm run lint
```

## Project layout

```
credentials/AdvancedSqlApi.credentials.ts   Credential type (multi-auth, displayOptions-gated)
nodes/AdvancedSql/AdvancedSql.node.ts        Node definition + execute()
nodes/AdvancedSql/auth/                       Pluggable auth strategy layer
  factory.ts            authType -> strategy
  TokenCache.ts         in-memory single-flight token cache (5-min skew)
  redact.ts             secret scrubbing for output/errors
  strategies/           Password, ManagedIdentity, ServicePrincipal,
                        OAuth2ClientCredentials, Certificate, ApiKey
nodes/AdvancedSql/db/                          Driver layer (lazy-loaded)
  pool.ts               fingerprinted pool manager + token rotation
  query.ts              parameterised query execution + result mapping
  builders.ts           safe INSERT/UPDATE/DELETE builders
tests/                                         Jest suites (34 tests)
```

## Documentation

The complete engineering design — architecture, credential/node schema, per-method auth flows, sample
implementation code, security model, and the test plan — lives in **[DESIGN.md](DESIGN.md)**.

A ready-to-import example workflow (Managed Identity → Azure SQL) is in
[`examples/advanced-sql-managed-identity.workflow.json`](examples/advanced-sql-managed-identity.workflow.json).

## Status

Working implementation. The package builds (`npm run build`) and its test suite passes (`npm test`,
34 tests). Integration tests against live Azure SQL / SQL Server / Postgres are outlined in `DESIGN.md` §6.2.
