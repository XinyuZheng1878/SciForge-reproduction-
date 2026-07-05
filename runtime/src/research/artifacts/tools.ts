import type { CapabilityToolProvider } from '../../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../../adapters/tool/local-tool-host.js'
import type { ResearchArtifactStore } from './store.js'
import {
  ResearchArtifactCreateRequest,
  ResearchArtifactUpdateRequest
} from './types.js'

/**
 * Builds agent-facing tool providers for the Research Artifact system.
 * These tools allow the agent to create, query, update, and manage research
 * artifacts via the standard MCP-tool interface exposed by the SciForge Runtime.
 */
export function buildResearchArtifactToolProviders(
  store: ResearchArtifactStore | undefined
): CapabilityToolProvider[] {
  if (!store) return []

  return [
    {
      id: 'research-artifact',
      kind: 'memory',
      enabled: true,
      available: true,
      tools: [
        // ── artifact_create ──────────────────────────────
        LocalToolHost.defineTool({
          name: 'artifact_create',
          description:
            'Create a new research artifact record. ' +
            'Use this to record experiments, runs, observations, decisions, ' +
            'documents, or milestones. Requires evidence level, claim scope, ' +
            'and risk level. The artifact is stored in .agents/artifacts.yml.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Optional artifact ID (e.g. EXP-014). Auto-generated if omitted.' },
              type: { type: 'string', enum: ['experiment', 'run', 'observation', 'decision', 'document', 'milestone'] },
              title: { type: 'string', description: 'Short title for the artifact' },
              summary: { type: 'string', description: 'Brief summary of findings or purpose' },
              hypothesisId: { type: 'string', description: 'Associated hypothesis ID if applicable' },
              evidenceLevel: { type: 'string', enum: ['observation', 'preliminary', 'reproduced', 'validated'] },
              claimScope: { type: 'string', enum: ['local-note', 'internal-summary', 'public-claim'], default: 'local-note' },
              riskLevel: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
              sourceRunId: { type: 'string' },
              sourceLogPath: { type: 'string' },
              sourceFilePath: { type: 'string' },
              limitations: { type: 'array', items: { type: 'string' } },
              interpretation: { type: 'string' },
              nextActions: { type: 'array', items: { type: 'string' } },
              tags: { type: 'array', items: { type: 'string' } },
              visibility: { type: 'string', enum: ['local-only', 'github-summary-only', 'github-full'], default: 'local-only' },
              relatedArtifactIds: { type: 'array', items: { type: 'string' } }
            },
            required: ['type', 'title', 'summary', 'evidenceLevel'],
            additionalProperties: false
          },
          policy: 'auto',
          execute: async (args) => {
            try {
              const input = ResearchArtifactCreateRequest.parse(args)
              const artifact = await store.create(input)
              return { output: { artifact, message: `Artifact ${artifact.id} created.` } }
            } catch (error) {
              return { output: { error: errorMessage(error) }, isError: true }
            }
          }
        }),

        // ── artifact_update ──────────────────────────────
        LocalToolHost.defineTool({
          name: 'artifact_update',
          description:
            'Update an existing research artifact. Use this to change status, ' +
            'evidence level, add GitHub references, or update the summary.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Artifact ID to update' },
              title: { type: 'string' },
              status: { type: 'string', enum: ['draft', 'active', 'completed', 'paused', 'abandoned'] },
              summary: { type: 'string' },
              evidenceLevel: { type: 'string', enum: ['observation', 'preliminary', 'reproduced', 'validated'] },
              claimScope: { type: 'string', enum: ['local-note', 'internal-summary', 'public-claim'] },
              riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
              limitations: { type: 'array', items: { type: 'string' } },
              interpretation: { type: 'string' },
              nextActions: { type: 'array', items: { type: 'string' } },
              tags: { type: 'array', items: { type: 'string' } },
              visibility: { type: 'string', enum: ['local-only', 'github-summary-only', 'github-full'] },
              relatedArtifactIds: { type: 'array', items: { type: 'string' } },
              confirmedAt: { type: 'string', description: 'ISO timestamp of user confirmation' }
            },
            required: ['id'],
            additionalProperties: false
          },
          policy: 'auto',
          execute: async (args) => {
            try {
              const id = typeof args.id === 'string' ? args.id : ''
              if (!id) return { output: { error: 'id is required' }, isError: true }
              const input = ResearchArtifactUpdateRequest.parse(args)
              const artifact = await store.update(id, input)
              return { output: { artifact, message: `Artifact ${id} updated.` } }
            } catch (error) {
              return { output: { error: errorMessage(error) }, isError: true }
            }
          }
        }),

        // ── artifact_get ──────────────────────────────
        LocalToolHost.defineTool({
          name: 'artifact_get',
          description: 'Get a research artifact by ID.',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
            additionalProperties: false
          },
          policy: 'auto',
          execute: async (args) => {
            const id = typeof args.id === 'string' ? args.id : ''
            if (!id) return { output: { error: 'id is required' }, isError: true }
            const artifact = await store.get(id)
            if (!artifact) return { output: { error: `Artifact not found: ${id}` }, isError: true }
            return { output: { artifact } }
          }
        }),

        // ── artifact_list ──────────────────────────────
        LocalToolHost.defineTool({
          name: 'artifact_list',
          description:
            'List research artifacts with optional filters by type, status, ' +
            'evidence level, visibility, tags, or hypothesis ID.',
          inputSchema: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['experiment', 'run', 'observation', 'decision', 'document', 'milestone'] },
              status: { type: 'string', enum: ['draft', 'active', 'completed', 'paused', 'abandoned'] },
              evidenceLevel: { type: 'string', enum: ['observation', 'preliminary', 'reproduced', 'validated'] },
              visibility: { type: 'string', enum: ['local-only', 'github-summary-only', 'github-full'] },
              tags: { type: 'array', items: { type: 'string' } },
              hypothesisId: { type: 'string' },
              limit: { type: 'number', description: 'Max results (default 50)' }
            },
            additionalProperties: false
          },
          policy: 'auto',
          execute: async (args) => {
            const artifacts = await store.list({
              type: typeof args.type === 'string' ? args.type : undefined,
              status: typeof args.status === 'string' ? args.status : undefined,
              evidenceLevel: typeof args.evidenceLevel === 'string' ? args.evidenceLevel : undefined,
              visibility: typeof args.visibility === 'string' ? args.visibility : undefined,
              tags: Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : undefined,
              hypothesisId: typeof args.hypothesisId === 'string' ? args.hypothesisId : undefined,
              limit: typeof args.limit === 'number' ? args.limit : 50
            })
            return { output: { artifacts, count: artifacts.length } }
          }
        }),

        // ── artifact_diagnostics ──────────────────────
        LocalToolHost.defineTool({
          name: 'artifact_diagnostics',
          description: 'Get diagnostic summary of the artifact index: counts by type, status, evidence level, etc.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
          },
          policy: 'auto',
          execute: async () => {
            const diag = await store.diagnostics()
            return { output: { diagnostics: diag } }
          }
        })
      ]
    }
  ]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
