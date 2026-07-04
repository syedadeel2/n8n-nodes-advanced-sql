import { redact, collectSecrets } from '../nodes/AdvancedSql/auth/redact';
import type { AdvancedSqlCredentials } from '../nodes/AdvancedSql/auth/types';

describe('redact', () => {
	it('removes explicit secret values', () => {
		const out = redact('login failed for password=SuperSecret123', ['SuperSecret123']);
		expect(out).not.toContain('SuperSecret123');
		expect(out).toContain('***');
	});

	it('scrubs JWT-shaped tokens even when not passed explicitly', () => {
		const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payloadpart.signaturepart';
		const out = redact(`Authorization: Bearer ${jwt}`);
		expect(out).not.toContain(jwt);
	});

	it('handles Error inputs', () => {
		const out = redact(new Error('boom clientSecret=abcd1234'), ['abcd1234']);
		expect(out).toContain('boom');
		expect(out).not.toContain('abcd1234');
	});

	it('collectSecrets gathers every secret-bearing field', () => {
		const c: AdvancedSqlCredentials = {
			engine: 'mssql',
			host: 'h',
			database: 'd',
			authentication: 'servicePrincipal',
			password: 'p',
			clientSecret: 'cs',
			oauthClientSecret: 'ocs',
			pem: 'pem',
			accessToken: 'at',
		};
		expect(collectSecrets(c)).toEqual(['p', 'cs', 'ocs', 'pem', 'at']);
	});
});
