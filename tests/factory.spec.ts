import { createAuthStrategy } from '../nodes/AdvancedSql/auth/factory';
import type { AdvancedSqlCredentials, AuthenticationMethod } from '../nodes/AdvancedSql/auth/types';

function creds(method: AuthenticationMethod): AdvancedSqlCredentials {
	return { engine: 'mssql', host: 'h', database: 'd', authentication: method };
}

describe('createAuthStrategy', () => {
	it.each([
		['password'],
		['azureManagedIdentity'],
		['servicePrincipal'],
		['oauth2ClientCredentials'],
		['certificate'],
		['apiKey'],
	] as Array<[AuthenticationMethod]>)('maps %s to a strategy of that kind', (method) => {
		const strategy = createAuthStrategy(creds(method), 'cred1');
		expect(strategy.kind).toBe(method);
	});

	it('throws for an unknown method', () => {
		expect(() => createAuthStrategy(creds('nope' as AuthenticationMethod), 'cred1')).toThrow(
			/Unsupported authentication method/,
		);
	});
});
