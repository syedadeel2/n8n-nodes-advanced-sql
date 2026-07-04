import type {
	AdvancedSqlCredentials,
	CachedAccessToken,
	DriverAuthConfig,
	IAuthStrategy,
} from '../types';
import { TokenCache, tokenCache } from '../TokenCache';
import { tokenToDriverConfig } from './tokenToDriverConfig';

/** Token endpoint fetcher; injectable for tests. Uses the global `fetch`. */
export type TokenFetcher = (c: AdvancedSqlCredentials) => Promise<CachedAccessToken>;

const defaultFetcher: TokenFetcher = async (c) => {
	const body = new URLSearchParams({
		grant_type: 'client_credentials',
		client_id: c.oauthClientId ?? '',
		client_secret: c.oauthClientSecret ?? '',
		scope: c.scope ?? '',
	});

	const res = await fetch(c.tokenUrl ?? '', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: body.toString(),
	});

	if (!res.ok) {
		throw new Error(`OAuth2 token request failed with status ${res.status}`);
	}

	const json = (await res.json()) as { access_token?: string; expires_in?: number };
	if (!json.access_token) {
		throw new Error('OAuth2 token response did not contain an access_token');
	}

	return {
		token: json.access_token,
		expiresOnTimestamp: Date.now() + (json.expires_in ?? 3600) * 1000,
	};
};

/**
 * Generic OAuth2 client-credentials grant (RFC 6749 §4.4) against a non-Azure
 * IdP (Okta / Ping / Keycloak fronting the database). For Azure endpoints,
 * prefer the managed-identity or service-principal strategies.
 */
export class OAuth2ClientCredentialsStrategy implements IAuthStrategy {
	readonly kind = 'oauth2ClientCredentials' as const;

	constructor(
		private readonly c: AdvancedSqlCredentials,
		private readonly credentialId: string,
		private readonly cache: TokenCache = tokenCache,
		private readonly fetcher: TokenFetcher = defaultFetcher,
	) {}

	async getConnectionConfig(): Promise<DriverAuthConfig> {
		const key = `${this.credentialId}:${this.kind}:${this.c.scope ?? ''}`;
		const token = await this.cache.getToken(key, () => this.fetcher(this.c));
		return tokenToDriverConfig(this.c, token);
	}
}
