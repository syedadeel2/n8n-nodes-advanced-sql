import type { SqlEngine } from '../auth/types';

export interface BuiltQuery {
	query: string;
	params: unknown[];
}

/** Quotes a SQL identifier for the target engine, rejecting invalid names. */
function quoteIdent(engine: SqlEngine, name: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_$.]*$/.test(name)) {
		throw new Error(`Invalid identifier: ${name}`);
	}
	// Support schema-qualified names (schema.table) by quoting each part.
	const parts = name.split('.');
	if (engine === 'mssql') return parts.map((p) => `[${p}]`).join('.');
	return parts.map((p) => `"${p}"`).join('.');
}

/** Placeholder token for the Nth (1-based) parameter. */
function placeholder(engine: SqlEngine, index: number): string {
	return engine === 'mssql' ? `@p${index}` : `$${index}`;
}

export function buildInsert(
	engine: SqlEngine,
	table: string,
	columns: Record<string, unknown>,
): BuiltQuery {
	const keys = Object.keys(columns);
	if (keys.length === 0) throw new Error('Insert requires at least one column');
	const cols = keys.map((k) => quoteIdent(engine, k)).join(', ');
	const vals = keys.map((_, i) => placeholder(engine, i + 1)).join(', ');
	const params = keys.map((k) => columns[k]);
	return { query: `INSERT INTO ${quoteIdent(engine, table)} (${cols}) VALUES (${vals})`, params };
}

export function buildUpdate(
	engine: SqlEngine,
	table: string,
	columns: Record<string, unknown>,
	where: Record<string, unknown>,
): BuiltQuery {
	const setKeys = Object.keys(columns);
	const whereKeys = Object.keys(where);
	if (setKeys.length === 0) throw new Error('Update requires at least one column to set');
	if (whereKeys.length === 0) {
		throw new Error('Update requires a WHERE clause to avoid updating every row');
	}

	const params: unknown[] = [];
	const setClause = setKeys
		.map((k) => {
			params.push(columns[k]);
			return `${quoteIdent(engine, k)} = ${placeholder(engine, params.length)}`;
		})
		.join(', ');
	const whereClause = whereKeys
		.map((k) => {
			params.push(where[k]);
			return `${quoteIdent(engine, k)} = ${placeholder(engine, params.length)}`;
		})
		.join(' AND ');

	return {
		query: `UPDATE ${quoteIdent(engine, table)} SET ${setClause} WHERE ${whereClause}`,
		params,
	};
}

export function buildDelete(
	engine: SqlEngine,
	table: string,
	where: Record<string, unknown>,
): BuiltQuery {
	const whereKeys = Object.keys(where);
	if (whereKeys.length === 0) {
		throw new Error('Delete requires a WHERE clause to avoid deleting every row');
	}
	const params: unknown[] = [];
	const whereClause = whereKeys
		.map((k) => {
			params.push(where[k]);
			return `${quoteIdent(engine, k)} = ${placeholder(engine, params.length)}`;
		})
		.join(' AND ');
	return { query: `DELETE FROM ${quoteIdent(engine, table)} WHERE ${whereClause}`, params };
}
