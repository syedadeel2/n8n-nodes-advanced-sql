import { ClientCertificateCredential, type TokenCredential } from '@azure/identity';
import type { AdvancedSqlCredentials, DriverAuthConfig, IAuthStrategy } from '../types';
import { TokenCache, tokenCache } from '../TokenCache';
import { scopeForEngine } from '../scopes';
import { tokenToDriverConfig } from './tokenToDriverConfig';

/**
 * Certificate / JWT bearer authentication. The private key never leaves the
 * credential store; @azure/identity builds and signs the client assertion.
 * Preferred over client secret for high-assurance environments.
 */
export class CertificateStrategy implements IAuthStrategy {
	readonly kind = 'certificate' as const;

	constructor(
		private readonly c: AdvancedSqlCredentials,
		private readonly credentialId: string,
		private readonly cache: TokenCache = tokenCache,
		private readonly credentialFactory: () => TokenCredential = () =>
			new ClientCertificateCredential(
				this.c.certTenantId ?? '',
				this.c.certClientId ?? '',
				{ certificate: this.c.pem ?? '' },
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
