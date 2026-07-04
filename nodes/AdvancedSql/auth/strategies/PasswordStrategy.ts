import type { AdvancedSqlCredentials, DriverAuthConfig, IAuthStrategy } from '../types';

/**
 * Legacy username/password authentication. No token acquisition — this is the
 * backward-compatibility anchor and produces the same driver config shape the
 * built-in SQL nodes use.
 */
export class PasswordStrategy implements IAuthStrategy {
	readonly kind = 'password' as const;

	constructor(private readonly c: AdvancedSqlCredentials) {}

	async getConnectionConfig(): Promise<DriverAuthConfig> {
		if (this.c.engine === 'postgres') {
			return { postgres: { user: this.c.user, password: this.c.password ?? '' } };
		}
		return {
			mssql: {
				type: 'default',
				options: { userName: this.c.user, password: this.c.password },
			},
		};
	}
}
