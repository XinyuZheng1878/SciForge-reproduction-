# SciForge plug-in services

Standalone, **plug-and-play** services. Each service owns its own `package.json` and talks to the
desktop app through HTTP rather than renderer imports. Services that are part of the app lifecycle
are exposed as root npm workspaces; standalone translator modules can still be run from their own
directory. Model Router translation services stay fail-open when absent; UI extensions such as
Paper Radar are opt-in from the Plugins page and start their local service only when the enabled UI
panel calls it.

| Plug-in | Port | Endpoint | Translates | Upstream model(s) |
|---|---|---|---|---|
| [`vision-router-service`](./vision-router-service) | 3899 | `POST /vision/translate` | image / video frame → text | Qwen3.7-Plus (cloud, OpenAI-compatible) |
| [`sci-modality-router-service`](./sci-modality-router-service) | 3898 | `POST /modality/translate`, `GET /experts/status` | 6 scientific modalities → text evidence | expert-translator (GPU): ESM-2, Nucleotide-Transformer, ChemLLM, SciBERT×2, ChemBERTa |
| [`paper-radar-service`](./paper-radar-service) | 3901 | `GET /health`, `POST /sync/profile`, `POST /digest` | paper metadata → ranked daily digest | arXiv OAI-PMH + bioRxiv API |

Translation plug-ins follow the same contract: **translate-only** (return evidence/`ServiceResult`,
never a final answer), auto-detect input, own their own retry/robustness, and redact secrets from
traces. Paper Radar is a separate UI extension service, not a Model Router translator.

## How the app uses them

- **Vision**: the model router translates image inputs via its `translators.vision` provider
  (Qwen). The `vision-router-service` packages that same translate-only behavior as a standalone
  service for reuse outside the default router lifecycle.
- **Scientific**: gated inside Model Router by `SCIFORGE_SCIMODALITY_SERVICE_URL` and
  `SCIFORGE_SCIMODALITY_SERVICE_TOKEN`. GUI/Kun/Codex pass workspace-local `input_object` refs;
  only Model Router reads explicit scientific files and calls `sci-modality-router-service`
  (which calls the GPU expert-translator). When unset or unreachable, Model Router falls back to
  readable raw file text where safe — no runtime-side service calls.
- **Paper Radar**: enabled from `Plugins → Extensions`. The Workbench only shows the Paper Radar
  right panel after the extension key is installed, and the Electron main process starts
  `paper-radar-service` on demand for Paper Radar IPC calls in development builds.

## Run a plug-in

```bash
npm --workspace sciforge-sci-modality-router-service run start   # :3898
(cd plugins/vision-router-service && npm start)                  # :3899 standalone
npm --workspace sciforge-paper-radar-service run start           # :3901
npm --workspace sciforge-sci-modality-router-service test        # stubbed unit tests
npm --workspace sciforge-paper-radar-service test                # service e2e/unit tests
```

The scientific expert models themselves (the GPU "provider" behind `sci-modality-router-service`)
are deployed separately on the GPU server — see the GPU deployment docs.
