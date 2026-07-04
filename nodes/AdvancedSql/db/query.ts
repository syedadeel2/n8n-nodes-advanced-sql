import type { DbPool, QueryOptions } from './pool';

export type QueryParameters = unknown[] | Record<string, unknown> | undefined | null;

export interface QueryResult {
	rows: Array<Record<string, unknown>>;
	rowCount: number;
}

/**
 * Executes a parameterised query. Values are always bound via the driver's
 * parameter API — never string-interpolated — to prevent SQL injection.
 *
 * - mssql: array values bind as @p1..@pn; object values bind by key (@key).
 * - postgres: array values bind positionally as $1..$n. Named-object params are
 *   not supported by the pg wire protocol; pass an array instead.
 */
export async function runQuery(
	pool: DbPool,
	query: string,
	params: QueryParameters,
	options: QueryOptions,
): Promise<QueryResult> {
	if (pool.engine === 'mssql') {
		return runMssql(pool, query, params, options);
	}
	return runPostgres(pool, query, params);
}

async function runMssql(
	pool: DbPool,
	query: string,
	params: QueryParameters,
	options: QueryOptions,
): Promise<QueryResult> {
	const connection = pool.native as import('mssql').ConnectionPool;
	const request = connection.request();
	// Request timeout is applied at the pool config level (requestTimeout); the
	// mssql Request has no per-request timeout setter in the v11 typings.
	void options;

	if (Array.isArray(params)) {
		params.forEach((value, i) => request.input(`p${i + 1}`, value));
	} else if (params && typeof params === 'object') {
		for (const [key, value] of Object.entries(params)) request.input(key, value);
	}

	const result = await request.query(query);
	const rows = (result.recordset ?? []) as Array<Record<string, unknown>>;
	return {
		rows,
		rowCount: Array.isArray(result.rowsAffected)
			? result.rowsAffected.reduce((a, b) => a + b, 0) || rows.length
			: rows.length,
	};
}

async function runPostgres(
	pool: DbPool,
	query: string,
	params: QueryParameters,
): Promise<QueryResult> {
	if (params && !Array.isArray(params) && typeof params === 'object') {
		throw new Error(
			'PostgreSQL does not support named parameters; pass parameters as a positional array ($1..$n).',
		);
	}
	const pg = pool.native as import('pg').Pool;
	const values = Array.isArray(params) ? params : [];
	const result = await pg.query(query, values);
	return {
		rows: (result.rows ?? []) as Array<Record<string, unknown>>,
		rowCount: result.rowCount ?? result.rows?.length ?? 0,
	};
}
