import type { SqlEngine } from './types';

/**
 * Default AAD token audiences per engine.
 * - Azure SQL / SQL Server: https://database.windows.net/.default
 * - Azure Database for PostgreSQL: https://ossrdbms-aad.database.windows.net/.default
 */
export const DEFAULT_SCOPE: Record<SqlEngine, string> = {
	mssql: 'https://database.windows.net/.default',
	postgres: 'https://ossrdbms-aad.database.windows.net/.default',
};

export function scopeForEngine(engine: SqlEngine, override?: string): string {
	return override && override.trim().length > 0 ? override.trim() : DEFAULT_SCOPE[engine];
}
