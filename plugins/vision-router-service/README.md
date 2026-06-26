# SciForge Vision Router Service

A **Model-Router-managed** SciForge translator worker. It translates a visual
input (image, or a video keyframe) into **natural-language evidence** using a
user/operator configured vision provider, so a text-only main agent can consume
visual context as text.

- **Translate-only.** The vision model describes what is visible. It never reasons,
  answers the user, gives advice, or claims task completion. Reasoning stays with the
  main agent.
- **Managed worker.** Do not expose this directly to app runtimes. Model Router
  is the caller and owns provider selection, user configuration, and fallback.
- **Template-conformant.** Returns the `ServiceResult` envelope from
  [`../Servic_Module_Template.md`](../Servic_Module_Template.md). Per the template's
  placement rules this is an **HTTP service** (a stable transform invoked by the host),
  not an Agent-chosen MCP tool — SciForge's gateway calls it during input pre-extraction.

## Run

```bash
npm install
cp .env.example .env   # fill VISION_PROVIDER_API_KEY and VISION_ROUTER_RUNTIME_TOKEN
npm start              # http://127.0.0.1:3899
```

`VISION_PROVIDER_BASE_URL`, `VISION_PROVIDER_MODEL`, and `VISION_PROVIDER_API_KEY`
must all be supplied. This package does not choose or bundle a default vision
model.

## API

```
GET  /health   -> { ok, service, checkedAt }
GET  /version  -> { service, version, model }
POST /vision/translate
```

All routes require `Authorization: Bearer $VISION_ROUTER_RUNTIME_TOKEN`.

`POST /vision/translate` request:

```jsonc
{
  "instruction": "optional — what the user cares about (context, NOT a task to solve)",
  "image": { "base64": "<raw base64>", "mime": "image/png" },  // or { "url": "data:... | https://..." }
  "objectId": "optional upload/object id, echoed into provenance",
  "requestId": "optional"
}
```

Response — `ServiceResult<VisionTranslation>`:

```jsonc
{
  "ok": true,
  "summary": "A bar chart titled Q3 Revenue with three bars…",   // bounded, for the agent
  "data": { "summary": "…full description…", "model": "configured-vision-model" },
  "provenance": { "serviceId": "sciforge.vision-router", "operation": "vision_translate", "requestId": "…" }
}
```

Failures return `{ ok: false, error: { code, message, retryable }, provenance }` with codes
`INVALID_ARGUMENT` / `UNAUTHENTICATED` / `RATE_LIMITED` / `TIMEOUT` / `UNAVAILABLE` / `INTERNAL_ERROR`.

## Robustness (lives here, not in the caller)

The main agent has **no vision**, so a raw-image fallback is useless — this service is the
authority on "keep trying until the configured vision translator answers". Each call retries transient failures
(timeout / 5xx / 429 / network) with exponential backoff; only auth failures (401/403) and a
caller disconnect stop it early. The HTTP caller (SciForge) therefore stays a thin one-shot
POST. Tunables (env):

| Var | Default | Meaning |
|---|---|---|
| `VISION_PROVIDER_TIMEOUT_MS` | `180000` | Per-attempt timeout (vision providers can be slow). |
| `VISION_PROVIDER_MAX_ATTEMPTS` | `6` | Total attempts before giving up. |
| `VISION_PROVIDER_RETRY_BASE_MS` | `1500` | Exponential backoff base (capped at 15s). |

## How SciForge uses it

Model Router is the only intended in-repo caller. App runtimes send structured
visual refs to Model Router; they do not call this service or provider APIs
directly.

## Test

```bash
npm test         # stubbed provider, no network
npm run typecheck
```
