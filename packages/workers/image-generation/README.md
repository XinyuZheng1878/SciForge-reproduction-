# SciForge Image Generation Worker

First-party MCP worker for controlled image generation and canvas-based image editing.

The first version mirrors the scientific plotting worker pattern:

- plan without file writes
- render controlled image artifacts
- review image outputs
- convert SciForge Canvas review packets into edit intents
- write artifact manifests under `.sciforge/artifacts` for Canvas import

If a Model Router image endpoint is configured, render/edit requests use the router's OpenAI-compatible `/v1/images/generations` contract. Otherwise the worker produces a deterministic local placeholder PNG so the MCP, manifest, and Canvas flow remain testable.

## Routing boundary

The worker does not receive direct provider credentials. Managed launches pass only `SCIFORGE_MODEL_ROUTER_BASE_URL`, `SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY`, and the public router model alias; the Model Router owns the private image provider config, health, auth, and retry/error lifecycle.

New image or multimodal capabilities must not bypass the router layer. The image worker should stay focused on MCP tools, artifact manifests, and Canvas handoff unless product ownership is explicitly changed.

`insertToCanvas` is a handoff marker, not a direct Canvas mutation. When a render
request includes `canvasId` / `threadId`, the worker records those fields in the
image manifest and artifact manifest so the GUI or Canvas MCP can import the
artifact through the normal Canvas insertion path.
