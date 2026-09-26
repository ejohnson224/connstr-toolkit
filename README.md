# connstr-toolkit

A small TypeScript library (and thin CLI) for parsing, validating, and
building database connection strings, in two shapes: URI-style
(`postgres://`, `mysql://`, `mongodb://`, `redis://`, and anything else
shaped like `scheme://user:pass@host:port/database?param=value`) and
ODBC-style (`Server=host;Port=5432;Database=db;Uid=user;Pwd=pass;`, used by
SQL Server and other ODBC drivers).

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

### ODBC-style strings

`parseOdbcConnectionString` and `formatOdbcConnectionString` handle the
`Key=Value;Key2=Value2` shape used by SQL Server and other ODBC drivers.
Keys are matched case-insensitively against the common aliases each concept
goes by (`Server`/`Host`/`Data Source`, `Uid`/`User`/`User Id`,
`Pwd`/`Password`, `Database`/`Initial Catalog`); anything else - `Driver`,
timeouts, TLS options - is kept as-is in `params`.

```ts
import { parseOdbcConnectionString } from 'connstr-toolkit';

const cs = parseOdbcConnectionString(
  'Driver={PostgreSQL};Server=db1;Port=5433;Database=orders;Uid=app;Pwd=s3cr3t;',
);

// cs.scheme    -> "odbc"
// cs.hosts     -> [{ host: "db1", port: 5433 }]
// cs.database  -> "orders"
// cs.username  -> "app"
// cs.password  -> "s3cr3t"
// cs.params    -> { driver: "PostgreSQL" }
```

A value wrapped in `{...}` may contain `;` and `=`; a literal `}` inside one
is written as `}}`, per the ODBC convention. The same strict/lenient rules
apply: a pair with no `=`, a duplicate key, an out-of-range port, and a
missing host all throw under strict mode and are tolerated under
`{ lenient: true }`.

`formatOdbcConnectionString` serializes back to the same form, and throws if
`hosts` has more than one entry - ODBC connection strings address a single
server, unlike the comma-separated host lists the URI-style format allows.

### Building a connection string from JSON

`buildConnectionString` is the inverse of parsing: it takes a plain object
shaped like `ParsedConnectionString` (only `scheme` is required - `hosts`,
`database`, and `params` default to empty) and returns the connection
string it describes. It validates the shape the same way `parseConnectionString`
validates its input, throwing a `ConnectionStringError` with code
`INVALID_BUILD_INPUT` on a bad shape rather than producing a broken string.

```ts
import { buildConnectionString } from 'connstr-toolkit';

buildConnectionString({
  scheme: 'postgres',
  hosts: [{ host: 'db1' }, { host: 'db2', port: 5433 }],
  database: 'orders',
  params: { sslmode: 'require' },
});
// -> "postgres://db1,db2:5433/orders?sslmode=require"

buildConnectionString({ scheme: 'odbc', hosts: [{ host: 'db1' }] }, { odbc: true });
// -> "Server=db1;"
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

$ connstr --odbc "Server=db1;Port=5433;Database=orders;Uid=app;Pwd=s3cr3t;" --compact
{"scheme":"odbc","username":"app","password":"s3cr3t","hosts":[{"host":"db1","port":5433}],"database":"orders","params":{}}
```

### Building a connection string from JSON

`connstr format` goes the other direction: given a JSON object shaped like the
output above, it prints the connection string it describes. The JSON can be
passed as an argument or piped in on stdin; `hosts`, `database`, and `params`
are all optional.

```
$ connstr format '{"scheme":"postgres","hosts":[{"host":"db1"}],"database":"orders"}'
postgres://db1/orders

$ echo '{"scheme":"odbc","hosts":[{"host":"db1","port":5433}],"username":"app","password":"s3cr3t"}' \
    | connstr format --odbc
Server=db1;Port=5433;Uid=app;Pwd=s3cr3t;
```

`format` validates the JSON the same way parsing validates a string: a
missing `scheme`, a host without a `host` field, an out-of-range port, or a
non-string `params` value all fail with an `INVALID_BUILD_INPUT` error
instead of silently producing a broken connection string.

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

This covers the common URI-style shape and ODBC-style `Key=Value;Key2=Value2`
strings, parsing in both directions and building a string back up from JSON.
It does not yet have scheme-specific default port lookup (e.g. knowing that
`postgres` means 5432 when no port is given).

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
