import type { HostPort, ParsedConnectionString } from './parser.js';
import { ConnectionStringError, formatConnectionString } from './parser.js';
import { formatOdbcConnectionString } from './odbc.js';

export interface BuildOptions {
  /** Format as ODBC "key=value;" instead of a URI-style connection string. */
  odbc?: boolean;
}

function fail(message: string): never {
  throw new ConnectionStringError(message, 'INVALID_BUILD_INPUT');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    fail(`"${field}" must be a string`);
  }
  return value;
}

function toHostPort(value: unknown, index: number): HostPort {
  if (!isPlainObject(value)) {
    fail(`hosts[${index}] must be an object`);
  }
  const host = value.host;
  if (typeof host !== 'string' || host.length === 0) {
    fail(`hosts[${index}].host must be a non-empty string`);
  }
  const port = value.port;
  if (port === undefined) {
    return { host };
  }
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`hosts[${index}].port must be an integer between 1 and 65535`);
  }
  return { host, port };
}

function toParams(value: unknown): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    fail('"params" must be an object');
  }
  const params: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string') {
      fail(`params.${key} must be a string`);
    }
    params[key] = raw;
  }
  return params;
}

/**
 * Validate a plain JSON value into a ParsedConnectionString, the same shape
 * parseConnectionString returns. Used to build a connection string from
 * hand-written or generated JSON rather than by parsing an existing string.
 */
export function connectionStringFromJson(value: unknown): ParsedConnectionString {
  if (!isPlainObject(value)) {
    fail('input must be a JSON object');
  }

  const scheme = value.scheme;
  if (typeof scheme !== 'string' || scheme.length === 0) {
    fail('"scheme" must be a non-empty string');
  }

  const rawHosts = value.hosts;
  let hosts: HostPort[] = [];
  if (rawHosts !== undefined) {
    if (!Array.isArray(rawHosts)) {
      fail('"hosts" must be an array');
    }
    hosts = rawHosts.map((host, index) => toHostPort(host, index));
  }

  return {
    scheme,
    username: asOptionalString(value.username, 'username'),
    password: asOptionalString(value.password, 'password'),
    hosts,
    database: asOptionalString(value.database, 'database'),
    params: toParams(value.params),
  };
}

/**
 * Build a connection string from a JSON object shaped like
 * ParsedConnectionString, e.g. `{ "scheme": "postgres", "hosts": [{ "host": "db1" }] }`.
 * Throws a ConnectionStringError if the shape is invalid.
 */
export function buildConnectionString(value: unknown, options: BuildOptions = {}): string {
  const cs = connectionStringFromJson(value);
  return options.odbc ? formatOdbcConnectionString(cs) : formatConnectionString(cs);
}
