# SciForge Scientific Plotting Worker

First-party MCP worker for controlled scientific plotting, figure style extraction/review, and read-only K-Dense Scientific Agent Skills discovery.

The scientific skills MCP tools only index/search/read/plan against locally installed K-Dense skills. Explicit installation is a separate GUI/IPC approval path that writes the selected workspace target and `.sciforge-provenance.json`; the MCP tools do not silently install, update, execute, or add those third-party skills to always-on runtime roots.

It exposes two stdio launch flags through the SciForge app node entries:

- `--scientific-skills-mcp-server`
- `--scientific-plotting-mcp-server`
