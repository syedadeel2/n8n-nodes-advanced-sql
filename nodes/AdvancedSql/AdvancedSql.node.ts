import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { AdvancedSqlCredentials } from './auth/types';
import { createAuthStrategy } from './auth/factory';
import { collectSecrets, redact } from './auth/redact';
import { poolManager, type QueryOptions } from './db/pool';
import { runQuery, type QueryParameters } from './db/query';
import { buildInsert, buildUpdate, buildDelete } from './db/builders';

export class AdvancedSql implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Advanced SQL',
		name: 'advancedSql',
		icon: 'file:advancedsql.svg',
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Run SQL with pluggable enterprise authentication (Azure Managed Identity, service principal, OAuth2, certificate, API key, password)',
		defaults: { name: 'Advanced SQL' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'advancedSqlApi', required: true }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'executeQuery',
				options: [
					{ name: 'Execute Query', value: 'executeQuery', action: 'Execute a SQL query' },
					{ name: 'Insert', value: 'insert', action: 'Insert rows' },
					{ name: 'Update', value: 'update', action: 'Update rows' },
					{ name: 'Delete', value: 'delete', action: 'Delete rows' },
				],
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				typeOptions: { editor: 'sqlEditor', rows: 6 },
				default: '',
				displayOptions: { show: { operation: ['executeQuery'] } },
				description:
					'Use parameter placeholders (mssql: @p1/@name, postgres: $1). Never string-concatenate values.',
			},
			{
				displayName: 'Parameters',
				name: 'parameters',
				type: 'json',
				default: '[]',
				displayOptions: { show: { operation: ['executeQuery'] } },
				description:
					'Array (positional) or object (named, mssql only) of values bound to placeholders.',
			},
			{
				displayName: 'Table',
				name: 'table',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['insert', 'update', 'delete'] } },
			},
			{
				displayName: 'Columns (JSON Object)',
				name: 'columns',
				type: 'json',
				default: '{}',
				displayOptions: { show: { operation: ['insert', 'update'] } },
				description: 'Column/value map to write.',
			},
			{
				displayName: 'Where (JSON Object)',
				name: 'where',
				type: 'json',
				default: '{}',
				displayOptions: { show: { operation: ['update', 'delete'] } },
				description: 'Column/value equality map used to build the WHERE clause.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Query Timeout (Ms)',
						name: 'queryTimeout',
						type: 'number',
						default: 30000,
					},
					{ displayName: 'Pool Max', name: 'poolMax', type: 'number', default: 10 },
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const creds = (await this.getCredentials(
			'advancedSqlApi',
		)) as unknown as AdvancedSqlCredentials;
		const credentialId = this.getNode().credentials?.advancedSqlApi?.id ?? 'anon';
		const secrets = collectSecrets(creds);
		const engine = creds.engine;

		let authConfig;
		try {
			authConfig = await createAuthStrategy(creds, credentialId).getConnectionConfig();
		} catch (error) {
			throw new NodeOperationError(this.getNode(), redact(error, secrets));
		}

		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const options = this.getNodeParameter('options', i, {}) as QueryOptions;
				const pool = await poolManager.acquire(engine, creds, authConfig, options);

				let query: string;
				let params: QueryParameters;

				if (operation === 'executeQuery') {
					query = this.getNodeParameter('query', i, '') as string;
					params = parseJsonParam(this.getNodeParameter('parameters', i, []));
				} else {
					const table = this.getNodeParameter('table', i) as string;
					const columns = parseObjectParam(this.getNodeParameter('columns', i, {}));
					const where = parseObjectParam(this.getNodeParameter('where', i, {}));
					const built =
						operation === 'insert'
							? buildInsert(engine, table, columns)
							: operation === 'update'
								? buildUpdate(engine, table, columns, where)
								: buildDelete(engine, table, where);
					query = built.query;
					params = built.params;
				}

				const result = await runQuery(pool, query, params, options);
				if (result.rows.length > 0) {
					returnData.push(
						...result.rows.map((row) => ({
							json: row as IDataObject,
							pairedItem: { item: i },
						})),
					);
				} else {
					returnData.push({
						json: { success: true, rowCount: result.rowCount },
						pairedItem: { item: i },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: redact(error, secrets) },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), redact(error, secrets), { itemIndex: i });
			}
		}

		return [returnData];
	}
}

function parseJsonParam(value: unknown): QueryParameters {
	if (value === undefined || value === null || value === '') return [];
	if (typeof value === 'string') {
		const parsed = JSON.parse(value);
		return parsed as QueryParameters;
	}
	return value as QueryParameters;
}

function parseObjectParam(value: unknown): Record<string, unknown> {
	if (value === undefined || value === null || value === '') return {};
	const parsed = typeof value === 'string' ? JSON.parse(value) : value;
	if (Array.isArray(parsed) || typeof parsed !== 'object') {
		throw new Error('Expected a JSON object of column/value pairs');
	}
	return parsed as Record<string, unknown>;
}
