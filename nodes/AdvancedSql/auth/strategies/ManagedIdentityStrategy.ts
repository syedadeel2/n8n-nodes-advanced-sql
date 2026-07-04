import {
	DefaultAzureCredential,
	ManagedIdentityCredential,
	type TokenCredential,
} from '@azure/identity';
import type { AdvancedSqlCredentials, DriverAuthConfig, IAuthStrategy } from '../types';
import { TokenCache, tokenCache } from '../TokenCache';
import { scopeForEngine } from '../scopes';
import { tokenToDriverConfig } from './tokenToDriverConfig';

/**
 * Azure Managed Identity via @azure/identity.
 *
 * Production pins `ManagedIdentityCredential` so no other credential can be
 * silently selected. When `allowDefaultChain` is enabled (dev only) it falls
 * back to `DefaultAzureCredential`, which walks env → workload identity →
 * managed identity → local dev tooling. Token caching/refresh is handled by the
 * shared TokenCache.
 */
export class ManagedIdentityStrategy implements IAuthStrategy {
	readonly kind = 'azureManagedIdentity' as const;

	constructor(
		private readonly c: AdvancedSqlCredentials,
		private readonly credentialId: string,
		private readonly cache: TokenCache = tokenCache,
		private readonly credentialFactory: () => TokenCredential = () => this.buildCredential(),
	) {}

	private buildCredential(): TokenCredential {
		const clientId = this.c.managedIdentityClientId;
		if (this.c.allowDefaultChain) {
			return new DefaultAzureCredential(
				this.c.miType === 'userAssigned' && clientId
					? { managedIdentityClientId: clientId }
					: {},
			);
		}
		return this.c.miType === 'userAssigned' && clientId
			? new ManagedIdentityCredential({ clientId })
			: new ManagedIdentityCredential();
	}

	async getConnectionConfig(): Promise<DriverAuthConfig> {
		const scope = scopeForEngine(this.c.engine, this.c.scope);
		const key = `${this.credentialId}:${this.kind}:${scope}`;

		try {
			const token = await this.cache.getToken(key, async () => {
				const cred = this.credentialFactory();
				const t = await cred.getToken(scope);
				return t ? { token: t.token, expiresOnTimestamp: t.expiresOnTimestamp } : null;
			});
			return tokenToDriverConfig(this.c, token);
		} catch (error) {
			if (!this.c.allowDefaultChain) {
				throw new Error(
					'Managed identity is unavailable on this host. Enable "Allow Local Fallback" for ' +
						'local development, or switch the credential to Service Principal / Password. ' +
						`Underlying error: ${(error as Error).message}`,
				);
			}
			throw error;
		}
	}
}
