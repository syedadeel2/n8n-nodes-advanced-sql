import type { AdvancedSqlCredentials } from './types';

const TOKEN_LIKE = /\b(eyJ[A-Za-z0-9._-]{10,})\b/g; // JWT-shaped tokens

/**
 * Scrubs known secret material from a string before it is surfaced in node
 * output, an error message, or a log line. Callers pass any concrete secret
 * values they hold so exact matches are removed even when non-JWT-shaped.
 */
export function redact(input: unknown, secrets: Array<string | undefined> = []): string {
	let text = typeof input === 'string' ? input : String((input as Error)?.message ?? input);

	for (const secret of secrets) {
		if (secret && secret.length >= 4) {
			text = text.split(secret).join('***');
		}
	}

	return text.replace(TOKEN_LIKE, '***');
}

/** Collects every secret-bearing field from a credential bag for redaction. */
export function collectSecrets(c: AdvancedSqlCredentials): Array<string | undefined> {
	return [c.password, c.clientSecret, c.oauthClientSecret, c.pem, c.accessToken];
}
