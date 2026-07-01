# @sciforge/computer-use

Shared Computer Use MCP extension, contracts, and coordination primitives for
SciForge runtimes.

This package owns the reusable surface:

- agent/session/target/lease contracts
- target lease conflict detection
- optional native/host-control backend primitives with a shared action lock
- model-visible tool-result image helpers
- MCP `computer_use` tool entrypoint

SciForge Runtime, Codex, Claude, and other runtimes can consume this worker
through the GUI-managed `gui_computer_use` MCP server. By default, that path
uses the isolated `browser-cdp` primitive backend for agent browser work.
Native/host input backends such as `global-native` and `mac-app-scoped` remain
optional, internal, or future-facing capabilities for trusted manual testing;
they are not the default GUI-managed path.

The GUI-Owl autonomous task worker currently coexists as a separate path while
human testing decides the final integration shape. This package remains the
low-level primitive layer. Native backends load optional host-control
dependencies lazily and report diagnostics when automation is unavailable on
the current platform.
