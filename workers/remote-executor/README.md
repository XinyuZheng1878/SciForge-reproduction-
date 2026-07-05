# @sciforge/remote-executor

MVP MCP worker core for remote command and scheduler orchestration.

This package defines the public TypeScript contract, MCP tools, in-memory/mock
service, and a single-file Python `remote_worker.py` protocol skeleton. The
default service does not perform real SSH or shell execution; it is intentionally
safe to inject fake targets for tests and later replace with a real transport.

## Local Use

```bash
npm --prefix packages/workers/remote-executor run test
npm --prefix packages/workers/remote-executor run typecheck
npm --prefix packages/workers/remote-executor run start
python3 packages/workers/remote-executor/remote_worker.py --version-json
```

Useful environment variables:

- `SCIFORGE_REMOTE_EXECUTOR_TARGETS_JSON`: JSON array of target definitions.
