import { PasswordStrategy } from '../nodes/AdvancedSql/auth/strategies/PasswordStrategy';
import type { AdvancedSqlCredentials } from '../nodes/AdvancedSql/auth/types';

describe('PasswordStrategy (backward compatibility)', () => {
	it('produces the legacy mssql default auth shape', async () => {
		const c: AdvancedSqlCredentials = {
			engine: 'mssql',
			host: 'h',
			database: 'd',
			authentication: 'password',
			user: 'sa',
			password: 'secret',
		};
		const cfg = await new PasswordStrategy(c).getConnectionConfig();
		expect(cfg.mssql).toEqual({ type: 'default', options: { userName: 'sa', password: 'secret' } });
	});

	it('produces postgres user/password', async () => {
		const c: AdvancedSqlCredentials = {
			engine: 'postgres',
			host: 'h',
			database: 'd',
			authentication: 'password',
			user: 'app',
			password: 'pw',
		};
		const cfg = await new PasswordStrategy(c).getConnectionConfig();
		expect(cfg.postgres).toEqual({ user: 'app', password: 'pw' });
	});
});
