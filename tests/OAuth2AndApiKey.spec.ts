import { OAuth2ClientCredentialsStrategy } from '../nodes/AdvancedSql/auth/strategies/OAuth2ClientCredentialsStrategy';
import { ApiKeyStrategy } from '../nodes/AdvancedSql/auth/strategies/ApiKeyStrategy';
import { TokenCache } from '../nodes/AdvancedSql/auth/TokenCache';
import type { AdvancedSqlCredentials } from '../nodes/AdvancedSql/auth/types';

describe('OAuth2ClientCredentialsStrategy', () => {
	const c: AdvancedSqlCredentials = {
		engine: 'mssql',
		host: 'h',
		database: 'd',
		authentication: 'oauth2ClientCredentials',
		tokenUrl: 'https://idp/token',
		oauthClientId: 'id',
		oauthClientSecret: 'sec',
		scope: 'db/.default',
	};

	it('fetches a token and maps it to the mssql auth block', async () => {
		const fetcher = jest
			.fn()
			.mockResolvedValue({ token: 'TK', expiresOnTimestamp: Date.now() + 3_600_000 });
		const strategy = new OAuth2ClientCredentialsStrategy(c, 'cred1', new TokenCache(), fetcher);
		const cfg = await strategy.getConnectionConfig();
		expect(cfg.mssql?.options.token).toBe('TK');
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});

describe('ApiKeyStrategy', () => {
	it('passes through a static token', async () => {
		const c: AdvancedSqlCredentials = {
			engine: 'mssql',
			host: 'h',
			database: 'd',
			authentication: 'apiKey',
			accessToken: 'STATIC',
		};
		const cfg = await new ApiKeyStrategy(c).getConnectionConfig();
		expect(cfg.mssql?.options.token).toBe('STATIC');
	});

	it('throws when the token is missing', async () => {
		const c: AdvancedSqlCredentials = {
			engine: 'mssql',
			host: 'h',
			database: 'd',
			authentication: 'apiKey',
		};
		await expect(new ApiKeyStrategy(c).getConnectionConfig()).rejects.toThrow(/no access token/);
	});

	it('throws when the token has expired', async () => {
		const c: AdvancedSqlCredentials = {
			engine: 'mssql',
			host: 'h',
			database: 'd',
			authentication: 'apiKey',
			accessToken: 'X',
			accessTokenExpiresAt: 500,
		};
		await expect(new ApiKeyStrategy(c, () => 1000).getConnectionConfig()).rejects.toThrow(
			/expired/,
		);
	});
});
