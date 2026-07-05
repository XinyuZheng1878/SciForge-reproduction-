import type { CapabilityToolProvider } from '../../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../../adapters/tool/local-tool-host.js'
import type { HypothesisStore } from './store.js'
import type { ExperimentStore } from '../experiments/store.js'
import type { ResearchArtifactStore } from '../artifacts/store.js'
import {
  HypothesisCreateRequest,
  HypothesisUpdateRequest,
  ResearchLoopState,
  ResearchPhase,
  type ResearchLoopState as ResearchLoopStateType
} from './types.js'

/**
 * Builds the autonomous research loop tools that orchestrate the full
 * scientific method: observe → hypothesize → design → execute → analyze → decide.
 *
 * These tools coordinate across all three subsystems:
 *  - Hypothesis Store (hypotheses)
 *  - Experiment Store (experiment specs & runs)
 *  - Research Artifact Store (observations, decisions, documents)
 */
export function buildResearchLoopToolProviders(
  hypothesisStore: HypothesisStore | undefined,
  experimentStore: ExperimentStore | undefined,
  artifactStore: ResearchArtifactStore | undefined
): CapabilityToolProvider[] {
  // The loop tools require at least the hypothesis store
  if (!hypothesisStore) return []

  // In-memory loop state (one active research session at a time)
  let loopState: ResearchLoopStateType | null = null

  function ensureState(): ResearchLoopStateType {
    if (!loopState) {
      throw new Error('No active research loop. Use research_start first.')
    }
    return loopState
  }

  function log(phase: ResearchLoopStateType['phase'], message: string): void {
    if (loopState) {
      loopState.log.push({ phase: phase as ResearchLoopStateType['phase'], message, timestamp: new Date().toISOString() })
    }
  }

  return [
    {
      id: 'research-loop',
      kind: 'memory',
      enabled: true,
      available: true,
      tools: [
        // ── research_start ──────────────────────────────
        LocalToolHost.defineTool({
          name: 'research_start',
          description:
            'Start or restart an autonomous research loop. ' +
            'Define the research goal, set iteration limits, and specify stop conditions. ' +
            'This initializes the research session state. Only one loop can be active at a time.',
          policy: 'on-request',
          inputSchema: {
            type: 'object',
            properties: {
              goal: {
                type: 'string',
                description: 'The research question or goal. E.g., "Determine whether larger models consistently outperform smaller ones on NLI tasks"'
              },
              maxIterations: {
                type: 'number',
                description: 'Maximum research iterations (default 10)'
              },
              stopConditions: {
                type: 'array',
                items: { type: 'string' },
                description: 'Conditions that should cause the loop to stop. E.g., ["At least 2 hypotheses validated", "Budget exhausted"]'
              }
            },
            required: ['goal']
          },
          execute: async (args) => {
            const goal = typeof args.goal === 'string' ? args.goal.trim() : ''
            if (!goal) return { output: { ok: false, error: 'goal is required' }, isError: true }

            const now = new Date().toISOString()
            loopState = ResearchLoopState.parse({
              sessionId: `RS-${Date.now().toString(36).toUpperCase()}`,
              phase: 'observing',
              goal,
              iteration: 0,
              maxIterations: typeof args.maxIterations === 'number' ? args.maxIterations : 10,
              stopConditions: Array.isArray(args.stopConditions) ? args.stopConditions : [],
              shouldStop: false,
              stopReason: '',
              summary: '',
              startedAt: now,
              updatedAt: now,
              log: [{ phase: 'observing', message: `Research loop started: ${goal}`, timestamp: now }]
            })

            return {
              output: {
                ok: true,
                sessionId: loopState.sessionId,
                goal: loopState.goal,
                maxIterations: loopState.maxIterations,
                phase: 'observing',
                instruction: 'Research loop initialized. Start by calling research_observe to gather existing knowledge, then research_hypothesize to generate hypotheses.'
              }
            }
          }
        }),

        // ── research_hypothesize ────────────────────────
        LocalToolHost.defineTool({
          name: 'research_hypothesize',
          description:
            'Generate and record a new scientific hypothesis. Each hypothesis should be falsifiable: ' +
            'it must specify what evidence would prove it wrong. Hypotheses are tracked with Bayesian confidence ' +
            'that updates automatically as experiments are run.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short hypothesis title' },
              statement: { type: 'string', description: 'Full hypothesis statement with clear prediction' },
              falsificationCriteria: { type: 'string', description: 'What evidence would falsify this hypothesis' },
              premises: { type: 'array', items: { type: 'string' }, description: 'Observations or prior knowledge supporting this hypothesis' },
              predictions: { type: 'array', items: { type: 'string' }, description: 'Testable predictions this hypothesis makes' },
              tags: { type: 'array', items: { type: 'string' } },
              parentHypothesisId: { type: 'string', description: 'Parent hypothesis ID if this is a refinement' },
              priorConfidence: { type: 'number', description: 'Initial confidence 0-1 (default 0.5)' }
            },
            required: ['title', 'statement']
          },
          execute: async (args) => {
            try {
              const input = HypothesisCreateRequest.parse(args)
              const hypothesis = await hypothesisStore.create(input)
              log('hypothesizing', `Created hypothesis: ${hypothesis.title}`)
              return { output: { ok: true, hypothesis } }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        }),

        // ── research_design ─────────────────────────────
        LocalToolHost.defineTool({
          name: 'research_design',
          description:
            'Design an experiment to test a specific hypothesis. This does NOT run the experiment — ' +
            'use experiment_create + experiment_run for that. This tool records the design decision ' +
            'and links the hypothesis to the experiment.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {
              hypothesisId: { type: 'string', description: 'Hypothesis this experiment tests' },
              experimentSpecId: { type: 'string', description: 'ID of the experiment spec (created with experiment_create)' },
              rationale: { type: 'string', description: 'Why this experiment design tests the hypothesis' }
            },
            required: ['hypothesisId', 'experimentSpecId']
          },
          execute: async (args) => {
            try {
              const hypothesisId = typeof args.hypothesisId === 'string' ? args.hypothesisId.trim() : ''
              const experimentSpecId = typeof args.experimentSpecId === 'string' ? args.experimentSpecId.trim() : ''
              if (!hypothesisId || !experimentSpecId) {
                return { output: { ok: false, error: 'hypothesisId and experimentSpecId are required' }, isError: true }
              }
              const hypothesis = await hypothesisStore.get(hypothesisId)
              if (!hypothesis) return { output: { ok: false, error: `Hypothesis not found: ${hypothesisId}` }, isError: true }

              // Link experiment to hypothesis
              if (!hypothesis.experimentIds.includes(experimentSpecId)) {
                await hypothesisStore.update(hypothesisId, {
                  experimentIds: [...hypothesis.experimentIds, experimentSpecId]
                })
              }
              log('designing', `Designed experiment ${experimentSpecId} for hypothesis ${hypothesisId}`)
              return {
                output: {
                  ok: true,
                  hypothesisId,
                  experimentSpecId,
                  rationale: typeof args.rationale === 'string' ? args.rationale : '',
                  instruction: 'Now call experiment_run to execute this experiment, then research_analyze to update the hypothesis.'
                }
              }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        }),

        // ── research_analyze ────────────────────────────
        LocalToolHost.defineTool({
          name: 'research_analyze',
          description:
            'Analyze experiment results and update hypothesis confidence using Bayesian updating. ' +
            'Record whether the result supports or contradicts the hypothesis. ' +
            'This automatically updates the hypothesis posterior probability and status.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {
              hypothesisId: { type: 'string', description: 'Hypothesis to update' },
              experimentRunId: { type: 'string', description: 'ID of the completed experiment run' },
              supported: { type: 'boolean', description: 'Whether the result supports (true) or contradicts (false) the hypothesis' },
              interpretation: { type: 'string', description: 'Narrative interpretation of the result' },
              limitations: { type: 'array', items: { type: 'string' }, description: 'Limitations of this experiment' },
              nextActions: { type: 'array', items: { type: 'string' }, description: 'Recommended next steps' }
            },
            required: ['hypothesisId', 'experimentRunId', 'supported']
          },
          execute: async (args) => {
            try {
              const hypothesisId = typeof args.hypothesisId === 'string' ? args.hypothesisId.trim() : ''
              const experimentRunId = typeof args.experimentRunId === 'string' ? args.experimentRunId.trim() : ''
              const supported = args.supported === true

              if (!hypothesisId || !experimentRunId) {
                return { output: { ok: false, error: 'hypothesisId and experimentRunId are required' }, isError: true }
              }

              // Update hypothesis with trial result
              const updated = await hypothesisStore.update(hypothesisId, {
                recordTrial: { supported, experimentId: experimentRunId }
              })

              // Create research artifact recording this analysis
              if (artifactStore) {
                try {
                  await artifactStore.create({
                    type: 'observation',
                    title: `Analysis: ${updated.title}`,
                    summary: `Experiment ${experimentRunId} ${supported ? 'supports' : 'contradicts'} hypothesis ${hypothesisId}. ` +
                      `Posterior confidence: ${updated.confidence.posterior.toFixed(3)} (was ${updated.confidence.prior.toFixed(3)}). ` +
                      `${typeof args.interpretation === 'string' ? args.interpretation : ''}`,
                    evidenceLevel: updated.confidence.totalTrials >= 3 ? 'preliminary' : 'observation',
                    hypothesisId,
                    sourceRunId: experimentRunId,
                    limitations: Array.isArray(args.limitations) ? args.limitations : [],
                    interpretation: typeof args.interpretation === 'string' ? args.interpretation : undefined,
                    nextActions: Array.isArray(args.nextActions) ? args.nextActions : [],
                    tags: [...updated.tags, `trial-${supported ? 'support' : 'contradict'}`]
                  })
                } catch {
                  // Artifact creation is best-effort
                }
              }

              log('analyzing', `${supported ? 'Support' : 'Contradiction'} for ${hypothesisId}: posterior=${updated.confidence.posterior.toFixed(3)}`)

              return {
                output: {
                  ok: true,
                  hypothesis: {
                    id: updated.id,
                    title: updated.title,
                    status: updated.status,
                    confidence: updated.confidence
                  },
                  experimentRunId,
                  supported,
                  interpretation: typeof args.interpretation === 'string' ? args.interpretation : ''
                }
              }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        }),

        // ── research_decide ─────────────────────────────
        LocalToolHost.defineTool({
          name: 'research_decide',
          description:
            'Decide the next action in the research loop. Based on current hypotheses, ' +
            'experiment results, and stop conditions, choose: continue investigating, ' +
            'switch to a different hypothesis, generate new hypotheses, or conclude.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['continue', 'switch_hypothesis', 'new_hypothesis', 'conclude', 'refine'],
                description: 'Next action to take'
              },
              reason: { type: 'string', description: 'Rationale for this decision' },
              targetHypothesisId: { type: 'string', description: 'Hypothesis ID if switching or refining' },
              summary: { type: 'string', description: 'Summary of findings if concluding' }
            },
            required: ['action', 'reason']
          },
          execute: async (args) => {
            try {
              const state = ensureState()
              const action = typeof args.action === 'string' ? args.action.trim() : 'continue'
              const reason = typeof args.reason === 'string' ? args.reason : ''

              state.iteration += 1

              // Check stop conditions
              if (action === 'conclude' || state.iteration >= state.maxIterations) {
                state.shouldStop = true
                state.stopReason = action === 'conclude'
                  ? `Concluded by agent: ${reason}`
                  : `Reached max iterations (${state.maxIterations})`
                state.phase = 'concluding'
                state.summary = typeof args.summary === 'string' ? args.summary : reason
              } else {
                state.phase = action === 'new_hypothesis' ? 'hypothesizing'
                  : action === 'switch_hypothesis' ? 'designing'
                  : action === 'refine' ? 'designing'
                  : 'executing'
              }

              if (typeof args.targetHypothesisId === 'string') {
                state.activeHypothesisId = args.targetHypothesisId
              }

              log('deciding', `Action: ${action} — ${reason}`)
              state.updatedAt = new Date().toISOString()

              return {
                output: {
                  ok: true,
                  action,
                  reason,
                  iteration: state.iteration,
                  maxIterations: state.maxIterations,
                  shouldStop: state.shouldStop,
                  stopReason: state.stopReason || undefined,
                  phase: state.phase,
                  activeHypothesisId: state.activeHypothesisId
                }
              }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        }),

        // ── research_status ─────────────────────────────
        LocalToolHost.defineTool({
          name: 'research_status',
          description:
            'Get the current research loop status: active hypotheses, experiment history, ' +
            'phase, iteration count, and stop conditions. ' +
            'Use this to understand the current state before making decisions.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {
              includeHypotheses: { type: 'boolean', description: 'Include hypothesis list (default true)' },
              includeExperiments: { type: 'boolean', description: 'Include recent experiment specs (default true)' }
            }
          },
          execute: async (args) => {
            try {
              const includeHypotheses = args.includeHypotheses !== false
              const includeExperiments = args.includeExperiments !== false

              const [hypotheses, hypothesisDiag] = includeHypotheses
                ? [await hypothesisStore.list({ limit: 20 }), await hypothesisStore.diagnostics()]
                : [null, null]

              const [specs, experimentDiag] = includeExperiments && experimentStore
                ? [await experimentStore.listSpecs({ limit: 20 }), await experimentStore.diagnostics()]
                : [null, null]

              return {
                output: {
                  ok: true,
                  loopState: loopState ? {
                    sessionId: loopState.sessionId,
                    phase: loopState.phase,
                    goal: loopState.goal,
                    iteration: loopState.iteration,
                    maxIterations: loopState.maxIterations,
                    shouldStop: loopState.shouldStop,
                    stopReason: loopState.stopReason || undefined,
                    activeHypothesisId: loopState.activeHypothesisId,
                    summary: loopState.summary || undefined,
                    recentLog: loopState.log.slice(-10)
                  } : null,
                  ...(hypotheses ? {
                    hypotheses: hypotheses.map(h => ({
                      id: h.id, title: h.title, status: h.status,
                      confidence: h.confidence.posterior,
                      trials: h.confidence.totalTrials,
                      experimentIds: h.experimentIds.slice(0, 5)
                    }))
                  } : {}),
                  ...(hypothesisDiag ? { hypothesisDiagnostics: hypothesisDiag } : {}),
                  ...(specs ? { experimentSpecs: specs.map(s => ({ id: s.id, title: s.title, language: s.language })) } : {}),
                  ...(experimentDiag ? { experimentDiagnostics: experimentDiag } : {})
                }
              }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        }),

        // ── research_synthesize ─────────────────────────
        LocalToolHost.defineTool({
          name: 'research_synthesize',
          description:
            'Synthesize current findings across all hypotheses into a coherent summary. ' +
            'Use this near the end of a research loop to prepare conclusions.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {
              conclusion: { type: 'string', description: 'Overall conclusion from the research' },
              keyFindings: { type: 'array', items: { type: 'string' }, description: 'List of key findings' },
              validatedHypotheses: { type: 'array', items: { type: 'string' }, description: 'IDs of validated hypotheses' },
              openQuestions: { type: 'array', items: { type: 'string' }, description: 'Remaining open questions' }
            },
            required: ['conclusion']
          },
          execute: async (args) => {
            try {
              const state = ensureState()
              const conclusion = typeof args.conclusion === 'string' ? args.conclusion : ''
              state.summary = conclusion
              state.updatedAt = new Date().toISOString()
              log('concluding', `Synthesized findings: ${conclusion.slice(0, 200)}`)

              // Create a milestone artifact
              if (artifactStore && conclusion) {
                try {
                  await artifactStore.create({
                    type: 'milestone',
                    title: `Research Synthesis: ${state.goal.slice(0, 80)}`,
                    summary: conclusion,
                    evidenceLevel: 'preliminary',
                    interpretation: conclusion,
                    nextActions: Array.isArray(args.openQuestions) ? args.openQuestions : [],
                    tags: ['research-synthesis', 'autonomous']
                  })
                } catch {
                  // Best effort
                }
              }

              return {
                output: {
                  ok: true,
                  conclusion,
                  keyFindings: args.keyFindings || [],
                  validatedHypotheses: args.validatedHypotheses || [],
                  openQuestions: args.openQuestions || []
                }
              }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        })
      ]
    }
  ]
}
