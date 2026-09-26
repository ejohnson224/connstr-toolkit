import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConnectionStringError } from './parser.js';
import { buildConnectionString, connectionStringFromJson } from './build.js';

function errorMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ConnectionStringError, `expected ConnectionStringError, got ${err}`);
    assert.equal((err as ConnectionStringError).code, 'INVALID_BUILD_INPUT');
    return (err as ConnectionStringError).message;
  }
  throw new Error('expected function to throw');
}

test('builds a full connection string from JSON', () => {
  const out = buildConnectionString({
    scheme: 'postgres',
    username: 'app',
    password: 's3cr3t',
    hosts: [{ host: 'db1' }, { host: 'db2', port: 5433 }],
    database: 'orders',
    params: { sslmode: 'require' },
  });
  assert.equal(out, 'postgres://app:s3cr3t@db1,db2:5433/orders?sslmode=require');
});

test('builds a minimal connection string from JSON with only a scheme and host', () => {
  const out = buildConnectionString({ scheme: 'redis', hosts: [{ host: 'localhost' }] });
  assert.equal(out, 'redis://localhost');
});

test('missing hosts, database, and params all default sensibly', () => {
  const out = buildConnectionString({ scheme: 'redis' });
  assert.equal(out, 'redis://');
});

test('builds an ODBC-style string when odbc is set', () => {
  const out = buildConnectionString(
    {
      scheme: 'odbc',
      hosts: [{ host: 'db1', port: 5433 }],
      database: 'orders',
      username: 'app',
      password: 's3cr3t',
    },
    { odbc: true },
  );
  assert.equal(out, 'Server=db1;Port=5433;Database=orders;Uid=app;Pwd=s3cr3t;');
});

test('round-trips a parsed connection string through connectionStringFromJson', () => {
  const cs = connectionStringFromJson({
    scheme: 'postgres',
    hosts: [{ host: 'db1' }],
    params: { sslmode: 'require' },
  });
  assert.deepEqual(cs, {
    scheme: 'postgres',
    username: undefined,
    password: undefined,
    hosts: [{ host: 'db1' }],
    database: undefined,
    params: { sslmode: 'require' },
  });
});

test('rejects non-object input', () => {
  assert.equal(errorMessage(() => buildConnectionString('postgres://localhost')), 'input must be a JSON object');
});

test('rejects a missing scheme', () => {
  assert.equal(errorMessage(() => buildConnectionString({ hosts: [{ host: 'db1' }] })), '"scheme" must be a non-empty string');
});

test('rejects a non-array hosts field', () => {
  assert.equal(
    errorMessage(() => buildConnectionString({ scheme: 'postgres', hosts: 'db1' })),
    '"hosts" must be an array',
  );
});

test('rejects a host entry missing a host field', () => {
  assert.equal(
    errorMessage(() => buildConnectionString({ scheme: 'postgres', hosts: [{ port: 5432 }] })),
    'hosts[0].host must be a non-empty string',
  );
});

test('rejects an out-of-range port', () => {
  assert.equal(
    errorMessage(() => buildConnectionString({ scheme: 'postgres', hosts: [{ host: 'db1', port: 99999 }] })),
    'hosts[0].port must be an integer between 1 and 65535',
  );
});

test('rejects a non-string param value', () => {
  assert.equal(
    errorMessage(() => buildConnectionString({ scheme: 'postgres', params: { timeout: 5 } })),
    'params.timeout must be a string',
  );
});

test('rejects a non-string username', () => {
  assert.equal(
    errorMessage(() => buildConnectionString({ scheme: 'postgres', username: 5 })),
    '"username" must be a string',
  );
});
