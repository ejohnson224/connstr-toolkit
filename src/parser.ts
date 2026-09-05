export interface HostPort {
  host: string;
  port?: number;
}

export interface ParsedConnectionString {
  scheme: string;
  username?: string;
  password?: string;
  hosts: HostPort[];
  database?: string;
  params: Record<string, string>;
}

export interface ParseOptions {
  /**
   * Relax validation instead of throwing: unencoded reserved characters,
   * out-of-range ports, duplicate query parameters, and missing hosts are
   * tolerated and either dropped or passed through as-is.
   */
  lenient?: boolean;
}

export class ConnectionStringError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'ConnectionStringError';
    this.code = code;
  }
}

function fail(message: string, code: string): never {
  throw new ConnectionStringError(message, code);
}

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*$/;
const UNSAFE_CHAR_RE = /[\x00-\x1f\s]/;

function decodeComponent(raw: string, lenient: boolean, field: string): string {
  if (!lenient && UNSAFE_CHAR_RE.test(raw)) {
    fail(`${field} contains whitespace or control characters: "${raw}"`, 'UNSAFE_CHARACTER');
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    if (!lenient) {
      fail(`could not percent-decode ${field} "${raw}"`, 'INVALID_ENCODING');
    }
    return raw;
  }
}

function parsePort(text: string, lenient: boolean, context: string): number | undefined {
  if (!/^\d+$/.test(text)) {
    if (!lenient) {
      fail(`port "${text}" in host "${context}" is not numeric`, 'INVALID_PORT');
    }
    return undefined;
  }
  const port = Number(text);
  if (port < 1 || port > 65535) {
    if (!lenient) {
      fail(`port ${port} in host "${context}" is out of range 1-65535`, 'INVALID_PORT');
    }
    return undefined;
  }
  return port;
}

function parseHostPort(raw: string, lenient: boolean): HostPort {
  if (raw.startsWith('[')) {
    const closeIndex = raw.indexOf(']');
    if (closeIndex === -1) {
      if (!lenient) {
        fail(`unterminated IPv6 literal in host "${raw}"`, 'INVALID_HOST');
      }
      return { host: raw.slice(1) };
    }
    const host = raw.slice(1, closeIndex);
    const remainder = raw.slice(closeIndex + 1);
    if (remainder.length === 0) {
      return { host };
    }
    if (!remainder.startsWith(':')) {
      if (!lenient) {
        fail(`unexpected text after IPv6 literal in host "${raw}"`, 'INVALID_HOST');
      }
      return { host };
    }
    return { host, port: parsePort(remainder.slice(1), lenient, raw) };
  }

  const colonIndex = raw.indexOf(':');
  if (colonIndex === -1) {
    return { host: raw };
  }
  const host = raw.slice(0, colonIndex);
  return { host, port: parsePort(raw.slice(colonIndex + 1), lenient, raw) };
}

/**
 * Parse a URI-style connection string, e.g.
 * "postgres://user:pass@host1,host2:5433/mydb?sslmode=require".
 *
 * By default this is strict: unencoded reserved characters, malformed
 * percent-encoding, out-of-range ports, duplicate query parameters, and a
 * missing host all throw a ConnectionStringError. Pass { lenient: true } to
 * relax those checks for messy input you don't control.
 */
export function parseConnectionString(
  input: string,
  options: ParseOptions = {},
): ParsedConnectionString {
  const lenient = options.lenient ?? false;

  if (input.length === 0) {
    fail('connection string must not be empty', 'EMPTY_INPUT');
  }

  const schemeEnd = input.indexOf('://');
  if (schemeEnd === -1) {
    fail(`missing "://" after scheme in "${input}"`, 'MISSING_SCHEME');
  }

  const scheme = input.slice(0, schemeEnd);
  if (!SCHEME_RE.test(scheme) && !lenient) {
    fail(`"${scheme}" is not a valid scheme name`, 'INVALID_SCHEME');
  }

  let rest = input.slice(schemeEnd + 3);

  const hashIndex = rest.indexOf('#');
  if (hashIndex !== -1) {
    if (!lenient) {
      fail('fragments ("#...") are not supported in connection strings', 'UNEXPECTED_FRAGMENT');
    }
    rest = rest.slice(0, hashIndex);
  }

  let query = '';
  const queryIndex = rest.indexOf('?');
  if (queryIndex !== -1) {
    query = rest.slice(queryIndex + 1);
    rest = rest.slice(0, queryIndex);
  }

  let authority = rest;
  let database: string | undefined;
  const slashIndex = rest.indexOf('/');
  if (slashIndex !== -1) {
    authority = rest.slice(0, slashIndex);
    const rawDatabase = rest.slice(slashIndex + 1);
    if (rawDatabase.length > 0) {
      database = decodeComponent(rawDatabase, lenient, 'database name');
    }
  }

  let username: string | undefined;
  let password: string | undefined;
  let hostSection = authority;
  const atIndex = authority.lastIndexOf('@');
  if (atIndex !== -1) {
    const userinfo = authority.slice(0, atIndex);
    hostSection = authority.slice(atIndex + 1);
    const colonIndex = userinfo.indexOf(':');
    if (colonIndex === -1) {
      username = decodeComponent(userinfo, lenient, 'username');
    } else {
      username = decodeComponent(userinfo.slice(0, colonIndex), lenient, 'username');
      password = decodeComponent(userinfo.slice(colonIndex + 1), lenient, 'password');
    }
  }

  if (hostSection.length === 0 && !lenient) {
    fail('at least one host is required', 'MISSING_HOST');
  }

  const hosts: HostPort[] = [];
  if (hostSection.length > 0) {
    for (const rawHost of hostSection.split(',')) {
      if (rawHost.length === 0) {
        if (!lenient) {
          fail('empty host entry between commas', 'EMPTY_HOST');
        }
        continue;
      }
      hosts.push(parseHostPort(rawHost, lenient));
    }
  }

  const params: Record<string, string> = {};
  if (query.length > 0) {
    for (const pair of query.split('&')) {
      if (pair.length === 0) {
        continue;
      }
      const eqIndex = pair.indexOf('=');
      const rawKey = eqIndex === -1 ? pair : pair.slice(0, eqIndex);
      const rawValue = eqIndex === -1 ? '' : pair.slice(eqIndex + 1);
      const key = decodeComponent(rawKey, lenient, 'query parameter name');
      const value = decodeComponent(rawValue, lenient, 'query parameter value');
      if (!lenient && Object.prototype.hasOwnProperty.call(params, key)) {
        fail(`duplicate query parameter "${key}"`, 'DUPLICATE_PARAM');
      }
      params[key] = value;
    }
  }

  return { scheme, username, password, hosts, database, params };
}

function formatHostPort(hostPort: HostPort): string {
  const host = hostPort.host.includes(':') ? `[${hostPort.host}]` : hostPort.host;
  return hostPort.port !== undefined ? `${host}:${hostPort.port}` : host;
}

/** Serialize a ParsedConnectionString back into its URI-style form. */
export function formatConnectionString(cs: ParsedConnectionString): string {
  let out = `${cs.scheme}://`;

  if (cs.username !== undefined) {
    out += encodeURIComponent(cs.username);
    if (cs.password !== undefined) {
      out += `:${encodeURIComponent(cs.password)}`;
    }
    out += '@';
  }

  out += cs.hosts.map(formatHostPort).join(',');

  if (cs.database !== undefined) {
    out += `/${encodeURIComponent(cs.database)}`;
  }

  const paramKeys = Object.keys(cs.params);
  if (paramKeys.length > 0) {
    out +=
      '?' +
      paramKeys
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(cs.params[key])}`)
        .join('&');
  }

  return out;
}
