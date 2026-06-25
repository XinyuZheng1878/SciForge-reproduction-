# SciForge Runtime Inspector

Read-only MCP worker for Git previews, runtime diagnostics, and TypeScript/JavaScript LSP navigation.

This package intentionally does not start or control long-lived runtimes. It can inspect:

- Git status, branches, bounded diff previews, and read-only checkpoint metadata/previews.
- Runtime ports, health, dependency report, Model Router status, and local runtime status.
- TypeScript/JavaScript LSP status and saved-file navigation queries backed by per-workspace language server sessions.

## Local Use

```sh
npm --prefix packages/workers/runtime-inspector run test
npm --prefix packages/workers/runtime-inspector run typecheck
npm --prefix packages/workers/runtime-inspector run start -- --workspace-root /path/to/workspace
```

Useful environment variables:

- `SCIFORGE_RUNTIME_INSPECTOR_WORKSPACE_ROOT`
- `SCIFORGE_RUNTIME_INSPECTOR_CHECKPOINT_DATA_DIR`
- `SCIFORGE_RUNTIME_INSPECTOR_MODEL_ROUTER_BASE_URL`
- `SCIFORGE_RUNTIME_INSPECTOR_RUNTIME_BASE_URL`
- `SCIFORGE_RUNTIME_INSPECTOR_RUNTIME_TOKEN`
- `SCIFORGE_RUNTIME_INSPECTOR_TIMEOUT_MS`
