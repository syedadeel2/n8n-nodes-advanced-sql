import { ClientSecretCredential, type TokenCredential } from '@azure/identity';
import type { AdvancedSqlCredentials, DriverAuthConfig, IAuthStrategy } from '../types';
import { TokenCache, tokenCache } from '../TokenCache';
import { scopeForEngine } from '../scopes';
import { tokenToDriverConfig } from './tokenToDriverConfig';

/**
 * Azure service principal (app registration + client secret). Use when the
 * workload is not Azure-hosted but has an Entra ID application. Same cached
 * token path as managed identity.
 */
export class ServicePrincipalStrategy implements IAuthStrategy {
	readonly kind = 'servicePrincipal' as const;

	constructor(
		private readonly c: AdvancedSqlCredentials,
		private readonly credentialId: string,
		private readonly cache: TokenCache = tokenCache,
		private readonly credentialFactory: () => TokenCredential = () =>
			new ClientSecretCredential(
				this.c.tenantId ?? '',
				this.c.clientId ?? '',
				this.c.clientSecret ?? '',
			),
	) {}

	async getConnectionConfig(): Promise<DriverAuthConfig> {
		const scope = scopeForEngine(this.c.engine, this.c.scope);
		const key = `${this.credentialId}:${this.kind}:${scope}`;
		const token = await this.cache.getToken(key, async () => {
			const t = await this.credentialFactory().getToken(scope);
			return t ? { token: t.token, expiresOnTimestamp: t.expiresOnTimestamp } : null;
		});
		return tokenToDriverConfig(this.c, token);
	}
}
