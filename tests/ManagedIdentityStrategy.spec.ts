import { ManagedIdentityStrategy } from '../nodes/AdvancedSql/auth/strategies/ManagedIdentityStrategy';
import { TokenCache } from '../nodes/AdvancedSql/auth/TokenCache';
import type { AdvancedSqlCredentials } from '../nodes/AdvancedSql/auth/types';
import type { TokenCredential } from '@azure/identity';

function fakeCredential(token = 'FAKE'): TokenCredential {
	return {
		getToken: jest
			.fn()
			.mockResolvedValue({ token, expiresOnTimestamp: Date.now() + 60 * 60 * 1000 }),
	};
}

const base: AdvancedSqlCredentials = {
	engine: 'mssql',
	host: 'server.database.windows.net',
	database: 'db',
	authentication: 'azureManagedIdentity',
	miType: 'systemAssigned',
};

describe('ManagedIdentityStrategy', () => {
	it('injects the token into the mssql AAD auth block', async () => {
		const cred = fakeCredential('FAKE');
		const strategy = new ManagedIdentityStrategy(base, 'cred1', new TokenCache(), () => cred);
		const cfg = await strategy.getConnectionConfig();
		expect(cfg.mssql).toEqual({
			type: 'azure-active-directory-access-token',
			options: { token: 'FAKE' },
		});
		expect(cred.getToken).toHaveBeenCalledWith('https://database.windows.net/.default');
	});

	it('uses the postgres scope and puts the token in the password', async () => {
		const cred = fakeCredential('PGTOKEN');
		const pgCreds = { ...base, engine: 'postgres' as const, user: 'aad-user' };
		const strategy = new ManagedIdentityStrategy(pgCreds, 'cred1', new TokenCache(), () => cred);
		const cfg = await strategy.getConnectionConfig();
		expect(cfg.postgres).toEqual({ user: 'aad-user', password: 'PGTOKEN' });
		expect(cred.getToken).toHaveBeenCalledWith(
			'https://ossrdbms-aad.database.windows.net/.default',
		);
	});

	it('caches across calls (single acquisition)', async () => {
		const cred = fakeCredential();
		const strategy = new ManagedIdentityStrategy(base, 'cred1', new TokenCache(), () => cred);
		await strategy.getConnectionConfig();
		await strategy.getConnectionConfig();
		expect(cred.getToken).toHaveBeenCalledTimes(1);
	});

	it('fails fast with an actionable error when MI is unavailable and fallback is off', async () => {
		const failing: TokenCredential = {
			getToken: jest.fn().mockRejectedValue(new Error('IMDS not available')),
		};
		const strategy = new ManagedIdentityStrategy(base, 'cred1', new TokenCache(), () => failing);
		await expect(strategy.getConnectionConfig()).rejects.toThrow(
			/Managed identity is unavailable.*Allow Local Fallback/s,
		);
	});
});
