export type SqlEngine = 'mssql' | 'postgres';

export type AuthenticationMethod =
	| 'password'
	| 'azureManagedIdentity'
	| 'servicePrincipal'
	| 'oauth2ClientCredentials'
	| 'certificate'
	| 'apiKey';

/**
 * Normalised credential bag as decrypted by n8n. Fields are optional because
 * each authentication method only populates its own subset (gated in the UI by
 * `displayOptions`). Keep this in sync with AdvancedSqlApi.credentials.ts.
 */
export interface AdvancedSqlCredentials {
	engine: SqlEngine;
	host: string;
	port?: number;
	database: string;
	authentication: AuthenticationMethod;

	// password
	user?: string;
	password?: string;

	// azureManagedIdentity
	miType?: 'systemAssigned' | 'userAssigned';
	managedIdentityClientId?: string;
	allowDefaultChain?: boolean;

	// servicePrincipal
	tenantId?: string;
	clientId?: string;
	clientSecret?: string;

	// oauth2ClientCredentials
	tokenUrl?: string;
	oauthClientId?: string;
	oauthClientSecret?: string;
	scope?: string;

	// certificate
	certTenantId?: string;
	certClientId?: string;
	pem?: string;

	// apiKey
	accessToken?: string;
	accessTokenExpiresAt?: number;

	// shared TLS
	ssl?: boolean;
	trustServerCertificate?: boolean;
}

/** mssql (tedious) authentication block. */
export interface MssqlAuthConfig {
	type: 'default' | 'azure-active-directory-access-token';
	options: {
		userName?: string;
		password?: string;
		token?: string;
	};
}

/** postgres auth fields; for AAD/IAM the token is supplied as the password. */
export interface PostgresAuthConfig {
	user?: string;
	password: string;
}

/** Driver-ready authentication config produced by a strategy. */
export interface DriverAuthConfig {
	mssql?: MssqlAuthConfig;
	postgres?: PostgresAuthConfig;
}

export interface IAuthStrategy {
	readonly kind: AuthenticationMethod;
	/** Acquire (with caching where applicable) and return driver auth config. Never logs secrets. */
	getConnectionConfig(): Promise<DriverAuthConfig>;
}

/** Minimal shape mirroring @azure/identity AccessToken so caching is driver-agnostic. */
export interface CachedAccessToken {
	token: string;
	expiresOnTimestamp: number;
}
