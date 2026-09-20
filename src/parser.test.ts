import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ConnectionStringError,
  formatConnectionString,
  parseConnectionString,
} from './parser.js';

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ConnectionStringError, `expected ConnectionStringError, got ${err}`);
    return (err as ConnectionStringError).code;
  }
  throw new Error('expected function to throw');
}

test('parses a full connection string', () => {
  const cs = parseConnectionString(
    'postgres://app:s3cr3t@db1,db2:5433/orders?sslmode=require',
  );
  assert.equal(cs.scheme, 'postgres');
  assert.equal(cs.username, 'app');
  assert.equal(cs.password, 's3cr3t');
  assert.deepEqual(cs.hosts, [{ host: 'db1' }, { host: 'db2', port: 5433 }]);
  assert.equal(cs.database, 'orders');
  assert.deepEqual(cs.params, { sslmode: 'require' });
});

test('parses a minimal connection string with no userinfo, database, or query', () => {
  const cs = parseConnectionString('redis://localhost');
  assert.equal(cs.scheme, 'redis');
  assert.equal(cs.username, undefined);
  assert.equal(cs.password, undefined);
  assert.deepEqual(cs.hosts, [{ host: 'localhost' }]);
  assert.equal(cs.database, undefined);
  assert.deepEqual(cs.params, {});
});

test('username without a password does not set password', () => {
  const cs = parseConnectionString('mongodb://app@localhost/app');
  assert.equal(cs.username, 'app');
  assert.equal(cs.password, undefined);
});

test('rejects input with no "://"', () => {
  assert.equal(errorCode(() => parseConnectionString('not-a-connection-string')), 'MISSING_SCHEME');
});

test('rejects empty input', () => {
  assert.equal(errorCode(() => parseConnectionString('')), 'EMPTY_INPUT');
});

test('rejects a scheme with illegal characters', () => {
  assert.equal(errorCode(() => parseConnectionString('post gres://localhost')), 'INVALID_SCHEME');
});

test('lenient mode accepts an illegal scheme', () => {
  const cs = parseConnectionString('post gres://localhost', { lenient: true });
  assert.equal(cs.scheme, 'post gres');
});

test('rejects a missing host', () => {
  assert.equal(errorCode(() => parseConnectionString('postgres:///app')), 'MISSING_HOST');
});

test('lenient mode accepts a missing host as an empty host list', () => {
  const cs = parseConnectionString('postgres:///app', { lenient: true });
  assert.deepEqual(cs.hosts, []);
  assert.equal(cs.database, 'app');
});

test('rejects an empty host entry between commas', () => {
  assert.equal(errorCode(() => parseConnectionString('postgres://db1,,db2/app')), 'EMPTY_HOST');
});

test('lenient mode skips empty host entries between commas', () => {
  const cs = parseConnectionString('postgres://db1,,db2/app', { lenient: true });
  assert.deepEqual(cs.hosts, [{ host: 'db1' }, { host: 'db2' }]);
});

test('rejects an out-of-range port', () => {
  assert.equal(errorCode(() => parseConnectionString('mysql://db:99999/app')), 'INVALID_PORT');
});

test('rejects a non-numeric port', () => {
  assert.equal(errorCode(() => parseConnectionString('mysql://db:abc/app')), 'INVALID_PORT');
});

test('lenient mode drops an invalid port instead of throwing', () => {
  const cs = parseConnectionString('mysql://db:99999/app', { lenient: true });
  assert.deepEqual(cs.hosts, [{ host: 'db' }]);
});

test('parses an IPv6 host literal with a port', () => {
  const cs = parseConnectionString('postgres://[::1]:5432/app');
  assert.deepEqual(cs.hosts, [{ host: '::1', port: 5432 }]);
});

test('parses an IPv6 host literal without a port', () => {
  const cs = parseConnectionString('postgres://[::1]/app');
  assert.deepEqual(cs.hosts, [{ host: '::1' }]);
});

test('rejects an unterminated IPv6 literal', () => {
  assert.equal(errorCode(() => parseConnectionString('postgres://[::1/app')), 'INVALID_HOST');
});

test('lenient mode accepts an unterminated IPv6 literal', () => {
  const cs = parseConnectionString('postgres://[::1/app', { lenient: true });
  assert.deepEqual(cs.hosts, [{ host: '::1/app' }]);
});

test('rejects a duplicate query parameter', () => {
  assert.equal(
    errorCode(() => parseConnectionString('mysql://host/app?timeout=5&timeout=10')),
    'DUPLICATE_PARAM',
  );
});

test('lenient mode keeps the last value for a duplicate query parameter', () => {
  const cs = parseConnectionString('mysql://host/app?timeout=5&timeout=10', { lenient: true });
  assert.deepEqual(cs.params, { timeout: '10' });
});

test('a query parameter with no "=" gets an empty string value', () => {
  const cs = parseConnectionString('mysql://host/app?ssl');
  assert.deepEqual(cs.params, { ssl: '' });
});

test('rejects a fragment', () => {
  assert.equal(
    errorCode(() => parseConnectionString('postgres://host/app#section')),
    'UNEXPECTED_FRAGMENT',
  );
});

test('lenient mode strips a fragment', () => {
  const cs = parseConnectionString('postgres://host/app#section', { lenient: true });
  assert.equal(cs.database, 'app');
});

test('rejects unencoded whitespace in the username', () => {
  assert.equal(
    errorCode(() => parseConnectionString('postgres://my user:pw@host/app')),
    'UNSAFE_CHARACTER',
  );
});

test('percent-decodes username, password, database, and query values', () => {
  const cs = parseConnectionString('postgres://a%40b:p%3Aw@host/my%2Fdb?k=%26v');
  assert.equal(cs.username, 'a@b');
  assert.equal(cs.password, 'p:w');
  assert.equal(cs.database, 'my/db');
  assert.deepEqual(cs.params, { k: '&v' });
});

test('rejects malformed percent-encoding', () => {
  assert.equal(errorCode(() => parseConnectionString('postgres://host/app?%')), 'INVALID_ENCODING');
});

test('lenient mode passes through malformed percent-encoding as-is', () => {
  const cs = parseConnectionString('postgres://host/app?a=%zz', { lenient: true });
  assert.deepEqual(cs.params, { a: '%zz' });
});

test('round-trips through format and parse', () => {
  const original = 'postgres://app:s3cr3t@db1,db2:5433/orders?sslmode=require';
  const cs = parseConnectionString(original);
  assert.equal(formatConnectionString(cs), original);
});

test('formatConnectionString percent-encodes an IPv6 host in brackets', () => {
  const cs = parseConnectionString('postgres://[::1]:5432/app');
  assert.equal(formatConnectionString(cs), 'postgres://[::1]:5432/app');
});

test('formatConnectionString encodes special characters back out', () => {
  const cs = parseConnectionString('postgres://a%40b:p%3Aw@host/my%2Fdb?k=%26v');
  assert.equal(formatConnectionString(cs), 'postgres://a%40b:p%3Aw@host/my%2Fdb?k=%26v');
});
