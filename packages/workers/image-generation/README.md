# SciForge Image Generation Worker

First-party MCP worker for controlled image generation and canvas-based image editing.

The first version mirrors the scientific plotting worker pattern:

- plan without file writes
- render controlled image artifacts
- review image outputs
- convert SciForge Canvas review packets into edit intents
- write artifact manifests under `.sciforge/artifacts` for Canvas import

If an OpenAI-compatible image endpoint is configured, render/edit uses it. Otherwise the worker produces a deterministic local placeholder PNG so the MCP, manifest, and Canvas flow remain testable.

## Routing boundary

`SCIFORGE_IMAGE_*` endpoint variables are a temporary legacy direct worker env exception. They are injected only into this managed image-generation MCP worker while the router ownership decision is pending.

New image or multimodal capabilities must not bypass the router layer. Keep any direct endpoint use worker-contained here, and route new runtime-facing model/media traffic through the appropriate router contract.
