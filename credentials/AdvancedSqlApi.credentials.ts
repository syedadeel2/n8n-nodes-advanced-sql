import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Single credential type with an `authentication` discriminator. Method-specific
 * fields are shown/hidden via `displayOptions`, mirroring n8n's multi-auth nodes.
 * SQL auth is programmatic (a driver socket, not an HTTP request), so there is no
 * top-level `authenticate`/`test` HTTP hook — token acquisition happens in the
 * node's auth strategy layer.
 */
export class AdvancedSqlApi implements ICredentialType {
	name = 'advancedSqlApi';

	displayName = 'Advanced SQL';

	documentationUrl = 'https://github.com/syedadeel2/n8n-nodes-advanced-sql/blob/main/DESIGN.md';

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

		// ── password (legacy) ─────────────────────────────────────
		// Shared `user` field: required for password, optional AAD principal for
		// Azure PostgreSQL managed identity (token is sent as this user's password).
		{
			displayName: 'User',
			name: 'user',
			type: 'string',
			default: '',
			description:
				'Database user. For Azure PostgreSQL managed identity this is the AAD principal the token authenticates as.',
			displayOptions: { show: { authentication: ['password', 'azureManagedIdentity'] } },
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			displayOptions: { show: { authentication: ['password'] } },
		},

		// ── azureManagedIdentity ──────────────────────────────────
		{
			displayName: 'Managed Identity Type',
			name: 'miType',
			type: 'options',
			default: 'systemAssigned',
			options: [
				{ name: 'System-Assigned', value: 'systemAssigned' },
				{ name: 'User-Assigned', value: 'userAssigned' },
			],
			displayOptions: { show: { authentication: ['azureManagedIdentity'] } },
		},
		{
			displayName: 'User-Assigned Client ID',
			name: 'managedIdentityClientId',
			type: 'string',
			default: '',
			displayOptions: {
				show: { authentication: ['azureManagedIdentity'], miType: ['userAssigned'] },
			},
		},
		{
			displayName: 'Allow Local Fallback (DefaultAzureCredential Chain)',
			name: 'allowDefaultChain',
			type: 'boolean',
			default: false,
			description:
				'Whether to use DefaultAzureCredential (Azure CLI / VS Code / env) if managed identity is unavailable. Keep OFF in production.',
			displayOptions: { show: { authentication: ['azureManagedIdentity'] } },
		},

		// ── servicePrincipal ──────────────────────────────────────
		{
			displayName: 'Tenant ID',
			name: 'tenantId',
			type: 'string',
			default: '',
			displayOptions: { show: { authentication: ['servicePrincipal'] } },
		},
		{
			displayName: 'Client ID',
			name: 'clientId',
			type: 'string',
			default: '',
			displayOptions: { show: { authentication: ['servicePrincipal'] } },
		},
		{
			displayName: 'Client Secret',
			name: 'clientSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			displayOptions: { show: { authentication: ['servicePrincipal'] } },
		},

		// ── oauth2ClientCredentials ───────────────────────────────
		{
			displayName: 'Token URL',
			name: 'tokenUrl',
			type: 'string',
			default: '',
			displayOptions: { show: { authentication: ['oauth2ClientCredentials'] } },
		},
		{
			displayName: 'Client ID',
			name: 'oauthClientId',
			type: 'string',
			default: '',
			displayOptions: { show: { authentication: ['oauth2ClientCredentials'] } },
		},
		{
			displayName: 'Client Secret',
			name: 'oauthClientSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			displayOptions: { show: { authentication: ['oauth2ClientCredentials'] } },
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'string',
			default: 'https://database.windows.net/.default',
			displayOptions: { show: { authentication: ['oauth2ClientCredentials'] } },
		},

		// ── certificate / JWT bearer ──────────────────────────────
		{
			displayName: 'Tenant ID',
			name: 'certTenantId',
			type: 'string',
			default: '',
			displayOptions: { show: { authentication: ['certificate'] } },
		},
		{
			displayName: 'Client ID',
			name: 'certClientId',
			type: 'string',
			default: '',
			displayOptions: { show: { authentication: ['certificate'] } },
		},
		{
			displayName: 'PEM Certificate + Private Key',
			name: 'pem',
			type: 'string',
			typeOptions: { password: true, rows: 6 },
			default: '',
			description: 'PEM containing the private key and certificate for the app registration.',
			displayOptions: { show: { authentication: ['certificate'] } },
		},

		// ── apiKey ────────────────────────────────────────────────
		{
			displayName: 'Access Token / API Key',
			name: 'accessToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Pre-acquired bearer token or IAM auth token. Used as-is; not refreshed.',
			displayOptions: { show: { authentication: ['apiKey'] } },
		},

		// ── shared TLS ────────────────────────────────────────────
		{ displayName: 'SSL/TLS', name: 'ssl', type: 'boolean', default: true },
		{
			displayName: 'Trust Server Certificate',
			name: 'trustServerCertificate',
			type: 'boolean',
			default: false,
			description: 'Whether to skip TLS certificate validation. Enable only for development.',
		},
	];
}
