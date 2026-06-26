# SciForge Image Generation Worker

First-party MCP worker for controlled image generation and canvas-based image editing.

The first version mirrors the scientific plotting worker pattern:

- plan without file writes
- render controlled image artifacts
- review image outputs
- convert SciForge Canvas review packets into edit intents
- write artifact manifests under `.sciforge/artifacts` for Canvas import

If an OpenAI-compatible image endpoint is configured, render/edit uses it. Otherwise the worker produces a deterministic local placeholder PNG so the MCP, manifest, and Canvas flow remain testable.
