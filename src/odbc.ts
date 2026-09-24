import type { HostPort, ParsedConnectionString, ParseOptions } from './parser.js';
import { ConnectionStringError } from './parser.js';

function fail(message: string, code: string): never {
  throw new ConnectionStringError(message, code);
}

// ODBC/SQL Server style connection strings don't have a single canonical key
// per concept - drivers accept several spellings for the same setting.
const HOST_KEYS = new Set(['server', 'host', 'data source', 'addr', 'address', 'network address']);
const PORT_KEYS = new Set(['port']);
const DATABASE_KEYS = new Set(['database', 'initial catalog', 'db']);
const USERNAME_KEYS = new Set(['uid', 'user', 'user id', 'username']);
const PASSWORD_KEYS = new Set(['pwd', 'password']);

/**
 * Split "key=value;key2=value2" on unescaped semicolons. A value wrapped in
 * `{...}` may contain semicolons and equals signs; a literal `}` inside such
 * a value is written as `}}`, per the ODBC convention.
 */
function splitPairs(input: string): string[] {
  const pairs: string[] = [];
  let current = '';
  let inBrace = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inBrace) {
      if (ch === '}') {
        if (input[i + 1] === '}') {
          current += '}}';
          i++;
        } else {
          inBrace = false;
          current += ch;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '{') {
      inBrace = true;
      current += ch;
    } else if (ch === ';') {
      pairs.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) {
    pairs.push(current);
  }
  return pairs;
}

function parsePair(rawPair: string, lenient: boolean): [key: string, value: string] | undefined {
  const trimmed = rawPair.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const eqIndex = trimmed.indexOf('=');
  if (eqIndex === -1) {
    if (!lenient) {
      fail(`malformed key=value pair "${trimmed}"`, 'MALFORMED_PAIR');
    }
    return undefined;
  }

  const key = trimmed.slice(0, eqIndex).trim().toLowerCase();
  if (key.length === 0) {
    if (!lenient) {
      fail(`empty key in pair "${trimmed}"`, 'MALFORMED_PAIR');
    }
    return undefined;
  }

  let value = trimmed.slice(eqIndex + 1).trim();
  if (value.startsWith('{')) {
    if (value.length < 2 || !value.endsWith('}')) {
      if (!lenient) {
        fail(`unterminated brace-quoted value for "${key}"`, 'INVALID_ODBC_VALUE');
      }
    } else {
      value = value.slice(1, -1).replace(/}}/g, '}');
    }
  }

  return [key, value];
}

function parsePort(raw: string, lenient: boolean): number | undefined {
  if (!/^\d+$/.test(raw)) {
    if (!lenient) {
      fail(`port "${raw}" is not numeric`, 'INVALID_PORT');
    }
    return undefined;
  }
  const port = Number(raw);
  if (port < 1 || port > 65535) {
    if (!lenient) {
      fail(`port ${port} is out of range 1-65535`, 'INVALID_PORT');
    }
    return undefined;
  }
  return port;
}

/**
 * Parse an ODBC/SQL Server style connection string, e.g.
 * "Driver={PostgreSQL};Server=db1;Port=5433;Database=orders;Uid=app;Pwd=s3cr3t;".
 *
 * Keys are matched case-insensitively against the common aliases each
 * concept goes by across drivers (Server/Host/Data Source, Uid/User/User Id,
 * Pwd/Password, Database/Initial Catalog). Anything else is kept as-is in
 * `params`, lowercased, so driver-specific options round-trip through
 * formatOdbcConnectionString.
 *
 * By default this is strict: a pair with no "=", an unterminated
 * brace-quoted value, a duplicate key, an out-of-range port, and a missing
 * host all throw a ConnectionStringError. Pass { lenient: true } to relax
 * those checks.
 */
export function parseOdbcConnectionString(
  input: string,
  options: ParseOptions = {},
): ParsedConnectionString {
  const lenient = options.lenient ?? false;

  if (input.trim().length === 0) {
    fail('connection string must not be empty', 'EMPTY_INPUT');
  }

  let host: string | undefined;
  let port: number | undefined;
  let database: string | undefined;
  let username: string | undefined;
  let password: string | undefined;
  const params: Record<string, string> = {};
  const seenKeys = new Set<string>();

  for (const rawPair of splitPairs(input)) {
    const parsed = parsePair(rawPair, lenient);
    if (parsed === undefined) {
      continue;
    }
    const [key, value] = parsed;

    if (seenKeys.has(key)) {
      if (!lenient) {
        fail(`duplicate key "${key}"`, 'DUPLICATE_PARAM');
      }
    }
    seenKeys.add(key);

    if (HOST_KEYS.has(key)) {
      host = value;
    } else if (PORT_KEYS.has(key)) {
      port = parsePort(value, lenient);
    } else if (DATABASE_KEYS.has(key)) {
      database = value;
    } else if (USERNAME_KEYS.has(key)) {
      username = value;
    } else if (PASSWORD_KEYS.has(key)) {
      password = value;
    } else {
      params[key] = value;
    }
  }

  if (host === undefined && !lenient) {
    fail('at least one of Server/Host/Data Source is required', 'MISSING_HOST');
  }

  const hosts: HostPort[] = host !== undefined ? [{ host, port }] : [];

  return { scheme: 'odbc', username, password, hosts, database, params };
}

function quoteValue(value: string): string {
  if (value.length === 0 || /[;{}=]/.test(value) || value.trim() !== value) {
    return `{${value.replace(/}/g, '}}')}}`;
  }
  return value;
}

/**
 * Serialize a ParsedConnectionString into ODBC/SQL Server "key=value;" form.
 * Throws if cs.hosts has more than one entry - ODBC connection strings
 * address a single server, unlike the comma-separated host lists the
 * URI-style format allows for replica sets.
 */
export function formatOdbcConnectionString(cs: ParsedConnectionString): string {
  if (cs.hosts.length > 1) {
    fail('ODBC connection strings support only a single host', 'MULTIPLE_HOSTS');
  }

  const pairs: string[] = [];
  const [primary] = cs.hosts;
  if (primary !== undefined) {
    pairs.push(`Server=${quoteValue(primary.host)}`);
    if (primary.port !== undefined) {
      pairs.push(`Port=${primary.port}`);
    }
  }
  if (cs.database !== undefined) {
    pairs.push(`Database=${quoteValue(cs.database)}`);
  }
  if (cs.username !== undefined) {
    pairs.push(`Uid=${quoteValue(cs.username)}`);
  }
  if (cs.password !== undefined) {
    pairs.push(`Pwd=${quoteValue(cs.password)}`);
  }
  for (const [key, value] of Object.entries(cs.params)) {
    pairs.push(`${key}=${quoteValue(value)}`);
  }

  return pairs.map((pair) => `${pair};`).join('');
}
