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

## Documentation

The complete engineering design — architecture, credential/node schema, per-method auth flows, sample
implementation code, security model, and the test plan — lives in **[DESIGN.md](DESIGN.md)**.

A ready-to-import example workflow (Managed Identity → Azure SQL) is in
[`examples/advanced-sql-managed-identity.workflow.json`](examples/advanced-sql-managed-identity.workflow.json).

## Status

Design proposal. See `DESIGN.md` §0 for assumptions and scope.
