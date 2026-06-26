# License Risk Exact-Hit Scan

Use this scan to find exact Git blob matches between this repository and Kun
content introduced after the Kun license change. The scanner treats Kun
`363fdf566657cd4d60801f62b0b8f3aa8dfbf2fc`
(`5472bed3b878854d296851820834145f5fe1a353^`) as the final MIT tree and
excludes blobs that already exist in that tree.

## Command

```sh
node scripts/license-risk-scan.mjs
```

The default Kun repository is:

```text
/Applications/workspace/ailab/research/app/Kun
```

Override the inputs when needed:

```sh
KUN_REPO=/path/to/Kun node scripts/license-risk-scan.mjs

node scripts/license-risk-scan.mjs \
  --kun-repo /path/to/Kun \
  --license-change-ref 5472bed3b878854d296851820834145f5fe1a353 \
  --mit-ref 363fdf566657cd4d60801f62b0b8f3aa8dfbf2fc
```

Machine-readable output is available for archival:

```sh
node scripts/license-risk-scan.mjs --format json > license-risk-scan.json
```

Use `--strict` in gates once the cleanup is expected to be complete. Strict mode
exits with code `2` when the current `HEAD` or worktree has risky exact hits.

## Output Sections

- `current HEAD exact hits`: tracked files in the current `HEAD` tree whose blob
  IDs match post-change Kun blobs.
- `worktree exact hits`: tracked or untracked, non-ignored files currently on
  disk whose raw Git blob IDs match post-change Kun blobs.
- `all refs exact hits`: blobs reachable from any local ref in this repository
  whose IDs match post-change Kun blobs. When the hit count is small enough, the
  scanner also reports the first seen commit and refs containing that commit.

## Partial Clone Behavior

The scanner sets `GIT_NO_LAZY_FETCH=1` for every Git read and uses
`--missing=allow-any` for reachable-object scans. Missing promised objects are
counted and skipped instead of being fetched from the network.

## Current Baseline

Last local run: `2026-06-26T17:29:08.869Z`

- Kun MIT tree unique blobs: `762`
- Kun post-change refs scanned: `21`
- Kun post-change risk blobs after MIT-tree exclusion: `2627`
- Missing Kun objects skipped: `0`
- Missing target objects skipped: `0`
- Current `HEAD` exact hits: `11` files / `11` unique blobs
- Worktree exact hits: `2` files / `2` unique blobs
- All refs exact hits: `24` unique blobs / `24` path hits

The worktree count can be lower than `HEAD` while parallel cleanup work is in
progress, because edited files may no longer match the risky blob even though
the committed `HEAD` tree still does.
