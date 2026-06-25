# Codex app-server capsule

This directory contains Codex app-server protocol details that should not leak into
renderer code, local runtime adapters, or the neutral AgentRuntimeHost.

- `protocol.ts` defines JSON-RPC wire shapes and app-server request params.
- `json-rpc-client.ts` is the stable capsule entry for the stdio JSON-RPC client.
  It currently re-exports the existing root client to avoid a large move; new
  code should import through this file.
- `server-requests.ts` contains fail-closed defaults for server-originated
  JSON-RPC requests.
- `request-registry.ts` tracks approval and user-input server requests until the
  GUI resolves them.
- `event-normalizer.ts` maps raw app-server notifications into the Codex runtime
  event payload used by the main-side service.
- `reasoning-config.ts` builds app-server reasoning config for `thread/start`
  and `turn/start`.

Compatibility shims remain at `../codex-app-server-client.ts`,
`../codex-event-normalizer.ts`, and `pending-request-registry.ts` so older local
imports keep working while new code depends on the capsule boundary.
