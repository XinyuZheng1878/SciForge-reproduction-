# @sciforge/computer-use

Shared Computer Use MCP extension, contracts, and coordination primitives for
SciForge runtimes.

This package owns the reusable surface:

- agent/session/target/lease contracts
- target lease conflict detection
- global-native host-control backend with a shared action lock
- model-visible tool-result image helpers
- MCP `computer_use` tool entrypoint

SciForge Runtime, Codex, Claude, and other runtimes can consume this worker
through the GUI-managed `gui_computer_use` MCP server. The GUI-Owl autonomous
task worker currently coexists while human testing decides the final
integration shape; this package remains the low-level primitive path for
isolated browser control. The native backend loads optional host-control
dependencies lazily and reports diagnostics when automation is unavailable on
the current platform.
