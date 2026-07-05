# @sciforge/write-assist

Read-only write assistance worker for SciForge.

This package owns the agent-facing MCP facade for bounded writing context
retrieval and PDF text extraction. It intentionally does not expose workspace
write, rename, delete, or clipboard image operations.
