import { TokenCache } from '../nodes/AdvancedSql/auth/TokenCache';
import type { CachedAccessToken } from '../nodes/AdvancedSql/auth/types';

class FakeClockCache extends TokenCache {
	public current = 1_000_000;
	protected now(): number {
		return this.current;
	}
}

describe('TokenCache', () => {
	it('returns a cached token before the refresh skew', async () => {
		const cache = new FakeClockCache();
		const acquire = jest
			.fn<Promise<CachedAccessToken>, []>()
			.mockResolvedValue({ token: 'A', expiresOnTimestamp: cache.current + 60 * 60 * 1000 });

		expect(await cache.getToken('k', acquire)).toBe('A');
		expect(await cache.getToken('k', acquire)).toBe('A');
		expect(acquire).toHaveBeenCalledTimes(1);
	});

	it('refreshes once the token is within the skew window', async () => {
		const cache = new FakeClockCache();
		const acquire = jest
			.fn<Promise<CachedAccessToken>, []>()
			.mockResolvedValueOnce({ token: 'A', expiresOnTimestamp: cache.current + 60 * 1000 })
			.mockResolvedValueOnce({ token: 'B', expiresOnTimestamp: cache.current + 60 * 60 * 1000 });

		expect(await cache.getToken('k', acquire)).toBe('A');
		cache.current += 2 * 60 * 1000; // advance past expiry (skew is 5 min)
		expect(await cache.getToken('k', acquire)).toBe('B');
		expect(acquire).toHaveBeenCalledTimes(2);
	});

	it('collapses concurrent misses into a single acquire (single-flight)', async () => {
		const cache = new FakeClockCache();
		let resolve!: (t: CachedAccessToken) => void;
		const acquire = jest.fn<Promise<CachedAccessToken>, []>(
			() => new Promise((r) => (resolve = r)),
		);

		const p1 = cache.getToken('k', acquire);
		const p2 = cache.getToken('k', acquire);
		resolve({ token: 'A', expiresOnTimestamp: cache.current + 60 * 60 * 1000 });

		expect(await p1).toBe('A');
		expect(await p2).toBe('A');
		expect(acquire).toHaveBeenCalledTimes(1);
	});

	it('throws when acquisition yields no token', async () => {
		const cache = new FakeClockCache();
		await expect(cache.getToken('k', async () => null)).rejects.toThrow(/no token/);
	});
});
