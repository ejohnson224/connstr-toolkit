#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseConnectionString, ConnectionStringError } from './parser.js';
import { parseOdbcConnectionString } from './odbc.js';
import { buildConnectionString } from './build.js';

function printUsage(): void {
  process.stderr.write(
    [
      'usage: connstr <connection-string> [--odbc] [--lenient] [--compact]',
      '       connstr format [--odbc] [<json>]',
      '',
      '  --odbc     parse/build ODBC-style "key=value;key2=value2" input instead of a URI',
      '  --lenient  relax validation instead of throwing on messy input',
      '  --compact  print single-line JSON instead of pretty-printed JSON',
      '',
      '  format     build a connection string from a JSON object, given as an',
      '             argument or piped in on stdin',
      '',
      'examples:',
      '  connstr "postgres://app:secret@db1,db2:5433/orders?sslmode=require"',
      '  connstr --odbc "Server=db1;Port=5433;Database=orders;Uid=app;Pwd=secret;"',
      '  connstr format \'{"scheme":"postgres","hosts":[{"host":"db1"}],"database":"orders"}\'',
    ].join('\n') + '\n',
  );
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function runFormat(args: string[]): number {
  let odbc = false;
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === '--odbc') {
      odbc = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      return 0;
    } else if (arg.startsWith('-')) {
      process.stderr.write(`unknown flag: ${arg}\n`);
      return 2;
    } else {
      positional.push(arg);
    }
  }

  const raw = positional[0] ?? readStdin();
  if (raw.trim().length === 0) {
    process.stderr.write('format requires a JSON object as an argument or on stdin\n');
    return 2;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`INVALID_JSON: could not parse input as JSON (${(err as Error).message})\n`);
    return 1;
  }

  try {
    process.stdout.write(buildConnectionString(json, { odbc }) + '\n');
    return 0;
  } catch (err) {
    if (err instanceof ConnectionStringError) {
      process.stderr.write(`${err.code}: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

function main(argv: string[]): number {
  const args = argv.slice(2);

  if (args[0] === 'format') {
    return runFormat(args.slice(1));
  }

  let lenient = false;
  let compact = false;
  let odbc = false;
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === '--lenient') {
      lenient = true;
    } else if (arg === '--compact') {
      compact = true;
    } else if (arg === '--odbc') {
      odbc = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      return 0;
    } else if (arg.startsWith('-')) {
      process.stderr.write(`unknown flag: ${arg}\n`);
      return 2;
    } else {
      positional.push(arg);
    }
  }

  if (positional.length === 0) {
    printUsage();
    return 2;
  }

  const input = positional[0]!;

  try {
    const parsed = odbc
      ? parseOdbcConnectionString(input, { lenient })
      : parseConnectionString(input, { lenient });
    process.stdout.write(JSON.stringify(parsed, null, compact ? 0 : 2) + '\n');
    return 0;
  } catch (err) {
    if (err instanceof ConnectionStringError) {
      process.stderr.write(`${err.code}: ${err.message}\n`);
      if (!lenient) {
        process.stderr.write('retry with --lenient to relax validation\n');
      }
      return 1;
    }
    throw err;
  }
}

process.exit(main(process.argv));
