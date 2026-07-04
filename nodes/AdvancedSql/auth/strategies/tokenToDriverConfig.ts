import type { AdvancedSqlCredentials, DriverAuthConfig } from '../types';

/**
 * Maps an acquired bearer token onto the correct driver auth config for the
 * engine. For Postgres (Azure AAD / RDS IAM) the token is passed as the
 * password; for mssql it becomes an AAD access-token authentication block.
 */
export function tokenToDriverConfig(
	c: AdvancedSqlCredentials,
	token: string,
): DriverAuthConfig {
	if (c.engine === 'postgres') {
		return { postgres: { user: c.user || undefined, password: token } };
	}
	return {
		mssql: {
			type: 'azure-active-directory-access-token',
			options: { token },
		},
	};
}
