# Advanced SQL Node — Engineering Design

**Package:** `n8n-nodes-advanced-sql`
**Status:** Design proposal
**Target SDK:** n8n `1.x` (`n8n-workflow`, `n8n-core`, patterns from `@n8n/nodes-base`)
**Author:** Platform / Integrations
**Last updated:** 2026-07-04

---

## 0. Scope, assumptions & decisions

Before the design, the assumptions that were inferred from the brief (the brief asked that unclear assumptions be stated explicitly):

| # | Assumption | Rationale |
|---|-----------|-----------|
| A1 | **Primary engine is Microsoft SQL Server / Azure SQL** (driver: [`mssql`](https://www.npmjs.com/package/mssql) → `tedious`). | Azure Managed Identity is the headline requirement, and Azure SQL is the canonical AAD-token consumer. `tedious` natively accepts an AAD access token (`azure-active-directory-access-token`). |
| A2 | **PostgreSQL is a first-class secondary engine** (driver: [`pg`](https://www.npmjs.com/package/pg)). | Azure Database for PostgreSQL / AWS RDS IAM auth also consume bearer tokens (passed as the password). Keeping the driver layer abstract lets one auth layer serve both. |
| A3 | The node runs **inside n8n's own process** (self-hosted or n8n Cloud "programmatic" node), so it may open its own DB sockets and use `azure-identity` directly. | Managed Identity token acquisition requires process-level access to the IMDS endpoint / env; this cannot be delegated to n8n's generic HTTP auth helper. |
| A4 | Backward compatibility means: **existing "Microsoft SQL" / "Postgres" credentials keep working**, and the legacy node is *not removed*. The new node is additive. | Enterprises pin workflows; breaking changes are unacceptable. |
| A5 | Managed Identity is only meaningful when n8n is Azure-hosted; **graceful fallback** to explicit credential types is mandatory for local/hybrid deployments. | Per Azure guidance, `ManagedIdentityCredential` always fails off-Azure. |

**Key design decision — credentials are *programmatic*, not `IAuthenticateGeneric`.**
n8n's `authenticate: IAuthenticateGeneric` and `IHttpRequestOptions` machinery only decorates *HTTP requests* made through `this.helpers.httpRequest`. A SQL driver opens a TCP socket, so the auth token must be injected into the **driver connection config**, not an HTTP header. The design therefore uses `ICredentialType` purely as a **typed secret store + editor UI**, and performs token acquisition/injection in a dedicated **auth strategy layer** invoked from the node's `execute()` (and from `credentialTest`). This mirrors how the n8n Postgres/MSSQL nodes read credential data and build a driver config rather than relying on the HTTP auth hook.

---

## 1. High-level architecture

### 1.1 Component flow

```
┌──────────────────────────────────────────────────────────────────────┐
│  n8n Editor UI                                                         │
│  • AdvancedSql node params (operation, query, params, options)         │
│  • Credential editor rendered from ICredentialType.properties         │
└───────────────┬──────────────────────────────────────────────────────┘
                │ credential ref + node params
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  AdvancedSql.node.ts  ── execute(this: IExecuteFunctions)              │
│    1. getCredentials('advancedSql')      // decrypted secret bag       │
│    2. resolveEngine(creds)               // mssql | postgres          │
│    3. AuthStrategyFactory.create(creds)  // pick strategy by authType  │
└───────────────┬──────────────────────────────────────────────────────┘
                │ IAuthStrategy
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Auth Strategy Layer  (pluggable — one class per authType)            │
│   ┌────────────────────┐  ┌────────────────────┐  ┌────────────────┐  │
│   │ PasswordStrategy   │  │ ManagedIdentity    │  │ OAuth2Client   │  │
│   │ (legacy, no token) │  │ Strategy           │  │ CredsStrategy  │  │
│   └────────────────────┘  │ (azure-identity)   │  └────────────────┘  │
│   ┌────────────────────┐  └────────────────────┘  ┌────────────────┐  │
│   │ ServicePrincipal   │  ┌────────────────────┐  │ CertificateJwt │  │
│   │ Strategy (secret)  │  │ ApiKeyStrategy     │  │ Strategy       │  │
│   └────────────────────┘  └────────────────────┘  └────────────────┘  │
│                                                                        │
│   IAuthStrategy.getConnectionConfig(): Promise<DriverAuthConfig>      │
│                      │  (acquires + caches bearer token if needed)     │
└──────────────────────┼─────────────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  TokenCache (module-scoped, keyed by hash(credId+authType+scope))     │
│   • returns cached AccessToken if expiresOnTimestamp - skew > now      │
│   • single-flight lock to avoid stampede on refresh                    │
└───────────────┬──────────────────────────────────────────────────────┘
                │ token (opaque) never logged, never in node output
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Driver / Pool Layer                                                   │
│   • ConnectionPoolManager (module-scoped, keyed by config fingerprint)│
│   • mssql.ConnectionPool  |  pg.Pool                                   │
│   • parameter binding, result mapping, transactions                    │
└───────────────┬──────────────────────────────────────────────────────┘
                ▼
        Azure SQL / SQL Server / PostgreSQL
```

### 1.2 Request lifecycle (Managed Identity, happy path)

1. `execute()` loads decrypted credentials via `this.getCredentials('advancedSql')`.
2. `AuthStrategyFactory` selects `ManagedIdentityStrategy` from `creds.authentication`.
3. Strategy asks `TokenCache` for a token scoped to `https://database.windows.net/.default`.
4. Cache miss → `new DefaultAzureCredential({ managedIdentityClientId })` → `.getToken(scope)` → `AccessToken { token, expiresOnTimestamp }`. Result cached.
5. Strategy returns a `DriverAuthConfig` with `authentication.type = 'azure-active-directory-access-token'` and the raw token.
6. `ConnectionPoolManager` returns (or creates) an `mssql.ConnectionPool` fingerprinted by host+db+authType (token itself excluded from the fingerprint so refresh reuses the pool where the driver allows, otherwise pool is rebuilt on token change — see §4.4).
7. Query runs with bound parameters; rows mapped to n8n items.
8. Token never appears in output, logs, or error messages.

---

## 2. Node & credential schema

### 2.1 `ICredentialType` — `AdvancedSqlApi`

A **single** credential type with a `authentication` discriminator drives a dynamically-shown field set (the pattern used by n8n's HTTP Request / multi-auth nodes: one credential, `displayOptions.show` gating fields by the chosen method).

```typescript
// credentials/AdvancedSqlApi.credentials.ts
import type {
  ICredentialType,
  INodeProperties,
  ICredentialTestRequest, // not used for socket auth; see credentialTest note
} from 'n8n-workflow';

export class AdvancedSqlApi implements ICredentialType {
  name = 'advancedSqlApi';
  displayName = 'Advanced SQL';
  documentationUrl = 'https://docs.n8n.io/integrations/'; // replace with package docs
  // No top-level `authenticate` / `test` HTTP hook: SQL auth is programmatic.

  properties: INodeProperties[] = [
    // ── Engine ────────────────────────────────────────────────
    {
      displayName: 'Database Engine',
      name: 'engine',
      type: 'options',
      default: 'mssql',
      options: [
        { name: 'Microsoft SQL / Azure SQL', value: 'mssql' },
        { name: 'PostgreSQL', value: 'postgres' },
      ],
    },
    // ── Connection ────────────────────────────────────────────
    { displayName: 'Host', name: 'host', type: 'string', default: '', required: true },
    { displayName: 'Port', name: 'port', type: 'number', default: 1433 },
    { displayName: 'Database', name: 'database', type: 'string', default: '', required: true },

    // ── Auth method discriminator ─────────────────────────────
    {
      displayName: 'Authentication',
      name: 'authentication',
      type: 'options',
      default: 'password',
      options: [
        { name: 'Username & Password (Legacy)', value: 'password' },
        { name: 'Azure Managed Identity', value: 'azureManagedIdentity' },
        { name: 'Azure Service Principal (Client Secret)', value: 'servicePrincipal' },
        { name: 'OAuth2 Client Credentials', value: 'oauth2ClientCredentials' },
        { name: 'Certificate / JWT Bearer', value: 'certificate' },
        { name: 'API Key / Access Token', value: 'apiKey' },
      ],
    },

    // ── password (legacy — unchanged shape) ───────────────────
    { displayName: 'User', name: 'user', type: 'string', default: '',
      displayOptions: { show: { authentication: ['password'] } } },
    { displayName: 'Password', name: 'password', type: 'string',
      typeOptions: { password: true }, default: '',
      displayOptions: { show: { authentication: ['password'] } } },

    // ── azureManagedIdentity ──────────────────────────────────
    { displayName: 'Managed Identity Type', name: 'miType', type: 'options',
      default: 'systemAssigned',
      options: [
        { name: 'System-Assigned', value: 'systemAssigned' },
        { name: 'User-Assigned', value: 'userAssigned' },
      ],
      displayOptions: { show: { authentication: ['azureManagedIdentity'] } } },
    { displayName: 'User-Assigned Client ID', name: 'managedIdentityClientId',
      type: 'string', default: '',
      displayOptions: { show: { authentication: ['azureManagedIdentity'], miType: ['userAssigned'] } } },
    { displayName: 'Allow Local Fallback (DefaultAzureCredential chain)',
      name: 'allowDefaultChain', type: 'boolean', default: false,
      description: 'When on, uses DefaultAzureCredential (Azure CLI / VS Code / env) if managed identity is unavailable. Keep OFF in production.',
      displayOptions: { show: { authentication: ['azureManagedIdentity'] } } },

    // ── servicePrincipal (client secret) ──────────────────────
    { displayName: 'Tenant ID', name: 'tenantId', type: 'string', default: '',
      displayOptions: { show: { authentication: ['servicePrincipal'] } } },
    { displayName: 'Client ID', name: 'clientId', type: 'string', default: '',
      displayOptions: { show: { authentication: ['servicePrincipal'] } } },
    { displayName: 'Client Secret', name: 'clientSecret', type: 'string',
      typeOptions: { password: true }, default: '',
      displayOptions: { show: { authentication: ['servicePrincipal'] } } },

    // ── oauth2ClientCredentials (generic, non-Azure IdP) ──────
    { displayName: 'Token URL', name: 'tokenUrl', type: 'string', default: '',
      displayOptions: { show: { authentication: ['oauth2ClientCredentials'] } } },
    { displayName: 'Client ID', name: 'oauthClientId', type: 'string', default: '',
      displayOptions: { show: { authentication: ['oauth2ClientCredentials'] } } },
    { displayName: 'Client Secret', name: 'oauthClientSecret', type: 'string',
      typeOptions: { password: true }, default: '',
      displayOptions: { show: { authentication: ['oauth2ClientCredentials'] } } },
    { displayName: 'Scope', name: 'scope', type: 'string',
      default: 'https://database.windows.net/.default',
      displayOptions: { show: { authentication: ['oauth2ClientCredentials'] } } },

    // ── certificate / JWT bearer ──────────────────────────────
    { displayName: 'Tenant ID', name: 'certTenantId', type: 'string', default: '',
      displayOptions: { show: { authentication: ['certificate'] } } },
    { displayName: 'Client ID', name: 'certClientId', type: 'string', default: '',
      displayOptions: { show: { authentication: ['certificate'] } } },
    { displayName: 'PEM Certificate + Private Key', name: 'pem', type: 'string',
      typeOptions: { password: true, rows: 6 }, default: '',
      description: 'PEM containing the private key and certificate for the app registration.',
      displayOptions: { show: { authentication: ['certificate'] } } },

    // ── apiKey / static access token ──────────────────────────
    { displayName: 'Access Token / API Key', name: 'accessToken', type: 'string',
      typeOptions: { password: true }, default: '',
      description: 'Pre-acquired bearer token or IAM auth token. Used as-is; not refreshed.',
      displayOptions: { show: { authentication: ['apiKey'] } } },

    // ── shared TLS options ────────────────────────────────────
    { displayName: 'SSL/TLS', name: 'ssl', type: 'boolean', default: true },
    { displayName: 'Trust Server Certificate', name: 'trustServerCertificate',
      type: 'boolean', default: false,
      description: 'Only enable for dev; disables cert validation.' },
  ];
}
```

> **Backward-compat note:** the `password` branch deliberately reuses the field names (`host`, `port`, `database`, `user`, `password`, `ssl`) of the legacy `microsoftSql` / `postgres` credentials, so a migration mapper (§7.4) can copy legacy credentials verbatim.

### 2.2 `INodeType` — `AdvancedSql`

```typescript
// nodes/AdvancedSql/AdvancedSql.node.ts (definition excerpt)
import type { INodeType, INodeTypeDescription } from 'n8n-workflow';

export class AdvancedSql implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Advanced SQL',
    name: 'advancedSql',
    icon: 'file:advancedsql.svg',
    group: ['input'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Run SQL with pluggable enterprise authentication (Azure MI, OAuth2, certificate, service principal, password)',
    defaults: { name: 'Advanced SQL' },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'advancedSqlApi', required: true }],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'executeQuery',
        options: [
          { name: 'Execute Query', value: 'executeQuery', action: 'Execute a SQL query' },
          { name: 'Insert', value: 'insert', action: 'Insert rows' },
          { name: 'Update', value: 'update', action: 'Update rows' },
          { name: 'Delete', value: 'delete', action: 'Delete rows' },
        ],
      },
      {
        displayName: 'Query',
        name: 'query',
        type: 'string',
        typeOptions: { editor: 'sqlEditor', rows: 6 },
        default: '',
        displayOptions: { show: { operation: ['executeQuery'] } },
        description: 'Use named parameters ($1/@p1 or :name) — never string-concatenate values.',
      },
      {
        displayName: 'Parameters',
        name: 'parameters',
        type: 'json',
        default: '[]',
        description: 'Array (positional) or object (named) of values bound to placeholders.',
        displayOptions: { show: { operation: ['executeQuery'] } },
      },
      // insert/update/delete use table + columns/where builders (omitted for brevity;
      // identical to legacy node so mapping is 1:1)
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        options: [
          { displayName: 'Query Timeout (ms)', name: 'queryTimeout', type: 'number', default: 30000 },
          { displayName: 'Pool Max', name: 'poolMax', type: 'number', default: 10 },
          { displayName: 'Wrap in Transaction', name: 'transaction', type: 'boolean', default: false },
          { displayName: 'Continue On Fail Per Item', name: 'continueOnFail', type: 'boolean', default: false },
        ],
      },
    ],
  };

  async execute(this: import('n8n-workflow').IExecuteFunctions) {
    /* see §4 */ return [[]];
  }
}
```

---

## 3. Authentication strategy & flow

### 3.1 Strategy contract

```typescript
// nodes/AdvancedSql/auth/types.ts
import type { AccessToken } from '@azure/identity';

export interface DriverAuthConfig {
  /** mssql (tedious) auth block, OR */
  mssql?: {
    type: 'default' | 'azure-active-directory-access-token';
    options: Record<string, unknown>; // { userName, password } | { token }
  };
  /** postgres auth fields */
  postgres?: { user?: string; password: string }; // password = token for AAD/IAM
}

export interface IAuthStrategy {
  readonly kind: string;
  /** Acquire (with cache) and return driver-ready auth config. Never logs secrets. */
  getConnectionConfig(): Promise<DriverAuthConfig>;
}
```

### 3.2 Method-by-method logic

#### (a) Username / password — legacy, unchanged
No token. Returns credentials verbatim. This is the compatibility anchor.

```typescript
export class PasswordStrategy implements IAuthStrategy {
  kind = 'password';
  constructor(private c: any) {}
  async getConnectionConfig(): Promise<DriverAuthConfig> {
    if (this.c.engine === 'postgres') return { postgres: { user: this.c.user, password: this.c.password } };
    return { mssql: { type: 'default', options: { userName: this.c.user, password: this.c.password } } };
  }
}
```

#### (b) Azure Managed Identity — `azure-identity`
Token acquisition via `ManagedIdentityCredential` (preferred in-Azure) or `DefaultAzureCredential` (only when `allowDefaultChain` is set, for local dev). Scope: `https://database.windows.net/.default` for SQL, `https://ossrdbms-aad.database.windows.net/.default` for Azure PostgreSQL. `getToken()` returns `{ token, expiresOnTimestamp }`; caching/refresh is **our** responsibility (Azure docs: "you must also handle token caching and token refreshing").

```typescript
// nodes/AdvancedSql/auth/ManagedIdentityStrategy.ts
import { ManagedIdentityCredential, DefaultAzureCredential } from '@azure/identity';
import type { TokenCredential } from '@azure/identity';
import { tokenCache } from './TokenCache';

const SCOPE = {
  mssql: 'https://database.windows.net/.default',
  postgres: 'https://ossrdbms-aad.database.windows.net/.default',
} as const;

export class ManagedIdentityStrategy implements IAuthStrategy {
  kind = 'azureManagedIdentity';
  constructor(private c: any, private credId: string) {}

  private buildCredential(): TokenCredential {
    if (this.c.allowDefaultChain) {
      // Fallback chain: env → workload identity → managed identity → dev tools.
      return new DefaultAzureCredential(
        this.c.miType === 'userAssigned'
          ? { managedIdentityClientId: this.c.managedIdentityClientId }
          : {},
      );
    }
    // Production: pin to managed identity so no other credential is silently used.
    return this.c.miType === 'userAssigned'
      ? new ManagedIdentityCredential({ clientId: this.c.managedIdentityClientId })
      : new ManagedIdentityCredential();
  }

  async getConnectionConfig(): Promise<DriverAuthConfig> {
    const scope = SCOPE[this.c.engine as 'mssql' | 'postgres'];
    const token = await tokenCache.getToken(
      `${this.credId}:${this.kind}:${scope}`,
      () => this.buildCredential().getToken(scope),
    );
    if (this.c.engine === 'postgres') {
      // Azure PostgreSQL: username is the AAD principal, password is the token.
      return { postgres: { user: this.c.user || undefined, password: token } };
    }
    return { mssql: { type: 'azure-active-directory-access-token', options: { token } } };
  }
}
```

#### (c) Azure Service Principal (client secret)
`ClientSecretCredential(tenantId, clientId, clientSecret)` → same `getToken(scope)` path and cache. Use when the workload is *not* Azure-hosted but has an app registration.

```typescript
import { ClientSecretCredential } from '@azure/identity';
// buildCredential(): new ClientSecretCredential(c.tenantId, c.clientId, c.clientSecret)
```

#### (d) OAuth2 client credentials (generic IdP, non-Azure)
Direct RFC 6749 §4.4 token request against `tokenUrl` with `grant_type=client_credentials`. Response `{ access_token, expires_in }` normalized into the same cached `AccessToken` shape (`expiresOnTimestamp = now + expires_in*1000`). For Azure endpoints prefer strategy (b)/(c); this branch covers Okta/Ping/Keycloak-fronted databases.

```typescript
async function fetchClientCredentialsToken(c, http): Promise<AccessToken> {
  const res = await http({
    method: 'POST', url: c.tokenUrl,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: c.oauthClientId, client_secret: c.oauthClientSecret, scope: c.scope,
    }).toString(),
    json: true,
  });
  return { token: res.access_token, expiresOnTimestamp: Date.now() + (res.expires_in ?? 3600) * 1000 };
}
```

#### (e) Certificate / JWT bearer
`ClientCertificateCredential(tenantId, clientId, { certificate: pem })` from `azure-identity` (private key stays in the credential store; the assertion JWT is built and signed by the SDK). Same cache/refresh path. Preferred over client-secret for high-assurance environments (no shared secret in transit).

```typescript
import { ClientCertificateCredential } from '@azure/identity';
// new ClientCertificateCredential(c.certTenantId, c.certClientId, { certificate: c.pem })
```

#### (f) API key / static access token
A pre-acquired opaque token (e.g., AWS RDS IAM token generated upstream, or a short-lived bearer). Passed through as-is; **not** refreshed (no refresh material available). The node validates `expiresOnTimestamp` if provided and surfaces a clear error on expiry rather than a cryptic driver failure.

### 3.3 Fallback behavior

```
ManagedIdentity requested
   │
   ├─ allowDefaultChain = false (prod)
   │     └─ ManagedIdentityCredential.getToken()
   │           ├─ success → token
   │           └─ CredentialUnavailableError (off-Azure / IMDS down)
   │                 └─ FAIL FAST with actionable message:
   │                    "Managed identity unavailable on this host.
   │                     Enable 'Allow Local Fallback' for dev, or switch
   │                     to Service Principal / Password."
   │
   └─ allowDefaultChain = true (dev)
         └─ DefaultAzureCredential chain:
              env → workload identity → managed identity → VS Code → Azure CLI
              (first success wins; AggregateAuthenticationError if all fail)
```

Fallback is **explicit and opt-in**, never silent in production — matching Azure's own guidance to pin `ManagedIdentityCredential` in deployed apps to avoid unpredictable credential selection.

---

## 4. Execution logic

### 4.1 Factory

```typescript
// nodes/AdvancedSql/auth/factory.ts
export function createAuthStrategy(creds: any, credId: string): IAuthStrategy {
  switch (creds.authentication) {
    case 'password':                return new PasswordStrategy(creds);
    case 'azureManagedIdentity':    return new ManagedIdentityStrategy(creds, credId);
    case 'servicePrincipal':        return new ServicePrincipalStrategy(creds, credId);
    case 'oauth2ClientCredentials': return new OAuth2ClientCredentialsStrategy(creds, credId);
    case 'certificate':             return new CertificateStrategy(creds, credId);
    case 'apiKey':                  return new ApiKeyStrategy(creds);
    default: throw new Error(`Unsupported authentication method: ${creds.authentication}`);
  }
}
```

### 4.2 Token cache (single-flight, module-scoped)

```typescript
// nodes/AdvancedSql/auth/TokenCache.ts
import type { AccessToken } from '@azure/identity';

const SKEW_MS = 5 * 60 * 1000; // refresh 5 min before expiry

class TokenCache {
  private store = new Map<string, AccessToken>();
  private inflight = new Map<string, Promise<AccessToken>>();

  async getToken(key: string, acquire: () => Promise<AccessToken | null>): Promise<string> {
    const cached = this.store.get(key);
    if (cached && cached.expiresOnTimestamp - SKEW_MS > Date.now()) return cached.token;

    let p = this.inflight.get(key);
    if (!p) {
      p = (async () => {
        const t = await acquire();
        if (!t) throw new Error('Token acquisition returned no token');
        this.store.set(key, t);
        return t;
      })().finally(() => this.inflight.delete(key));
      this.inflight.set(key, p); // single-flight: concurrent callers share one request
    }
    return (await p).token;
  }
}
export const tokenCache = new TokenCache();
```

### 4.3 `execute()` skeleton

```typescript
async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
  const items = this.getInputData();
  const creds = await this.getCredentials('advancedSqlApi');
  const credId = this.getNode().credentials?.advancedSqlApi?.id ?? 'anon';
  const engine = creds.engine as 'mssql' | 'postgres';

  const strategy = createAuthStrategy(creds, credId);
  const authConfig = await strategy.getConnectionConfig(); // token acquired+cached here

  const pool = await poolManager.acquire(engine, creds, authConfig); // §4.4
  const returnData: INodeExecutionData[] = [];

  for (let i = 0; i < items.length; i++) {
    try {
      const query = this.getNodeParameter('query', i, '') as string;
      const params = this.getNodeParameter('parameters', i, []) as unknown;
      const rows = await runQuery(engine, pool, query, params); // parameter binding, no concat
      returnData.push(...rows.map((r) => ({ json: r, pairedItem: { item: i } })));
    } catch (err) {
      if (this.continueOnFail()) {
        returnData.push({ json: { error: redact((err as Error).message) }, pairedItem: { item: i } });
        continue;
      }
      throw new NodeOperationError(this.getNode(), redact((err as Error).message), { itemIndex: i });
    }
  }
  return [returnData];
}
```

### 4.4 Pool manager & token rotation

- Pools are cached in a module-scoped `Map` keyed by a **fingerprint** = `hash(engine|host|port|database|authType|user)` — deliberately **excluding the token** so short-lived tokens don't churn pools.
- On each `acquire()`, if the strategy produced a **new** token (token-based auths), the manager updates the pool's connection config for *new* connections. For `mssql`, tedious binds the token at connection time; existing pooled sockets keep their (still-valid) session, new sockets pick up the fresh token. For `pg`, a `password` function/rotation callback supplies the current token per new connection.
- Idle pools are evicted after a TTL to bound resource use across many credentials.

```typescript
// mssql pool config assembly (token path)
const poolConfig: mssql.config = {
  server: creds.host, port: creds.port, database: creds.database,
  options: { encrypt: !!creds.ssl, trustServerCertificate: !!creds.trustServerCertificate },
  authentication: authConfig.mssql, // { type:'azure-active-directory-access-token', options:{ token } }
  pool: { max: options.poolMax ?? 10, min: 0, idleTimeoutMillis: 30000 },
};
```

### 4.5 Parameter binding & result mapping

- **mssql:** use `request.input('p1', value)` for each param; queries reference `@p1`. Named-object params map key→`input(key)`. Never interpolate.
- **postgres:** parameterized `client.query(text, valuesArray)` with `$1..$n`.
- Result mapping preserves column types where the driver exposes them; `bigint`/`numeric` returned as strings to avoid JS precision loss (configurable via option).

---

## 5. Security considerations

| Concern | Mitigation |
|--------|-----------|
| **Secret storage** | All secrets live only in n8n's encrypted credential store (`typeOptions.password: true` masks in UI and marks fields for encryption at rest). No secret is written to node parameters, workflow JSON, or static data. |
| **Credential leakage in output** | `execute()` returns only query rows. A central `redact()` scrubs known secret substrings (token, password, clientSecret, pem) from any error message before it becomes node output or an `NodeOperationError`. Tokens are never placed in `json` output. |
| **Logging** | `azure-identity` logging is **not** enabled by default; if diagnostics are needed, only `AzureLogLevel` ≤ `info` is used, which never prints token material. Our own code logs config *fingerprints* (hashes), never raw host+token. |
| **Least-privilege scopes** | Fixed, minimal scopes (`…/.default` for the specific resource). Managed identity should map to a DB principal with only the grants the workflow needs (e.g., `db_datareader`), enforced at the database, not the node. Documented in README. |
| **Token caching** | In-memory only, module-scoped, never persisted to disk. Keyed by credential id + authType + scope so tokens can't cross credentials. 5-min refresh skew avoids mid-query expiry. |
| **Prod fallback hardening** | `allowDefaultChain` defaults to **false**; production pins `ManagedIdentityCredential`, preventing environment-variable tampering from redirecting auth (a documented `DefaultAzureCredential` risk). |
| **Transport** | TLS on by default (`encrypt: true` for mssql, `ssl: true` for pg). `trustServerCertificate` is off by default and flagged dev-only. |
| **SQL injection** | Parameter binding is mandatory; the UI copy and docs steer users away from string concatenation. Insert/Update/Delete builders parameterize all values. |
| **Audit logging** | Emit a structured, secret-free audit event per execution (`{ credId, authType, engine, host, db, operation, rowCount, durationMs, outcome }`) via n8n's logger for SIEM ingestion. No token, no query values. |
| **Blast radius** | Short-lived AAD tokens (≈60–90 min) limit exposure vs. long-lived passwords; certificate/MI auth removes shared secrets entirely. |

---

## 6. Testing plan

### 6.1 Unit tests (Jest)

| Suite | What it asserts | Mocks |
|-------|-----------------|-------|
| `factory.spec.ts` | Each `authentication` value maps to the correct strategy; unknown → throws. | none |
| `TokenCache.spec.ts` | Cache hit before skew; refresh after skew; single-flight collapses concurrent calls into one `acquire`. | fake clock, spy acquire |
| `ManagedIdentityStrategy.spec.ts` | Correct scope per engine; system vs user-assigned credential built with right client id; postgres puts token in `password`, mssql in `authentication.options.token`. | mock `@azure/identity` (`jest.mock`) returning `{ token, expiresOnTimestamp }` |
| `PasswordStrategy.spec.ts` | Legacy shape unchanged (regression guard for backward compat). | none |
| `redact.spec.ts` | Token/password/secret/pem never survive in redacted strings. | none |
| `fallback.spec.ts` | `allowDefaultChain=false` + `CredentialUnavailableError` → actionable error, no silent fallback. | mock credential throwing |

```typescript
// ManagedIdentityStrategy.spec.ts (excerpt)
jest.mock('@azure/identity', () => ({
  ManagedIdentityCredential: jest.fn().mockImplementation(() => ({
    getToken: jest.fn().mockResolvedValue({ token: 'FAKE', expiresOnTimestamp: Date.now() + 3.6e6 }),
  })),
  DefaultAzureCredential: jest.fn(),
}));

it('uses database scope and injects token for mssql', async () => {
  const s = new ManagedIdentityStrategy({ engine: 'mssql', miType: 'systemAssigned' }, 'cred1');
  const cfg = await s.getConnectionConfig();
  expect(cfg.mssql).toEqual({
    type: 'azure-active-directory-access-token',
    options: { token: 'FAKE' },
  });
});
```

### 6.2 Integration tests

- **Azure SQL (MI):** run inside an Azure DevOps / GitHub Actions self-hosted runner with a user-assigned managed identity; assert a real token authenticates and `SELECT 1` returns. Gated behind an env flag so CI without Azure skips it.
- **SQL Server (password):** `mcr.microsoft.com/mssql/server` container in CI → legacy path regression.
- **Postgres (password + fake token):** `postgres` container; token path exercised with a stubbed token endpoint.
- **Testcontainers** used for hermetic DB lifecycle; `credentialTest`-equivalent connection check validated.

### 6.3 Example workflow JSON

A ready-to-import workflow using Managed Identity against Azure SQL is committed at [`examples/advanced-sql-managed-identity.workflow.json`](examples/advanced-sql-managed-identity.workflow.json).

---

## 7. Backward compatibility & migration

1. **Additive package** — the legacy `microsoftSql`/`postgres` nodes remain installed and untouched. `n8n-nodes-advanced-sql` ships alongside.
2. **Field-name parity** — the `password` auth branch reuses legacy field names, so existing muscle memory and docs carry over.
3. **Versioned node** — `version: 1`; future auth additions go behind `version: 2` via n8n's `NodeVersionedType` so pinned workflows never shift behavior.
4. **Migration helper (optional)** — a documented script/mapper copies a legacy credential into an `advancedSqlApi` credential with `authentication: 'password'`:

```typescript
export function migrateLegacyMssql(legacy: any) {
  return {
    engine: 'mssql', host: legacy.server, port: legacy.port ?? 1433,
    database: legacy.database, authentication: 'password',
    user: legacy.user, password: legacy.password,
    ssl: legacy.tls?.enabled ?? true,
    trustServerCertificate: legacy.tls?.trustServerCertificate ?? false,
  };
}
```

5. **No forced upgrade** — teams adopt the new node per-workflow; nothing breaks on install.

---

## 8. Dependencies (kept lightweight)

| Package | Why | Notes |
|--------|-----|-------|
| `@azure/identity` | MI / service principal / certificate token acquisition. | Single dep covers 4 of 6 auth methods. |
| `mssql` | SQL Server / Azure SQL driver (bundles `tedious`). | Native AAD token support. |
| `pg` | PostgreSQL driver. | Optional peer; only loaded when `engine=postgres`. |
| *(none)* for OAuth2 | Uses global `fetch` / n8n HTTP helper. | Avoids an extra OAuth library. |

Drivers are lazy-`require`d by engine so a Postgres-only install never loads `mssql` and vice-versa.

---

## 9. References

- n8n — Creating nodes / credentials: <https://docs.n8n.io/integrations/creating-nodes/>
- n8n `ICredentialType`, `INodeType`, `INodeProperties` (source patterns): `@n8n/nodes-base`, `n8n-workflow`
- Azure Identity for JavaScript — overview & `DefaultAzureCredential`: <https://learn.microsoft.com/javascript/api/overview/azure/identity-readme>
- `DefaultAzureCredential` chain & `getToken` (caching/refresh is caller's responsibility): <https://learn.microsoft.com/javascript/api/@azure/identity/defaultazurecredential>
- `ManagedIdentityCredential`: <https://learn.microsoft.com/javascript/api/@azure/identity/managedidentitycredential>
- Credential chains — usage guidance (pin MI in prod): <https://learn.microsoft.com/azure/developer/javascript/sdk/authentication/credential-chains>
- Managed identity retry / best practices: <https://learn.microsoft.com/azure/developer/javascript/sdk/authentication/best-practices>
- Azure SQL AAD token auth in `tedious`/`mssql`: <https://www.npmjs.com/package/mssql> (`authentication.type = 'azure-active-directory-access-token'`)
- Azure Database for PostgreSQL AAD scope `https://ossrdbms-aad.database.windows.net/.default`
- OAuth2 client credentials grant — RFC 6749 §4.4: <https://datatracker.ietf.org/doc/html/rfc6749#section-4.4>
