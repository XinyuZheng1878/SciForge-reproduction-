# @sciforge/paper-radar

Paper Radar MCP facade for agent-facing research profile, sync, search, rank, digest, and read-only resource access.

## Storage

The worker uses the same SQLite schema as `plugins/paper-radar-service`.

Path resolution is:

1. `PAPER_RADAR_DB` and `PAPER_RADAR_PROFILES`, or `--db` and `--profiles`.
2. `PAPER_RADAR_USER_DATA` or `--user-data-dir`, resolved as:
   - `<userData>/paper-radar/paper-radar.sqlite`
   - `<userData>/paper-radar/profiles.json`
3. Standalone fallback:
   - `~/.sciforge/paper-radar.sqlite`
   - `~/.sciforge/paper-radar-profiles.json`

When launched from the Electron main process, pass the existing sidecar paths from `paperRadarDbPath(userDataDir)` and `paperRadarProfilesPath(userDataDir)` so GUI and MCP share one database.

## Packaging

This package is intentionally not wired into root workspace scripts in this change. The follow-up main-thread packaging step should add the worker package to root workspaces, node-entry/runtime injection, and packaged app include checks together. Runtime packaging must include both `packages/workers/paper-radar` and the existing `plugins/paper-radar-service` dependency because the worker reuses that service's storage, source parsing, profile, and ranking modules.

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
