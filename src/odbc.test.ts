import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConnectionStringError } from './parser.js';
import { formatOdbcConnectionString, parseOdbcConnectionString } from './odbc.js';

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ConnectionStringError, `expected ConnectionStringError, got ${err}`);
    return (err as ConnectionStringError).code;
  }
  throw new Error('expected function to throw');
}

test('parses a full ODBC connection string', () => {
  const cs = parseOdbcConnectionString(
    'Driver={PostgreSQL};Server=db1;Port=5433;Database=orders;Uid=app;Pwd=s3cr3t;',
  );
  assert.equal(cs.scheme, 'odbc');
  assert.equal(cs.username, 'app');
  assert.equal(cs.password, 's3cr3t');
  assert.deepEqual(cs.hosts, [{ host: 'db1', port: 5433 }]);
  assert.equal(cs.database, 'orders');
  assert.deepEqual(cs.params, { driver: 'PostgreSQL' });
});

test('matches keys case-insensitively and trims surrounding whitespace', () => {
  const cs = parseOdbcConnectionString(' SERVER = db1 ; UID=app ; PWD=s3cr3t ; DATABASE=orders ');
  assert.deepEqual(cs.hosts, [{ host: 'db1', port: undefined }]);
  assert.equal(cs.username, 'app');
  assert.equal(cs.password, 's3cr3t');
  assert.equal(cs.database, 'orders');
});

test('accepts alternate spellings for host, user, and database keys', () => {
  const cs = parseOdbcConnectionString('Data Source=db1;User Id=app;Initial Catalog=orders;');
  assert.deepEqual(cs.hosts, [{ host: 'db1', port: undefined }]);
  assert.equal(cs.username, 'app');
  assert.equal(cs.database, 'orders');
});

test('a brace-quoted value may contain semicolons and equals signs', () => {
  const cs = parseOdbcConnectionString('Server=db1;Database={orders;q=1};');
  assert.equal(cs.database, 'orders;q=1');
});

test('a doubled closing brace inside a quoted value is a literal "}"', () => {
  const cs = parseOdbcConnectionString('Server=db1;Database={a}}b};');
  assert.equal(cs.database, 'a}b');
});

test('rejects a pair with no "="', () => {
  assert.equal(errorCode(() => parseOdbcConnectionString('Server=db1;garbage;')), 'MALFORMED_PAIR');
});

test('lenient mode skips a pair with no "="', () => {
  const cs = parseOdbcConnectionString('Server=db1;garbage;', { lenient: true });
  assert.deepEqual(cs.hosts, [{ host: 'db1', port: undefined }]);
});

test('rejects an unterminated brace-quoted value', () => {
  assert.equal(
    errorCode(() => parseOdbcConnectionString('Server=db1;Database={orders;')),
    'INVALID_ODBC_VALUE',
  );
});

test('rejects a duplicate key', () => {
  assert.equal(
    errorCode(() => parseOdbcConnectionString('Server=db1;Server=db2;')),
    'DUPLICATE_PARAM',
  );
});

test('lenient mode keeps the last value for a duplicate key', () => {
  const cs = parseOdbcConnectionString('Server=db1;Server=db2;', { lenient: true });
  assert.deepEqual(cs.hosts, [{ host: 'db2', port: undefined }]);
});

test('rejects an out-of-range port', () => {
  assert.equal(
    errorCode(() => parseOdbcConnectionString('Server=db1;Port=99999;')),
    'INVALID_PORT',
  );
});

test('lenient mode drops an invalid port instead of throwing', () => {
  const cs = parseOdbcConnectionString('Server=db1;Port=abc;', { lenient: true });
  assert.deepEqual(cs.hosts, [{ host: 'db1', port: undefined }]);
});

test('rejects a missing host', () => {
  assert.equal(errorCode(() => parseOdbcConnectionString('Database=orders;')), 'MISSING_HOST');
});

test('lenient mode accepts a missing host as an empty host list', () => {
  const cs = parseOdbcConnectionString('Database=orders;', { lenient: true });
  assert.deepEqual(cs.hosts, []);
  assert.equal(cs.database, 'orders');
});

test('rejects empty input', () => {
  assert.equal(errorCode(() => parseOdbcConnectionString('')), 'EMPTY_INPUT');
});

test('formatOdbcConnectionString round-trips a parsed connection string', () => {
  const cs = parseOdbcConnectionString('Server=db1;Port=5433;Database=orders;Uid=app;Pwd=s3cr3t;');
  const formatted = formatOdbcConnectionString(cs);
  assert.equal(formatted, 'Server=db1;Port=5433;Database=orders;Uid=app;Pwd=s3cr3t;');
  assert.deepEqual(parseOdbcConnectionString(formatted), cs);
});

test('formatOdbcConnectionString brace-quotes a value containing a semicolon', () => {
  const cs = parseOdbcConnectionString('Server=db1;Database={orders;test};');
  assert.equal(formatOdbcConnectionString(cs), 'Server=db1;Database={orders;test};');
});

test('formatOdbcConnectionString rejects more than one host', () => {
  const cs = parseOdbcConnectionString('Server=db1;');
  cs.hosts.push({ host: 'db2' });
  assert.equal(errorCode(() => formatOdbcConnectionString(cs)), 'MULTIPLE_HOSTS');
});
