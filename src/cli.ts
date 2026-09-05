#!/usr/bin/env node
import { parseConnectionString, ConnectionStringError } from './parser.js';

function printUsage(): void {
  process.stderr.write(
    [
      'usage: connstr <connection-string> [--lenient] [--compact]',
      '',
      '  --lenient  relax validation instead of throwing on messy input',
      '  --compact  print single-line JSON instead of pretty-printed JSON',
      '',
      'example:',
      '  connstr "postgres://app:secret@db1,db2:5433/orders?sslmode=require"',
    ].join('\n') + '\n',
  );
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  let lenient = false;
  let compact = false;
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === '--lenient') {
      lenient = true;
    } else if (arg === '--compact') {
      compact = true;
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
    const parsed = parseConnectionString(input, { lenient });
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
