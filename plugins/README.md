# SciForge plug-in services

Optional service modules. Each service owns its own `package.json` and talks to the desktop app
through HTTP rather than renderer imports. Model Router translator workers are managed through the
router and stay fail-open when absent; UI extensions such as Paper Radar are opt-in from the Plugins
page and start their local service only when the enabled UI panel calls it.

| Plug-in | Port | Endpoint | Translates | Upstream model(s) |
|---|---|---|---|---|
| [`vision-router-service`](./vision-router-service) | 3899 | `POST /vision/translate` | image / video frame → text | configured OpenAI-compatible vision provider |
| [`paper-radar-service`](./paper-radar-service) | 3901 | `GET /health`, `POST /sync/profile`, `POST /digest` | paper metadata → ranked daily digest | arXiv OAI-PMH + bioRxiv API |

> The scientific-modality translator now lives as a **worker** at
> [`packages/workers/sci-modality-router`](../packages/workers/sci-modality-router) (port 3898,
> `POST /modality/translate`, four native-to-text experts), not as a plug-in. It is still gated
> inside Model Router by `SCIFORGE_SCIMODALITY_SERVICE_URL`.

Translation plug-ins follow the same contract: **translate-only** (return evidence/`ServiceResult`,
never a final answer), auto-detect input, own their own retry/robustness, and redact secrets from
traces. Paper Radar is a separate UI extension service, not a Model Router translator.

## How the app uses them

- **Vision**: Model Router translates image inputs via its configured `translators.vision` provider.
  The `vision-router-service` packages that same translate-only behavior as a managed worker for
  deployments that want a separate service boundary.
- **Scientific**: now a worker — see
  [`packages/workers/sci-modality-router`](../packages/workers/sci-modality-router). Gated inside
  Model Router by `SCIFORGE_SCIMODALITY_SERVICE_URL` and `SCIFORGE_SCIMODALITY_SERVICE_TOKEN`.
  GUI/Kun/Codex pass workspace-local `input_object` refs; only Model Router reads explicit
  scientific files and calls the worker
  (which calls the GPU expert-translator). When unset or unreachable, Model Router falls back to
  readable raw file text where safe — no runtime-side service calls.
- **Paper Radar**: enabled from `Plugins → Extensions`. The Workbench only shows the Paper Radar
  right panel after the extension key is installed, and the Electron main process starts
  `paper-radar-service` on demand for Paper Radar IPC calls in development builds.

## Run a plug-in

```bash
(cd plugins/vision-router-service && npm start)                  # :3899 managed translator worker
npm --workspace sciforge-paper-radar-service run start           # :3901
npm --workspace sciforge-paper-radar-service test                # service e2e/unit tests

# The scientific-modality translator is now a worker (packages/workers/sci-modality-router):
npm --workspace @sciforge/sci-modality-router run start          # :3898
npm --workspace @sciforge/sci-modality-router run test           # stubbed unit tests
```

The scientific expert provider behind `@sciforge/sci-modality-router` is deployed separately after
license review; see the worker deployment docs.
