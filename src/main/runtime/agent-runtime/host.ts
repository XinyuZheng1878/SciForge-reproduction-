import path from 'node:path'
import {
  getActiveAgentRuntime,
  normalizeAgentRuntimeId,
  type AppSettingsV1
} from '../../../shared/app-settings'
import { resolveRuntimeModelRouterSettings } from '../../../shared/app-settings-model-router'
import type {
  AgentRuntimeAuxiliaryInput,
  AgentRuntimeCapabilities,
  AgentRuntimeCapabilityDescriptor,
  AgentRuntimeCodeNavigationInput,
  AgentRuntimeContextState,
  AgentRuntimeEvent,
  AgentRuntimeFileReference,
  AgentRuntimeGovernanceProfile,
  AgentRuntimeId,
  AgentRuntimeItem,
  AgentRuntimeMemoryRecord,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail,
  AgentRuntimeThreadListInput,
  AgentRuntimeThreadReadInput,
  AgentRuntimeThreadStartInput,
  AgentRuntimeTurnHandle,
  AgentRuntimeTurnStartInput,
  AgentRuntimeTurnSteerInput,
  AgentRuntimeTurnTargetInput,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse
} from '../../../shared/agent-runtime-contract'
import type {
  AgentRuntimeAdapter,
  AgentRuntimeAdapterContext,
  AgentRuntimeApprovalResolveInput,
  AgentRuntimeEventSubscribeInput,
  AgentRuntimeSessionResumeHandle,
  AgentRuntimeSessionResumeInput,
  AgentRuntimeThreadCompactInput,
  AgentRuntimeThreadDeleteInput,
  AgentRuntimeThreadForkInput,
  AgentRuntimeThreadRelationInput,
  AgentRuntimeThreadRenameInput,
  AgentRuntimeUserInputResolveInput
} from './adapter'
import { RuntimeGovernanceSupervisor, runtimeGuardSettings } from './governance'
import {
  completedTurnItems,
  feedEvidenceDag,
  isEvidenceDagFeedEnabled
} from '../evidence-dag-feed'
import { AgentRuntimeContextCompactor } from './context-compactor'
import type { LspCodeNavigationService } from '../../services/lsp-code-navigation-service'
import type { ModelRequestAuditRecorder } from '../../services/model-request-audit-service'
import type { RuntimeContextStateService } from '../../services/runtime-context-state-service'
import type { GitCheckpointService } from '../../services/git-checkpoint-service'
import type { SharedMemoryService } from '../../services/shared-memory-service'
import type { WorkspaceReferenceService } from '../../services/workspace-reference-service'

export type AgentRuntimeHostSettingsProvider = () => AppSettingsV1 | Promise<AppSettingsV1>

export type AgentRuntimeHostServices = {
  codeNavigation?: LspCodeNavigationService
  modelAudit?: ModelRequestAuditRecorder
  contextState?: RuntimeContextStateService
  gitCheckpoints?: GitCheckpointService
  memory?: SharedMemoryService
  workspaceReferences?: WorkspaceReferenceService
}

export type AgentRuntimeHostOptions = {
  settings: AgentRuntimeHostSettingsProvider
  adapters:
    | AgentRuntimeAdapter[]
    | Partial<Record<AgentRuntimeId, AgentRuntimeAdapter>>
  services?: AgentRuntimeHostServices
}

export function createAgentRuntimeHost(options: AgentRuntimeHostOptions): AgentRuntimeHost {
  return new AgentRuntimeHost(options)
}

const THREAD_TURN_QUEUE_POLL_MS = 1_000
const THREAD_TURN_QUEUE_TIMEOUT_MS = 10 * 60_000

export class AgentRuntimeHost {
  private readonly adapters: Map<AgentRuntimeId, AgentRuntimeAdapter>
  private readonly turnQueues = new Map<string, Promise<unknown>>()
  private readonly turnGovernanceProfiles = new Map<string, AgentRuntimeGovernanceProfile>()
  private readonly turnWorkspaces = new Map<string, string>()
  private readonly postTurnCheckpoints = new Set<string>()
  private readonly evidenceDagFedTurns = new Set<string>()
  private readonly governance = new RuntimeGovernanceSupervisor()

  constructor(private readonly options: AgentRuntimeHostOptions) {
    this.adapters = normalizeAdapters(options.adapters)
  }

  async connect(runtimeId?: AgentRuntimeId): Promise<void> {
    const { adapter, context } = await this.resolve(runtimeId)
    await adapter.connect(context)
  }

  async capabilities(runtimeId?: AgentRuntimeId): Promise<AgentRuntimeCapabilities> {
    const { adapter, context } = await this.resolve(runtimeId)
    return this.withHostCapabilities(await adapter.capabilities(context))
  }

  async listThreads(input: AgentRuntimeThreadListInput = {}): Promise<AgentRuntimeThread[]> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    return adapter.listThreads(context, input)
  }

  async startThread(input: AgentRuntimeThreadStartInput): Promise<AgentRuntimeThread> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    return adapter.startThread(context, input)
  }

  async readThread(input: AgentRuntimeThreadReadInput): Promise<AgentRuntimeThreadDetail> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    return adapter.readThread(context, input)
  }

  async startTurn(input: AgentRuntimeTurnStartInput): Promise<AgentRuntimeTurnHandle> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    await this.autoCompactThreadIfNeeded(adapter, context, input)
    const safeInput = this.withWorkspaceRelativeFileReferences(context, input)
    const memoryInput = await this.withSharedMemory(context, safeInput)
    const turnInput = this.withSharedContextState(adapter.id, memoryInput)
    this.createPreTurnCheckpoint(adapter.id, context, turnInput)
    const modelRouter = resolveRuntimeModelRouterSettings(context.settings)
    const modelAlias = input.model?.trim() || modelRouter.model
    const auditId = this.options.services?.modelAudit?.start({
      runtimeId: adapter.id,
      threadId: input.threadId,
      provider: 'model-router',
      model: modelAlias,
      modelRouterUrl: modelRouter.baseUrl,
      providerAlias: 'model-router',
      modelAlias,
      modelRouter: {
        requestUrl: buildModelRouterResponsesUrl(modelRouter.baseUrl),
        endpointRoute: 'responses'
      },
      request: turnInput
    })
    try {
      const handle = await this.enqueueThreadTurnStart(adapter, context, turnInput)
      if (auditId) {
        this.options.services?.modelAudit?.attachTurn(
          auditId,
          adapter.id,
          handle.threadId || input.threadId,
          handle.turnId
        )
      }
      this.rememberTurnWorkspace(adapter.id, turnInput, handle)
      return handle
    } catch (error) {
      if (auditId) this.options.services?.modelAudit?.fail(auditId, error)
      throw error
    }
  }

  async interruptTurn(input: AgentRuntimeTurnTargetInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    await adapter.interruptTurn(context, input)
  }

  async steerTurn(input: AgentRuntimeTurnSteerInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    await adapter.steerTurn(context, input)
  }

  async renameThread(input: AgentRuntimeThreadRenameInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    await adapter.renameThread(context, input)
  }

  async deleteThread(input: AgentRuntimeThreadDeleteInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    await adapter.deleteThread(context, input)
  }

  async *subscribeEvents(input: AgentRuntimeEventSubscribeInput): AsyncIterable<AgentRuntimeEvent> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    const capabilities = await adapter.capabilities(context)
    const guardSettings = runtimeGuardSettings(context)
    for await (const event of adapter.subscribeEvents(context, input)) {
      this.options.services?.modelAudit?.observeEvent(event)
      this.options.services?.contextState?.observeEvent(event)
      this.createPostTurnCheckpoint(adapter.id, event)
      this.governance.observe(event, capabilities, guardSettings, {
        governanceProfile: this.governanceProfileForEvent(capabilities.runtimeId, event),
        steerTurn: (payload) => this.steerTurn(payload),
        interruptTurn: (payload) => this.interruptTurn(payload),
        publishSyntheticEvent: (payload) => this.publishSyntheticEvent(adapter, context, payload)
      })
      this.feedEvidenceDagForCompletedTurn(adapter, context, event)
      yield event
    }
  }

  async resolveApproval(input: AgentRuntimeApprovalResolveInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    if (!adapter.resolveApproval) throw unsupported(adapter.id, 'approval')
    await adapter.resolveApproval(context, input)
  }

  async resolveUserInput(input: AgentRuntimeUserInputResolveInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    if (!adapter.resolveUserInput) throw unsupported(adapter.id, 'user input')
    await adapter.resolveUserInput(context, input)
  }

  async compactThread(input: AgentRuntimeThreadCompactInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    const capabilities = await adapter.capabilities(context)
    if (capabilities.controls.compact === 'noop') {
      await this.recordNoopCompaction(adapter, context, input)
      return
    }
    if (!adapter.compactThread || capabilities.controls.compact === 'unsupported') {
      throw unsupported(adapter.id, 'compact')
    }
    await adapter.compactThread(context, input)
  }

  async forkThread(input: AgentRuntimeThreadForkInput): Promise<AgentRuntimeThread> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    if (!adapter.forkThread) throw unsupported(adapter.id, 'fork')
    return adapter.forkThread(context, input)
  }

  async resumeSession(input: AgentRuntimeSessionResumeInput): Promise<AgentRuntimeSessionResumeHandle> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    if (!adapter.resumeSession) throw unsupported(adapter.id, 'resume session')
    const service = this.options.services?.contextState
    const sourceState = service?.peek({
      runtimeId: adapter.id,
      threadId: input.sessionId
    })
    const previousGoalResume = sourceState?.goalResume
    if (
      input.maxResumeCount !== undefined &&
      previousGoalResume &&
      previousGoalResume.resumeCount >= input.maxResumeCount
    ) {
      const error = new Error(`Goal resume count limit reached (${input.maxResumeCount}).`)
      service?.updateGoalResume({
        runtimeId: adapter.id,
        threadId: input.sessionId,
        objective: previousGoalResume.objective,
        status: 'blocked',
        resumeCount: previousGoalResume.resumeCount,
        lastFailureReason: error.message
      })
      throw error
    }
    try {
      const result = await adapter.resumeSession(context, input)
      if (previousGoalResume) {
        service?.updateGoalResume({
          runtimeId: adapter.id,
          threadId: result.threadId,
          objective: previousGoalResume.objective,
          status: 'active',
          resumeCount: previousGoalResume.resumeCount + 1
        })
      }
      return result
    } catch (error) {
      if (previousGoalResume) {
        service?.updateGoalResume({
          runtimeId: adapter.id,
          threadId: input.sessionId,
          objective: previousGoalResume.objective,
          status: 'blocked',
          resumeCount: previousGoalResume.resumeCount,
          lastFailureReason: errorMessage(error)
        })
      }
      throw error
    }
  }

  async updateThreadRelation(input: AgentRuntimeThreadRelationInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    if (!adapter.updateThreadRelation) throw unsupported(adapter.id, 'thread relation')
    await adapter.updateThreadRelation(context, input)
  }

  async usage(input: AgentRuntimeUsageQuery): Promise<AgentRuntimeUsageResponse> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    if (!adapter.usage) {
      return {
        supported: false,
        reason: `${adapter.id} AgentRuntimeAdapter does not support usage.`,
        groupBy: input.groupBy,
        buckets: [],
        totals: {}
      }
    }
    return adapter.usage(context, input)
  }

  async auxiliary(input: AgentRuntimeAuxiliaryInput): Promise<unknown> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    const hostResult = await this.handleHostAuxiliary(adapter.id, context, input)
    if (hostResult.handled) return hostResult.value
    if (!adapter.auxiliary) throw unsupported(adapter.id, input.operation)
    return adapter.auxiliary(context, input)
  }

  private async handleHostAuxiliary(
    runtimeId: AgentRuntimeId,
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeAuxiliaryInput
  ): Promise<{ handled: true; value: unknown } | { handled: false }> {
    const payload = recordPayload(input.payload)
    switch (input.operation) {
      case 'runCodeNavigation': {
        const service = this.options.services?.codeNavigation
        if (!service) return { handled: false }
        return {
          handled: true,
          value: await service.query({
            workspaceRoot: requiredString(payload, 'workspaceRoot', context.settings.workspaceRoot || ''),
            operation: requiredString(payload, 'operation') as AgentRuntimeCodeNavigationInput['operation'],
            ...(optionalString(payload.filePath) ? { filePath: optionalString(payload.filePath) } : {}),
            ...(numberValue(payload.line) ? { line: numberValue(payload.line) } : {}),
            ...(numberValue(payload.character) ? { character: numberValue(payload.character) } : {}),
            ...(optionalString(payload.query) ? { query: optionalString(payload.query) } : {})
          })
        }
      }
      case 'listModelAuditRecords':
        return {
          handled: true,
          value: this.options.services?.modelAudit?.snapshot({
            runtimeId: optionalRuntimeId(payload.runtimeId),
            threadId: optionalString(payload.threadId),
            limit: numberValue(payload.limit)
          }) ?? []
        }
      case 'clearModelAuditRecords':
        return { handled: true, value: this.options.services?.modelAudit?.clear() ?? false }
      case 'getContextState': {
        const service = this.options.services?.contextState
        if (!service) return { handled: false }
        return {
          handled: true,
          value: service.get({
            runtimeId,
            threadId: requiredString(payload, 'threadId')
          })
        }
      }
      case 'recordContextCompaction': {
        const service = this.options.services?.contextState
        if (!service) return { handled: false }
        return {
          handled: true,
          value: service.recordCompaction({
            runtimeId,
            threadId: requiredString(payload, 'threadId'),
            summary: optionalString(payload.summary),
            summarySource: optionalString(payload.summarySource) as never,
            triggerReason: optionalString(payload.triggerReason),
            rawHistoryItems: numberValue(payload.rawHistoryItems),
            effectiveHistoryItems: numberValue(payload.effectiveHistoryItems),
            estimatedTokens: numberValue(payload.estimatedTokens),
            replacedTokens: numberValue(payload.replacedTokens),
            sourceDigest: optionalString(payload.sourceDigest),
            digestMarker: optionalString(payload.digestMarker),
            sourceItemIds: arrayOfStrings(payload.sourceItemIds)
          })
        }
      }
      case 'updateGoalResumeState': {
        const service = this.options.services?.contextState
        if (!service) return { handled: false }
        return {
          handled: true,
          value: service.updateGoalResume({
            runtimeId,
            threadId: requiredString(payload, 'threadId'),
            objective: optionalString(payload.objective),
            status: optionalString(payload.status) as never,
            lastFailureReason: optionalString(payload.lastFailureReason),
            incrementResumeCount: payload.incrementResumeCount === true
          })
        }
      }
      case 'listGitCheckpoints':
        return {
          handled: true,
          value: await this.options.services?.gitCheckpoints?.list({
            runtimeId: optionalRuntimeId(payload.runtimeId),
            threadId: optionalString(payload.threadId),
            workspaceRoot: optionalString(payload.workspaceRoot)
          }) ?? []
        }
      case 'createGitCheckpoint': {
        const service = this.options.services?.gitCheckpoints
        if (!service) return { handled: false }
        return {
          handled: true,
          value: await service.create({
            runtimeId,
            threadId: requiredString(payload, 'threadId'),
            workspaceRoot: requiredString(payload, 'workspaceRoot', context.settings.workspaceRoot || ''),
            ...(optionalString(payload.turnId) ? { turnId: optionalString(payload.turnId) } : {})
          })
        }
      }
      case 'previewGitCheckpoint': {
        const service = this.options.services?.gitCheckpoints
        if (!service) return { handled: false }
        return {
          handled: true,
          value: await service.preview(requiredString(payload, 'checkpointId'))
        }
      }
      case 'restoreGitCheckpoint': {
        const service = this.options.services?.gitCheckpoints
        if (!service) return { handled: false }
        return {
          handled: true,
          value: await service.restore({
            checkpointId: requiredString(payload, 'checkpointId'),
            force: payload.force === true
          })
        }
      }
      case 'createMemory': {
        const service = this.options.services?.memory
        if (!service) return { handled: false }
        return {
          handled: true,
          value: await service.create({
            text: requiredString(payload, 'text'),
            scope: optionalString(payload.scope) as never,
            workspace: optionalString(payload.workspace),
            project: optionalString(payload.project),
            tags: arrayOfStrings(payload.tags),
            confidence: numberValue(payload.confidence),
            disabled: payload.disabled === true
          })
        }
      }
      case 'listMemories': {
        const service = this.options.services?.memory
        if (!service) return { handled: false }
        const options = recordPayload(payload.options)
        return {
          handled: true,
          value: await service.list({
            scope: optionalString(options.scope ?? payload.scope) as never,
            workspace: optionalString(options.workspace ?? payload.workspace) || context.settings.workspaceRoot,
            includeDeleted: (options.includeDeleted ?? payload.includeDeleted) === true,
            includeDisabled: (options.includeDisabled ?? payload.includeDisabled) === true,
            query: optionalString(options.query ?? payload.query),
            limit: numberValue(options.limit ?? payload.limit)
          })
        }
      }
      case 'updateMemory': {
        const service = this.options.services?.memory
        if (!service) return { handled: false }
        return {
          handled: true,
          value: await service.update({
            memoryId: requiredString(payload, 'memoryId'),
            patch: recordPayload(payload.patch) as never
          })
        }
      }
      case 'deleteMemory': {
        const service = this.options.services?.memory
        if (!service) return { handled: false }
        return {
          handled: true,
          value: await service.delete(requiredString(payload, 'memoryId'))
        }
      }
      case 'listWorkspaceReferences': {
        const service = this.options.services?.workspaceReferences
        if (!service) return { handled: false }
        return {
          handled: true,
          value: await service.list({
            workspaceRoot: requiredString(payload, 'workspaceRoot', context.settings.workspaceRoot || ''),
            path: optionalString(payload.path),
            recursive: payload.recursive === true,
            limit: numberValue(payload.limit)
          })
        }
      }
      case 'previewWorkspaceReference': {
        const service = this.options.services?.workspaceReferences
        if (!service) return { handled: false }
        return {
          handled: true,
          value: await service.preview({
            workspaceRoot: requiredString(payload, 'workspaceRoot', context.settings.workspaceRoot || ''),
            path: requiredString(payload, 'path')
          })
        }
      }
      default:
        return { handled: false }
    }
  }

  private withHostCapabilities(capabilities: AgentRuntimeCapabilities): AgentRuntimeCapabilities {
    const services = this.options.services ?? {}
    const descriptors: AgentRuntimeCapabilityDescriptor[] = [
      ...(capabilities.capabilityDescriptors ?? [])
    ]
    const addDescriptor = (
      descriptor: AgentRuntimeCapabilityDescriptor
    ): void => {
      descriptors.push(descriptor)
    }

    if (services.codeNavigation) {
      addDescriptor({
        id: 'codeNavigation.lsp',
        channel: 'host_service',
        available: true,
        readonly: true,
        inputSchema: 'AgentRuntimeCodeNavigationInput',
        outputSchema: 'AgentRuntimeResult<AgentRuntimeCodeNavigationOutput>',
        errorCodes: ['language_server_missing', 'invalid_position', 'unsupported_language']
      })
    }
    if (services.modelAudit) {
      addDescriptor({
        id: 'modelAudit.runtimeRequests',
        channel: 'host_service',
        available: true,
        inputSchema: 'AgentRuntimeAuxiliaryInput',
        outputSchema: 'AgentRuntimeModelAuditRecord[]'
      })
    }
    if (services.contextState) {
      addDescriptor({
        id: 'context.state',
        channel: 'host_service',
        available: true,
        inputSchema: 'threadId',
        outputSchema: 'AgentRuntimeContextState'
      })
      addDescriptor({
        id: 'context.goalResume',
        channel: 'host_service',
        available: true,
        inputSchema: 'threadId',
        outputSchema: 'AgentRuntimeContextState.goalResume'
      })
    }
    if (services.gitCheckpoints) {
      addDescriptor({
        id: 'git.turnCheckpoint',
        channel: 'host_service',
        available: true,
        inputSchema: 'workspaceRoot/threadId/turnId',
        outputSchema: 'AgentRuntimeGitCheckpoint',
        errorCodes: ['dirty_worktree', 'branch_changed', 'not_git_repo', 'git_unavailable']
      })
    }
    if (services.memory) {
      addDescriptor({
        id: 'memory.shared',
        channel: 'host_service',
        available: true,
        inputSchema: 'AgentRuntimeMemoryRecord',
        outputSchema: 'AgentRuntimeMemoryRecord[]'
      })
    }
    if (services.workspaceReferences) {
      addDescriptor({
        id: 'workspace.references',
        channel: 'host_service',
        available: true,
        readonly: true,
        inputSchema: 'workspaceRoot/path',
        outputSchema: 'AgentRuntimeWorkspaceReferencePreview'
      })
    }

    return {
      ...capabilities,
      tools: {
        ...capabilities.tools,
        ...(services.codeNavigation
          ? {
              codeNavigation: {
                available: true,
                operations: [
                  'goToDefinition',
                  'findReferences',
                  'hover',
                  'documentSymbol',
                  'workspaceSymbol',
                  'goToImplementation'
                ],
                languages: ['typescript', 'javascript'],
                readonly: true
              }
            }
          : {})
      },
      observability: {
        ...capabilities.observability,
        modelAudit: services.modelAudit
          ? { available: true, capacity: 50, inMemory: true }
          : capabilities.observability?.modelAudit ?? { available: false, reason: 'unsupported' }
      },
      context: {
        ...capabilities.context,
        state: services.contextState
          ? { available: true }
          : capabilities.context?.state ?? { available: false, reason: 'unsupported' },
        compaction: capabilities.context?.compaction ?? {
          available: capabilities.controls.compact === 'native' || capabilities.controls.compact === 'noop',
          ...(capabilities.controls.compact === 'unsupported' ? { reason: 'unsupported' } : {})
        },
        goalResume: services.contextState
          ? { available: true, degraded: capabilities.controls.goals !== true }
          : capabilities.context?.goalResume ?? { available: false, reason: 'unsupported' }
      },
      storage: {
        ...capabilities.storage,
        memory: services.memory ? { available: true } : capabilities.storage.memory,
        checkpoints: services.gitCheckpoints
          ? { available: true }
          : capabilities.storage.checkpoints ?? { available: false, reason: 'unsupported' },
        workspaceReferences: services.workspaceReferences
          ? { available: true }
          : capabilities.storage.workspaceReferences ?? { available: false, reason: 'unsupported' }
      },
      capabilityDescriptors: descriptors
    }
  }

  private async withSharedMemory(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeTurnStartInput
  ): Promise<AgentRuntimeTurnStartInput> {
    const service = this.options.services?.memory
    if (!service) return input
    const records = await service.retrieveForTurn({
      workspace: input.workspace || context.settings.workspaceRoot,
      prompt: input.text,
      limit: 8
    })
    if (records.length === 0) return input
    const memoryText = renderSharedMemory(records)
    return {
      ...input,
      text: `${memoryText}\n\n${input.text}`,
      displayText: input.displayText ?? input.text
    }
  }

  private withSharedContextState(
    runtimeId: AgentRuntimeId,
    input: AgentRuntimeTurnStartInput
  ): AgentRuntimeTurnStartInput {
    const service = this.options.services?.contextState
    const threadId = input.threadId.trim()
    if (!service || !threadId) return input
    const state = service.peek({ runtimeId, threadId })
    const contextText = renderSharedContextState(state)
    if (!contextText) return input
    return {
      ...input,
      text: `${contextText}\n\n${input.text}`,
      displayText: input.displayText ?? input.text
    }
  }

  private withWorkspaceRelativeFileReferences(
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeTurnStartInput
  ): AgentRuntimeTurnStartInput {
    const references = input.fileReferences
    if (!references?.length) return input
    const workspaceRoot = input.workspace?.trim() || context.settings.workspaceRoot?.trim() || ''
    const safeReferences = references
      .map((reference) => normalizeRuntimeFileReference(reference, workspaceRoot))
      .filter((reference): reference is AgentRuntimeFileReference => reference != null)
    return {
      ...input,
      ...(safeReferences.length ? { fileReferences: safeReferences } : { fileReferences: undefined })
    }
  }

  private async resolve(runtimeId?: AgentRuntimeId): Promise<{
    adapter: AgentRuntimeAdapter
    context: AgentRuntimeAdapterContext
  }> {
    const settings = await this.options.settings()
    const selected = runtimeId
      ? normalizeAgentRuntimeId(runtimeId)
      : getActiveAgentRuntime(settings)
    const adapter = this.adapters.get(selected)
    if (!adapter) throw new Error(`No AgentRuntimeAdapter registered for runtime: ${selected}`)
    return { adapter, context: { settings } }
  }

  private enqueueThreadTurnStart(
    adapter: AgentRuntimeAdapter,
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeTurnStartInput
  ): Promise<AgentRuntimeTurnHandle> {
    const key = `${adapter.id}:${input.threadId.trim()}`
    if (!input.threadId.trim()) {
      return adapter.startTurn(context, input).then((handle) => {
        this.rememberTurnGovernanceProfile(adapter.id, input, handle)
        return handle
      })
    }
    const previous = this.turnQueues.get(key) ?? Promise.resolve()
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        await waitForThreadIdle(adapter, context, input)
        const handle = await adapter.startTurn(context, input)
        this.rememberTurnGovernanceProfile(adapter.id, input, handle)
        return handle
      })
    this.turnQueues.set(key, task)
    void task
      .finally(() => {
        if (this.turnQueues.get(key) === task) this.turnQueues.delete(key)
      })
      .catch(() => undefined)
    return task
  }

  private async publishSyntheticEvent(
    adapter: AgentRuntimeAdapter,
    context: AgentRuntimeAdapterContext,
    event: AgentRuntimeEvent
  ): Promise<AgentRuntimeEvent | null> {
    if (!adapter.publishSyntheticEvent) return null
    return adapter.publishSyntheticEvent(context, event)
  }

  private async recordNoopCompaction(
    adapter: AgentRuntimeAdapter,
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeThreadCompactInput
  ): Promise<void> {
    const service = this.options.services?.contextState
    if (!service) throw unsupported(adapter.id, 'shared context compaction')
    const state = await this.recordSharedNoopCompaction(adapter, context, {
      threadId: input.threadId,
      triggerReason: input.reason?.trim() || 'manual noop compaction',
      force: true
    })
    if (state) await this.publishCompactionStateEvent(adapter, context, state, false)
  }

  private async autoCompactThreadIfNeeded(
    adapter: AgentRuntimeAdapter,
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeTurnStartInput
  ): Promise<void> {
    const threadId = input.threadId.trim()
    const service = this.options.services?.contextState
    if (!service || !threadId) return
    let capabilities: AgentRuntimeCapabilities
    try {
      capabilities = await adapter.capabilities(context)
    } catch {
      return
    }
    if (capabilities.controls.compact !== 'noop') return
    const state = await this.recordSharedNoopCompaction(adapter, context, {
      threadId,
      force: false
    }).catch(() => undefined)
    if (state) await this.publishCompactionStateEvent(adapter, context, state, true)
  }

  private async recordSharedNoopCompaction(
    adapter: AgentRuntimeAdapter,
    context: AgentRuntimeAdapterContext,
    input: {
      threadId: string
      triggerReason?: string
      force: boolean
    }
  ): Promise<AgentRuntimeContextState | null> {
    const service = this.options.services?.contextState
    if (!service) throw unsupported(adapter.id, 'shared context compaction')
    const detail = await adapter.readThread(context, {
      runtimeId: adapter.id,
      threadId: input.threadId
    })
    const items = threadDetailItems(detail)
    const compactor = new AgentRuntimeContextCompactor({
      softThreshold: context.settings.agents.kun.contextCompaction.defaultSoftThreshold,
      hardThreshold: context.settings.agents.kun.contextCompaction.defaultHardThreshold
    })
    const plan = compactor.planCompaction(items)
    if (!plan && !input.force) return null
    const triggerReason = input.triggerReason ?? plan?.reason ?? 'manual noop compaction'
    const modelSummary = await this.modelCompactionSummary(context, adapter.id, input.threadId, items)
    const result = compactor.compact({
      threadId: input.threadId,
      turnId: `manual-${input.threadId}`,
      history: items,
      mode: plan?.mode ?? 'force',
      keepRecent: plan?.keepRecent ?? 1,
      reason: plan?.reason ?? triggerReason,
      summaryOverride: modelSummary.summary,
      budgetTokens: context.settings.agents.kun.contextCompaction.summaryMaxTokens,
      pinnedConstraints: pinnedConstraintsFromItems(items)
    })
    const summary = result.summaryItem.summary
    return service.recordCompaction({
      runtimeId: adapter.id,
      threadId: input.threadId,
      summary,
      summarySource: modelSummary.summary ? 'model' : 'heuristic',
      triggerReason: modelSummary.fallback
        ? `${triggerReason}; model_summary_fallback`
        : triggerReason,
      rawHistoryItems: items.length,
      effectiveHistoryItems: result.effectiveItems.length,
      estimatedTokens: compactor.estimate(result.effectiveItems),
      replacedTokens: result.replacedTokens,
      sourceDigest: result.sourceDigest,
      digestMarker: result.digestMarker,
      sourceItemIds: result.sourceItemIds
    })
  }

  private async publishCompactionStateEvent(
    adapter: AgentRuntimeAdapter,
    context: AgentRuntimeAdapterContext,
    state: AgentRuntimeContextState,
    auto: boolean
  ): Promise<void> {
    const summary = state.summary?.trim()
    if (!summary) return
    try {
      await this.publishSyntheticEvent(adapter, context, {
        kind: 'compaction_event',
        runtimeId: adapter.id,
        threadId: state.threadId,
        itemId: `shared-compaction-${state.sourceDigest ?? state.updatedAt}`,
        status: 'success',
        summary,
        detail: state.triggerReason,
        auto,
        messagesBefore: state.rawHistoryItems,
        messagesAfter: state.effectiveHistoryItems,
        replacedTokens: state.replacedTokens,
        sourceDigest: state.sourceDigest,
        digestMarker: state.digestMarker,
        sourceItemIds: state.sourceItemIds,
        createdAt: state.updatedAt
      })
    } catch {
      // Synthetic UI notification is best-effort; shared context state is already recorded.
    }
  }

  private async modelCompactionSummary(
    context: AgentRuntimeAdapterContext,
    runtimeId: AgentRuntimeId,
    threadId: string,
    items: AgentRuntimeItem[]
  ): Promise<{ summary?: string; fallback?: boolean }> {
    const compaction = context.settings.agents.kun.contextCompaction
    if (compaction.summaryMode !== 'model') return {}
    const router = resolveRuntimeModelRouterSettings(context.settings)
    if (!router.apiKey) return { fallback: true }
    const input = renderModelCompactionInput(items, compaction.summaryInputMaxBytes)
    if (!input) return {}
    try {
      const response = await fetch(buildModelRouterResponsesUrl(router.baseUrl), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${router.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: router.model,
          input,
          max_tokens: compaction.summaryMaxTokens,
          metadata: {
            runtimeId,
            threadId,
            operation: 'context_compaction_summary'
          }
        }),
        signal: AbortSignal.timeout(compaction.summaryTimeoutMs)
      })
      const bodyText = await response.text()
      if (!response.ok) return { fallback: true }
      const parsed = JSON.parse(bodyText) as Record<string, unknown>
      const summary = extractResponsesOutputText(parsed).trim()
      return summary ? { summary } : { fallback: true }
    } catch {
      return { fallback: true }
    }
  }

  private rememberTurnGovernanceProfile(
    runtimeId: AgentRuntimeId,
    input: AgentRuntimeTurnStartInput,
    handle: AgentRuntimeTurnHandle
  ): void {
    const profile = input.governanceProfile
    const threadId = (handle.threadId || input.threadId).trim()
    const turnId = handle.turnId.trim()
    if (!profile || !threadId || !turnId) return
    this.turnGovernanceProfiles.set(turnGovernanceKey(runtimeId, threadId, turnId), profile)
  }

  private rememberTurnWorkspace(
    runtimeId: AgentRuntimeId,
    input: AgentRuntimeTurnStartInput,
    handle: AgentRuntimeTurnHandle
  ): void {
    const workspace = input.workspace?.trim()
    const threadId = (handle.threadId || input.threadId).trim()
    const turnId = handle.turnId.trim()
    if (!workspace || !threadId || !turnId) return
    this.turnWorkspaces.set(turnGovernanceKey(runtimeId, threadId, turnId), workspace)
  }

  private createPreTurnCheckpoint(
    runtimeId: AgentRuntimeId,
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeTurnStartInput
  ): void {
    const service = this.options.services?.gitCheckpoints
    const workspaceRoot = input.workspace?.trim() || context.settings.workspaceRoot?.trim()
    if (!service || !workspaceRoot || !input.threadId.trim()) return
    void service.create({
      runtimeId,
      threadId: input.threadId.trim(),
      workspaceRoot
    }).catch(() => undefined)
  }

  private createPostTurnCheckpoint(runtimeId: AgentRuntimeId, event: AgentRuntimeEvent): void {
    if (event.kind !== 'turn_lifecycle') return
    if (event.state !== 'completed' && event.state !== 'failed' && event.state !== 'aborted') return
    const turnId = event.turnId?.trim()
    if (!turnId) return
    const key = turnGovernanceKey(runtimeId, event.threadId, turnId)
    if (this.postTurnCheckpoints.has(key)) return
    const workspaceRoot = this.turnWorkspaces.get(key)
    const service = this.options.services?.gitCheckpoints
    if (!workspaceRoot || !service) return
    this.postTurnCheckpoints.add(key)
    void service.create({
      runtimeId,
      threadId: event.threadId,
      turnId,
      workspaceRoot
    }).catch(() => undefined)
  }

  private governanceProfileForEvent(
    runtimeId: AgentRuntimeId,
    event: AgentRuntimeEvent
  ): AgentRuntimeGovernanceProfile | undefined {
    const threadId = event.threadId.trim()
    const turnId = event.turnId?.trim()
    if (!threadId || !turnId) return undefined
    return this.turnGovernanceProfiles.get(turnGovernanceKey(runtimeId, threadId, turnId))
  }

  private feedEvidenceDagForCompletedTurn(
    adapter: AgentRuntimeAdapter,
    context: AgentRuntimeAdapterContext,
    event: AgentRuntimeEvent
  ): void {
    if (event.kind !== 'turn_lifecycle' || event.state !== 'completed') return
    if (!isEvidenceDagFeedEnabled()) return
    const threadId = event.threadId.trim()
    const turnId = event.turnId?.trim()
    if (!threadId || !turnId) return

    const key = turnGovernanceKey(adapter.id, threadId, turnId)
    if (this.evidenceDagFedTurns.has(key)) return
    this.evidenceDagFedTurns.add(key)

    void (async () => {
      try {
        const detail = await adapter.readThread(context, {
          runtimeId: adapter.id,
          threadId
        })
        await feedEvidenceDag({
          runtimeId: adapter.id,
          threadId,
          items: completedTurnItems(detail, turnId)
        })
      } catch {
        // fail-open: Evidence-DAG is an observability side channel.
      }
    })()
  }
}

async function waitForThreadIdle(
  adapter: AgentRuntimeAdapter,
  context: AgentRuntimeAdapterContext,
  input: AgentRuntimeTurnStartInput
): Promise<void> {
  const deadline = Date.now() + THREAD_TURN_QUEUE_TIMEOUT_MS
  while (Date.now() < deadline) {
    let active = false
    try {
      const detail = await adapter.readThread(context, {
        runtimeId: input.runtimeId,
        threadId: input.threadId
      })
      active = threadHasActiveTurn(detail)
    } catch {
      return
    }
    if (!active) return
    await sleep(THREAD_TURN_QUEUE_POLL_MS)
  }
  throw new Error(`Timed out waiting for active turn to finish for thread ${input.threadId}.`)
}

function threadHasActiveTurn(detail: { turns?: Array<{ status?: string }> }): boolean {
  const turns = Array.isArray(detail.turns) ? detail.turns : []
  return turns.some((turn) => isActiveTurnStatus(turn.status))
}

function isActiveTurnStatus(status: string | undefined): boolean {
  return status === 'queued' || status === 'in_progress' || status === 'started' || status === 'running'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function threadDetailItems(detail: AgentRuntimeThreadDetail): AgentRuntimeItem[] {
  if (Array.isArray(detail.items) && detail.items.length > 0) return detail.items
  return (detail.turns ?? []).flatMap((turn) => turn.items ?? [])
}

function pinnedConstraintsFromItems(items: AgentRuntimeItem[]): string[] {
  const pins = new Set<string>()
  for (const item of items) {
    if (item.kind === 'system') {
      const text = (item.text ?? item.summary ?? item.detail ?? '').trim()
      if (text) pins.add(text.slice(0, 800))
      continue
    }
    if (item.kind !== 'user_message' && item.kind !== 'assistant_message' && item.kind !== 'compaction') continue
    const text = (item.text ?? item.summary ?? item.detail ?? '').trim()
    for (const line of text.split(/\r?\n/u)) {
      const trimmed = line.trim()
      if (/^(Active Skill:|Skill Pin:|Pinned Skill:|Constraint:)/iu.test(trimmed)) {
        pins.add(trimmed.slice(0, 800))
      }
    }
  }
  return [...pins]
}

function heuristicCompactionSummary(items: AgentRuntimeItem[]): string {
  const lines = items
    .filter((item) => item.kind === 'user_message' || item.kind === 'assistant_message' || item.kind === 'tool')
    .slice(-12)
    .map((item) => {
      const label = item.kind === 'user_message'
        ? 'User'
        : item.kind === 'assistant_message'
          ? 'Assistant'
          : 'Tool'
      const text = (item.text ?? item.summary ?? item.detail ?? '').trim().replace(/\s+/gu, ' ')
      return text ? `- ${label}: ${text.slice(0, 240)}` : ''
    })
    .filter(Boolean)
  if (lines.length === 0) return ''
  return [
    'Heuristic compacted context summary:',
    ...lines
  ].join('\n')
}

function renderModelCompactionInput(items: AgentRuntimeItem[], maxBytes: number): string {
  const lines = items
    .filter((item) => item.kind === 'user_message' || item.kind === 'assistant_message' || item.kind === 'tool')
    .map((item) => {
      const label = item.kind === 'user_message'
        ? 'User'
        : item.kind === 'assistant_message'
          ? 'Assistant'
          : 'Tool'
      const text = (item.text ?? item.summary ?? item.detail ?? '').trim().replace(/\s+/gu, ' ')
      return text ? `${label}: ${text}` : ''
    })
    .filter(Boolean)
  if (lines.length === 0) return ''
  return truncateUtf8Text([
    'Summarize this runtime conversation history for context compaction.',
    'Preserve active user goals, hard constraints, decisions, changed files, unresolved risks, and concrete next steps.',
    'Return only the compact summary.',
    '',
    ...lines
  ].join('\n'), maxBytes)
}

function truncateUtf8Text(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let bytes = 0
  let output = ''
  for (const char of text) {
    const size = Buffer.byteLength(char, 'utf8')
    if (bytes + size > maxBytes) break
    output += char
    bytes += size
  }
  return output
}

function extractResponsesOutputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === 'string') return payload.output_text
  const output = Array.isArray(payload.output) ? payload.output : []
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.text === 'string') {
      parts.push(record.text)
      continue
    }
    const content = Array.isArray(record.content) ? record.content : []
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const contentRecord = part as Record<string, unknown>
      if (typeof contentRecord.text === 'string') parts.push(contentRecord.text)
      if (typeof contentRecord.output_text === 'string') parts.push(contentRecord.output_text)
    }
  }
  return parts.join('\n')
}

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalRuntimeId(value: unknown): AgentRuntimeId | undefined {
  return value === 'kun' || value === 'codex' || value === 'claude' ? value : undefined
}

function requiredString(
  payload: Record<string, unknown>,
  key: string,
  fallback?: string
): string {
  const value = optionalString(payload[key]) ?? optionalString(fallback)
  if (!value) throw new Error(`Agent runtime auxiliary operation requires payload.${key}.`)
  return value
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function arrayOfStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
  return values.length ? values : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeRuntimeFileReference(
  reference: AgentRuntimeFileReference,
  workspaceRoot: string
): AgentRuntimeFileReference | null {
  const relativePath = resolveSafeRuntimeReferencePath(reference, workspaceRoot)
  if (!relativePath) return null
  const name = reference.name.trim() || path.posix.basename(relativePath)
  const delivery = reference.delivery ?? (reference.modelRouterObject ? 'model_router_object' : 'inline_context')
  return {
    ...reference,
    path: relativePath,
    relativePath,
    name,
    delivery
  }
}

function resolveSafeRuntimeReferencePath(
  reference: AgentRuntimeFileReference,
  workspaceRoot: string
): string | null {
  const candidates = [
    reference.relativePath,
    workspaceRelativePath(reference.path, workspaceRoot),
    reference.path
  ]
  for (const candidate of candidates) {
    const relativePath = normalizeSafeRelativePath(candidate)
    if (relativePath) return relativePath
  }
  return null
}

function workspaceRelativePath(candidatePath: string, workspaceRoot: string): string {
  const candidate = normalizePathLike(candidatePath)
  const root = trimTrailingSlash(normalizePathLike(workspaceRoot))
  if (!candidate || !root) return ''
  const fold = isWindowsAbsolutePath(candidate) || isWindowsAbsolutePath(root)
  const comparableCandidate = fold ? candidate.toLowerCase() : candidate
  const comparableRoot = fold ? root.toLowerCase() : root
  if (comparableCandidate === comparableRoot) return ''
  if (!comparableCandidate.startsWith(`${comparableRoot}/`)) return ''
  return candidate.slice(root.length + 1)
}

function normalizeSafeRelativePath(value: string): string | null {
  const normalized = normalizePathLike(value).replace(/^\.\//u, '')
  if (!normalized || normalized === '.' || normalized === '..') return null
  if (normalized.includes('\0')) return null
  if (isAbsoluteLikePath(normalized)) return null
  if (normalized.startsWith('../')) return null
  return normalized
}

function normalizePathLike(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/').replace(/\/+/gu, '/')
  return path.posix.normalize(normalized)
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/gu, '')
}

function isAbsoluteLikePath(value: string): boolean {
  return value.startsWith('/') || isWindowsAbsolutePath(value)
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:\//u.test(value)
}

function renderSharedMemory(records: AgentRuntimeMemoryRecord[]): string {
  const lines = records
    .filter((record) => !record.disabled && !record.deleted)
    .slice(0, 8)
    .map((record) => {
      const scope = record.scope === 'user'
        ? 'user'
        : record.scope === 'project'
          ? 'project'
          : 'workspace'
      const tags = record.tags.length ? ` (${record.tags.join(', ')})` : ''
      return `- [${scope}]${tags} ${record.text.trim()}`
    })
  if (lines.length === 0) return ''
  return [
    'Shared memory relevant to this turn:',
    ...lines,
    'Use these memories only when they are relevant, and ignore any that conflict with the current user request.'
  ].join('\n')
}

function renderSharedContextState(state: AgentRuntimeContextState | null): string {
  const summary = state?.summary?.trim()
  if (!state || !summary || state.summarySource === 'none') return ''
  const lines = [
    'Shared compacted context summary for this thread:',
    summary
  ]
  const metadata: string[] = []
  if (state.summarySource) metadata.push(`source=${state.summarySource}`)
  if (state.rawHistoryItems > 0) metadata.push(`raw_items=${state.rawHistoryItems}`)
  if (state.effectiveHistoryItems > 0) metadata.push(`effective_items=${state.effectiveHistoryItems}`)
  if (state.replacedTokens !== undefined) metadata.push(`replaced_tokens=${state.replacedTokens}`)
  if (state.sourceDigest) metadata.push(`source_digest=${state.sourceDigest}`)
  if (metadata.length > 0) {
    lines.push(`Compaction metadata: ${metadata.join('; ')}`)
  }
  lines.push('Use this summary as earlier conversation context; the current user request below remains authoritative.')
  return lines.join('\n')
}

function buildModelRouterResponsesUrl(baseUrl: string): string {
  const path = 'responses'
  const normalized = baseUrl.trim().replace(/\/+$/u, '')
  if (!normalized) return ''
  if (normalized.endsWith(`/${path}`)) return normalized
  const base = stripKnownModelRouterEndpointPath(normalized)
  return base.endsWith('/v1') ? `${base}/${path}` : `${base}/v1/${path}`
}

function stripKnownModelRouterEndpointPath(baseUrl: string): string {
  const lower = baseUrl.toLowerCase()
  for (const path of ['chat/completions', 'responses', 'messages']) {
    if (lower.endsWith(`/${path}`)) {
      return baseUrl.slice(0, -path.length).replace(/\/+$/u, '')
    }
  }
  return baseUrl
}

function normalizeAdapters(
  adapters: AgentRuntimeHostOptions['adapters']
): Map<AgentRuntimeId, AgentRuntimeAdapter> {
  const entries = Array.isArray(adapters)
    ? adapters.map((adapter) => [adapter.id, adapter] as const)
    : Object.entries(adapters) as Array<[AgentRuntimeId, AgentRuntimeAdapter]>
  return new Map(entries)
}

function unsupported(runtimeId: AgentRuntimeId, control: string): Error {
  return new Error(`${runtimeId} AgentRuntimeAdapter does not support ${control}.`)
}

function turnGovernanceKey(runtimeId: AgentRuntimeId, threadId: string, turnId: string): string {
  return `${runtimeId}:${threadId}:${turnId}`
}
