# connstr-toolkit

A small TypeScript library (and thin CLI) for parsing, validating, and
building URI-style database connection strings: `postgres://`, `mysql://`,
`mongodb://`, `redis://`, and anything else shaped like
`scheme://user:pass@host:port/database?param=value`.

## The problem

Connection strings look simple until they aren't. A password with an `@` in
it that wasn't percent-encoded silently breaks host parsing. A typo turns
`?sslmode=require&sslmode=disable` into a config that quietly disables TLS
because whichever driver you're using picks the last duplicate key. A port
number outside 1-65535 gets passed straight to a socket call and fails with
an unhelpful error three layers down. Most drivers parse connection strings
as loosely as possible, because they'd rather guess than crash - which is
exactly wrong when the string came from a config file, an environment
variable, or a `.env` a teammate hand-edited.

This library does the opposite: by default it is **strict**, and it rejects
anything ambiguous instead of guessing. When you genuinely need to accept
messy input - legacy config, a string built by someone else's tool - you
opt into leniency explicitly with `--lenient` (CLI) or `{ lenient: true }`
(library), rather than that being the default you forgot you were relying
on.

## Library usage

```ts
import { parseConnectionString, formatConnectionString } from 'connstr-toolkit';

const cs = parseConnectionString(
  'postgres://app:s3cr3t@db1,db2:5433/orders?sslmode=require',
);

// cs.scheme    -> "postgres"
// cs.username  -> "app"
// cs.password  -> "s3cr3t"
// cs.hosts     -> [{ host: "db1" }, { host: "db2", port: 5433 }]
// cs.database  -> "orders"
// cs.params    -> { sslmode: "require" }

formatConnectionString(cs);
// -> "postgres://app:s3cr3t@db1,db2:5433/orders?sslmode=require"
```

Strict mode throws a `ConnectionStringError` (with a stable `.code`) on
anything that would otherwise fail silently or ambiguously:

```ts
parseConnectionString('mysql://db:99999/app');
// ConnectionStringError: port 99999 in host "db:99999" is out of range 1-65535
// code: "INVALID_PORT"

parseConnectionString('mysql://host/app?timeout=5&timeout=10');
// ConnectionStringError: duplicate query parameter "timeout"
// code: "DUPLICATE_PARAM"
```

Pass `{ lenient: true }` to get a best-effort parse instead: invalid ports
are dropped rather than rejected, duplicate query keys resolve to the last
value seen, and unencoded reserved characters are passed through as-is.

```ts
parseConnectionString('mysql://db:99999/app', { lenient: true }).hosts;
// -> [{ host: "db" }]   (port silently dropped instead of thrown)
```

## CLI usage

```
$ connstr "postgres://app:s3cr3t@db1,db2:5433/orders?sslmode=require"
{
  "scheme": "postgres",
  "username": "app",
  "password": "s3cr3t",
  "hosts": [
    { "host": "db1" },
    { "host": "db2", "port": 5433 }
  ],
  "database": "orders",
  "params": { "sslmode": "require" }
}

$ connstr "mysql://db:99999/app"
INVALID_PORT: port 99999 in host "db:99999" is out of range 1-65535
retry with --lenient to relax validation

$ connstr "mysql://db:99999/app" --lenient --compact
{"scheme":"mysql","hosts":[{"host":"db"}],"database":"app","params":{}}
```

## What "strict" checks

- scheme is present and looks like `[a-zA-Z][a-zA-Z0-9+.-]*`
- at least one host is present
- host ports parse as integers in the 1-65535 range
- username, password, database, and query values decode cleanly as
  percent-encoded UTF-8, with no raw whitespace or control characters
- query parameter keys are not repeated
- no `#fragment` suffix, which has no meaning in a connection string

Everything above is relaxed, not skipped, under `--lenient` /
`{ lenient: true }`: invalid pieces are dropped where there's a sane default
(bad ports, malformed encoding falls back to the raw text) rather than the
whole parse failing.

## Status

This is a first pass covering the common URI-style shape. It does not yet
handle ODBC-style `Key=Value;Key2=Value2` strings (used by SQL Server and
some ODBC drivers) - see the roadmap.

## Install

Not published yet. Clone the repo and build locally:

```
npm install --only=dev   # installs the TypeScript compiler only
npm run build
node dist/cli.js "postgres://localhost/app"
```

Zero runtime dependencies: the library and CLI use only the Node.js
standard library.

## License

MIT, see LICENSE.
