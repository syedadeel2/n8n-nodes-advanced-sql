import { AdvancedSql } from '../nodes/AdvancedSql/AdvancedSql.node';
import { poolManager } from '../nodes/AdvancedSql/db/pool';
import * as queryModule from '../nodes/AdvancedSql/db/query';

jest.mock('../nodes/AdvancedSql/db/pool', () => ({
	poolManager: { acquire: jest.fn().mockResolvedValue({ engine: 'mssql', native: {} }) },
}));

/** Builds a minimal IExecuteFunctions stub with the given per-run params. */
function makeContext(params: Record<string, unknown>, itemCount = 1, continueOnFail = false) {
	return {
		getInputData: () => Array.from({ length: itemCount }, () => ({ json: {} })),
		getCredentials: async () => ({
			engine: 'mssql',
			host: 'h',
			database: 'd',
			authentication: 'password',
			user: 'sa',
			password: 'SuperSecret123',
		}),
		getNode: () => ({ credentials: { advancedSqlApi: { id: 'cred1' } }, name: 'Advanced SQL' }),
		getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		continueOnFail: () => continueOnFail,
	} as never;
}

describe('AdvancedSql.execute', () => {
	it('runs a query and maps rows to items', async () => {
		const spy = jest
			.spyOn(queryModule, 'runQuery')
			.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 });

		const ctx = makeContext({
			operation: 'executeQuery',
			query: 'SELECT * FROM t WHERE id = @p1',
			parameters: '[1]',
			options: {},
		});

		const [out] = await new AdvancedSql().execute.call(ctx);
		expect(out.map((o) => o.json)).toEqual([{ id: 1 }, { id: 2 }]);
		expect(spy).toHaveBeenCalledWith(
			expect.anything(),
			'SELECT * FROM t WHERE id = @p1',
			[1],
			{},
		);
		expect(poolManager.acquire).toHaveBeenCalled();
	});

	it('builds an INSERT from table + columns', async () => {
		const spy = jest
			.spyOn(queryModule, 'runQuery')
			.mockResolvedValue({ rows: [], rowCount: 1 });

		const ctx = makeContext({
			operation: 'insert',
			table: 'dbo.Users',
			columns: '{"name":"Ada"}',
			options: {},
		});

		const [out] = await new AdvancedSql().execute.call(ctx);
		expect(spy).toHaveBeenCalledWith(
			expect.anything(),
			'INSERT INTO [dbo].[Users] ([name]) VALUES (@p1)',
			['Ada'],
			{},
		);
		expect(out[0].json).toEqual({ success: true, rowCount: 1 });
	});

	it('redacts secrets from error output when continueOnFail is set', async () => {
		jest
			.spyOn(queryModule, 'runQuery')
			.mockRejectedValue(new Error('Login failed for password=SuperSecret123'));

		const ctx = makeContext(
			{ operation: 'executeQuery', query: 'SELECT 1', parameters: '[]', options: {} },
			1,
			true,
		);

		const [out] = await new AdvancedSql().execute.call(ctx);
		expect(String(out[0].json.error)).not.toContain('SuperSecret123');
		expect(String(out[0].json.error)).toContain('***');
	});
});
