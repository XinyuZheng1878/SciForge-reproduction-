import {
  auditModelRouterTraceBundle,
  type AuditModelRouterTraceBundleOptions,
} from '../src/trace-audit';

type ParsedArgs = {
  options: AuditModelRouterTraceBundleOptions;
  json: boolean;
};

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const report = await auditModelRouterTraceBundle(parsed.options);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (parsed.json) process.stdout.write(text);
  return report.status === 'pass' ? 0 : 1;
}

function parseArgs(argv: string[]): ParsedArgs {
  const knownSecretEnvNames: string[] = [];
  const knownSecrets: string[] = [];
  const options: AuditModelRouterTraceBundleOptions = {
    traceRoot: '',
  };
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    switch (arg) {
      case '--trace-root':
        options.traceRoot = requiredValue(argv, i, arg);
        i += 1;
        break;
      case '--out':
        options.outPath = requiredValue(argv, i, arg);
        i += 1;
        break;
      case '--known-secret-env': {
        const name = requiredValue(argv, i, arg);
        const value = process.env[name];
        if (typeof value === 'string' && value.length > 0) {
          knownSecrets.push(value);
        } else {
          knownSecretEnvNames.push(name);
        }
        i += 1;
        break;
      }
      case '--max-file-bytes': {
        const value = requiredValue(argv, i, arg);
        if (!/^[1-9][0-9]*$/.test(value)) {
          throw new CliUsageError('--max-file-bytes must be a positive integer');
        }
        options.maxFileBytes = Number(value);
        i += 1;
        break;
      }
      case '--require-non-empty':
        options.requireNonEmpty = true;
        break;
      case '--json':
        json = true;
        break;
      default:
        throw new CliUsageError('Unknown model-router trace audit argument');
    }
  }

  if (!options.traceRoot) {
    throw new CliUsageError('--trace-root is required');
  }

  options.knownSecrets = knownSecrets;
  options.missingKnownSecretEnvNames = knownSecretEnvNames;
  return { options, json };
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliUsageError(`${flag} requires a value`);
  }
  return value;
}

class CliUsageError extends Error {}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${safeCliErrorMessage(error)}\n`);
    process.exitCode = 2;
  });

function safeCliErrorMessage(error: unknown): string {
  if (error instanceof CliUsageError) return error.message;
  return 'Model Router trace audit failed';
}
