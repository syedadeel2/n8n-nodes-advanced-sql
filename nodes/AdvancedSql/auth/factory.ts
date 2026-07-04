import type { AdvancedSqlCredentials, IAuthStrategy } from './types';
import { PasswordStrategy } from './strategies/PasswordStrategy';
import { ManagedIdentityStrategy } from './strategies/ManagedIdentityStrategy';
import { ServicePrincipalStrategy } from './strategies/ServicePrincipalStrategy';
import { OAuth2ClientCredentialsStrategy } from './strategies/OAuth2ClientCredentialsStrategy';
import { CertificateStrategy } from './strategies/CertificateStrategy';
import { ApiKeyStrategy } from './strategies/ApiKeyStrategy';

/** Selects the auth strategy for a credential bag. */
export function createAuthStrategy(
	creds: AdvancedSqlCredentials,
	credentialId: string,
): IAuthStrategy {
	switch (creds.authentication) {
		case 'password':
			return new PasswordStrategy(creds);
		case 'azureManagedIdentity':
			return new ManagedIdentityStrategy(creds, credentialId);
		case 'servicePrincipal':
			return new ServicePrincipalStrategy(creds, credentialId);
		case 'oauth2ClientCredentials':
			return new OAuth2ClientCredentialsStrategy(creds, credentialId);
		case 'certificate':
			return new CertificateStrategy(creds, credentialId);
		case 'apiKey':
			return new ApiKeyStrategy(creds);
		default:
			throw new Error(
				`Unsupported authentication method: ${String((creds as AdvancedSqlCredentials).authentication)}`,
			);
	}
}
