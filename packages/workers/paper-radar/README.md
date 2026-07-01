# @sciforge/paper-radar

Paper Radar MCP facade for agent-facing research profile, sync, search, rank, digest, and read-only resource access.

## Storage

The worker owns the shared Paper Radar SQLite schema and metadata core used by both GUI and MCP paths.

Path resolution is:

1. `PAPER_RADAR_DB` and `PAPER_RADAR_PROFILES`, or `--db` and `--profiles`.
2. `PAPER_RADAR_USER_DATA` or `--user-data-dir`, resolved as:
   - `<userData>/paper-radar/paper-radar.sqlite`
   - `<userData>/paper-radar/profiles.json`
3. Standalone fallback:
   - `~/.sciforge/paper-radar.sqlite`
   - `~/.sciforge/paper-radar-profiles.json`

When launched from the Electron main process, pass `paperRadarDbPath(userDataDir)` and `paperRadarProfilesPath(userDataDir)` so the GUI worker service and MCP entrypoint share one database.

## Packaging

This package is wired into the root workspace as `@sciforge/paper-radar` with root scripts for `paper-radar-mcp:start`, `paper-radar-mcp:test`, and `paper-radar-mcp:typecheck`.

The Electron MCP entrypoint is `src/main/paper-radar-mcp-node-entry.ts`, built to `out/main/paper-radar-mcp-node-entry.js`. Main-process MCP launch config passes `--db` and `--profiles` so the worker uses the same userData storage as the Paper Radar GUI worker service. Runtime packaging includes `packages/workers/paper-radar`; packaged app validation checks the worker core, MCP files, and node entry before release artifacts are created.

## Tools

- `gui_paper_profile_list`
- `gui_paper_profile_save`
- `gui_paper_profile_sync`
- `gui_paper_search`
- `gui_paper_rank`
- `gui_paper_digest`

Tool side effects are classified in the worker contract as `read_only`, `write`, or `destructive`.
Current write tools are non-destructive writes:

- `gui_paper_profile_save` writes `profiles.json`.
- `gui_paper_profile_sync` fetches arXiv/bioRxiv metadata and writes the local SQLite store and sync state.

Write tools support `dry_run` and `preview` for no-write inspection. Real writes require `confirmation: { "confirmed": true }`; otherwise the tool returns a structured `confirmation_required` error with an `auditId`.
Write tool previews, blocked writes, successful writes, and write failures add minimal audit records in the service. Audit records include IDs, timestamps, effect/action, profile/date windows, counts, and error codes, but omit keywords, abstracts, tokens, and large payloads.

## Resources

- `paper-radar://stats`
- `paper-radar://profile/{name}`
- `paper-radar://paper/{id}`
- `paper-radar://sync-state`
