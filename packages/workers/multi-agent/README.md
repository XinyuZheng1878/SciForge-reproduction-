# @sciforge/multi-agent

Shared child-run contract, file store, and bounded runtime for SciForge AgentRuntime integrations.

The package does not call model providers and does not store provider credentials. Runtime hosts inject a `ChildRunExecutor`; in SciForge that executor must use the canonical Model Router-backed model client.
