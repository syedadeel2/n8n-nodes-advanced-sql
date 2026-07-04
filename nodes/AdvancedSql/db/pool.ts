import { createHash } from 'crypto';
import type { AdvancedSqlCredentials, DriverAuthConfig, SqlEngine } from '../auth/types';

export interface QueryOptions {
	queryTimeout?: number;
	poolMax?: number;
}

export interface DbPool {
	engine: SqlEngine;
	/** Native pool handle (mssql.ConnectionPool or pg.Pool). */
	native: unknown;
}

interface PoolEntry {
	pool: DbPool;
	tokenFingerprint: string;
	lastUsed: number;
}

const POOL_TTL_MS = 5 * 60 * 1000;

/**
 * Module-scoped pool cache. The fingerprint deliberately excludes the token so
 * short-lived tokens don't churn pools; when a token-based auth rotates its
 * token we rebuild the pool so new connections use the fresh credential.
 */
class ConnectionPoolManager {
	private pools = new Map<string, PoolEntry>();

	private fingerprint(engine: SqlEngine, c: AdvancedSqlCredentials): string {
		const raw = [engine, c.host, c.port, c.database, c.authentication, c.user].join('|');
		return createHash('sha256').update(raw).digest('hex');
	}

	private tokenFingerprint(auth: DriverAuthConfig): string {
		const secret = auth.mssql?.options.token ?? auth.postgres?.password ?? auth.mssql?.options.password ?? '';
		return secret ? createHash('sha256').update(secret).digest('hex') : 'static';
	}

	async acquire(
		engine: SqlEngine,
		creds: AdvancedSqlCredentials,
		auth: DriverAuthConfig,
		options: QueryOptions,
	): Promise<DbPool> {
		this.evictStale();
		const key = this.fingerprint(engine, creds);
		const tfp = this.tokenFingerprint(auth);
		const existing = this.pools.get(key);

		if (existing && existing.tokenFingerprint === tfp) {
			existing.lastUsed = Date.now();
			return existing.pool;
		}

		// Token rotated (or first use): dispose any stale pool and build fresh.
		if (existing) {
			await this.dispose(existing.pool).catch(() => undefined);
			this.pools.delete(key);
		}

		const pool =
			engine === 'mssql'
				? await this.createMssqlPool(creds, auth, options)
				: await this.createPostgresPool(creds, auth, options);

		this.pools.set(key, { pool, tokenFingerprint: tfp, lastUsed: Date.now() });
		return pool;
	}

	private async createMssqlPool(
		creds: AdvancedSqlCredentials,
		auth: DriverAuthConfig,
		options: QueryOptions,
	): Promise<DbPool> {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const mssql = require('mssql') as typeof import('mssql');
		const config: import('mssql').config = {
			server: creds.host,
			port: creds.port ?? 1433,
			database: creds.database,
			options: {
				encrypt: creds.ssl !== false,
				trustServerCertificate: creds.trustServerCertificate === true,
			},
			authentication: auth.mssql as unknown as import('mssql').config['authentication'],
			requestTimeout: options.queryTimeout ?? 30000,
			pool: { max: options.poolMax ?? 10, min: 0, idleTimeoutMillis: 30000 },
		};
		const pool = new mssql.ConnectionPool(config);
		await pool.connect();
		return { engine: 'mssql', native: pool };
	}

	private async createPostgresPool(
		creds: AdvancedSqlCredentials,
		auth: DriverAuthConfig,
		options: QueryOptions,
	): Promise<DbPool> {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { Pool } = require('pg') as typeof import('pg');
		const pool = new Pool({
			host: creds.host,
			port: creds.port ?? 5432,
			database: creds.database,
			user: auth.postgres?.user,
			password: auth.postgres?.password,
			ssl: creds.ssl !== false ? { rejectUnauthorized: creds.trustServerCertificate !== true } : false,
			max: options.poolMax ?? 10,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: options.queryTimeout ?? 30000,
		});
		return { engine: 'postgres', native: pool };
	}

	private async dispose(pool: DbPool): Promise<void> {
		if (pool.engine === 'mssql') {
			await (pool.native as import('mssql').ConnectionPool).close();
		} else {
			await (pool.native as import('pg').Pool).end();
		}
	}

	private evictStale(): void {
		const now = Date.now();
		for (const [key, entry] of this.pools) {
			if (now - entry.lastUsed > POOL_TTL_MS) {
				void this.dispose(entry.pool).catch(() => undefined);
				this.pools.delete(key);
			}
		}
	}

	/** Test helper. */
	async clear(): Promise<void> {
		for (const entry of this.pools.values()) {
			await this.dispose(entry.pool).catch(() => undefined);
		}
		this.pools.clear();
	}
}

export const poolManager = new ConnectionPoolManager();
