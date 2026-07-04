import type { AdvancedSqlCredentials, DriverAuthConfig, IAuthStrategy } from '../types';
import { tokenToDriverConfig } from './tokenToDriverConfig';

/**
 * Static, pre-acquired bearer token / API key (e.g. an AWS RDS IAM token
 * generated upstream). Passed through as-is and NOT refreshed. If an expiry is
 * supplied we fail fast with a clear message rather than surfacing a cryptic
 * driver error.
 */
export class ApiKeyStrategy implements IAuthStrategy {
	readonly kind = 'apiKey' as const;

	constructor(
		private readonly c: AdvancedSqlCredentials,
		private readonly now: () => number = () => Date.now(),
	) {}

	async getConnectionConfig(): Promise<DriverAuthConfig> {
		const token = this.c.accessToken;
		if (!token) {
			throw new Error('API key authentication selected but no access token was provided');
		}
		if (this.c.accessTokenExpiresAt && this.c.accessTokenExpiresAt <= this.now()) {
			throw new Error('The provided access token has expired; supply a fresh token');
		}
		return tokenToDriverConfig(this.c, token);
	}
}
