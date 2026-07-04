import { buildInsert, buildUpdate, buildDelete } from '../nodes/AdvancedSql/db/builders';

describe('query builders', () => {
	it('builds a parameterised mssql INSERT', () => {
		const { query, params } = buildInsert('mssql', 'dbo.Users', { name: 'a', age: 30 });
		expect(query).toBe('INSERT INTO [dbo].[Users] ([name], [age]) VALUES (@p1, @p2)');
		expect(params).toEqual(['a', 30]);
	});

	it('builds a parameterised postgres INSERT', () => {
		const { query, params } = buildInsert('postgres', 'users', { name: 'a' });
		expect(query).toBe('INSERT INTO "users" ("name") VALUES ($1)');
		expect(params).toEqual(['a']);
	});

	it('builds UPDATE with set + where params in order', () => {
		const { query, params } = buildUpdate('postgres', 'users', { name: 'x' }, { id: 5 });
		expect(query).toBe('UPDATE "users" SET "name" = $1 WHERE "id" = $2');
		expect(params).toEqual(['x', 5]);
	});

	it('refuses UPDATE without a WHERE clause', () => {
		expect(() => buildUpdate('mssql', 't', { a: 1 }, {})).toThrow(/WHERE/);
	});

	it('refuses DELETE without a WHERE clause', () => {
		expect(() => buildDelete('mssql', 't', {})).toThrow(/WHERE/);
	});

	it('rejects invalid identifiers (injection guard)', () => {
		expect(() => buildInsert('mssql', 'users; DROP TABLE x', { a: 1 })).toThrow(
			/Invalid identifier/,
		);
	});
});
