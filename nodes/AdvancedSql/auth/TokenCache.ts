import type { CachedAccessToken } from './types';

const SKEW_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

/**
 * Module-scoped, in-memory token cache with single-flight refresh.
 *
 * Azure's docs are explicit that when you call `getToken()` directly you must
 * handle caching and refreshing yourself. This cache is keyed by
 * `credentialId:authType:scope` so tokens never leak across credentials, is
 * never persisted to disk, and collapses concurrent refreshes into one request.
 */
export class TokenCache {
	private store = new Map<string, CachedAccessToken>();
	private inflight = new Map<string, Promise<CachedAccessToken>>();

	/** Returns a valid token string, acquiring/refreshing via `acquire` on miss. */
	async getToken(
		key: string,
		acquire: () => Promise<CachedAccessToken | null>,
	): Promise<string> {
		const cached = this.store.get(key);
		if (cached && cached.expiresOnTimestamp - SKEW_MS > this.now()) {
			return cached.token;
		}

		let pending = this.inflight.get(key);
		if (!pending) {
			pending = (async () => {
				const token = await acquire();
				if (!token || !token.token) {
					throw new Error('Token acquisition returned no token');
				}
				this.store.set(key, token);
				return token;
			})().finally(() => this.inflight.delete(key));
			this.inflight.set(key, pending);
		}

		return (await pending).token;
	}

	/** Overridable for deterministic tests. */
	protected now(): number {
		return Date.now();
	}

	/** Test/maintenance helper. */
	clear(): void {
		this.store.clear();
		this.inflight.clear();
	}
}

export const tokenCache = new TokenCache();
