# SciForge Research Memory Worker

`@sciforge/research-memory` is an MCP worker. It is not a renderer feature and does not add extension UI.

The worker keeps project memory grounded in local workspace facts:

- `.agent/artifacts.yml` is the artifact index.
- `.agent/research-memory/**` stores generated experiment cards and decision records.
- `status.html` is generated from local memory and is not the source of truth.
- GitHub is a review and collaboration layer, not the canonical fact store.

Agents should use this worker through MCP tools to draft, policy-check, and preview research-memory updates before asking for human confirmation. GitHub writes require explicit confirmation, and medium/high-risk or public/validated claims require an additional risk acknowledgement before the worker writes.

## Scripts

- `npm --workspace @sciforge/research-memory run test`
- `npm --workspace @sciforge/research-memory run typecheck`
- `npm --workspace @sciforge/research-memory run start`
