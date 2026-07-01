import type { AppSettingsV1 } from '../shared/app-settings'
import {
  buildScheduleMcpArgs,
  buildScheduleLocalRuntimeMcpServerConfig,
  scheduleMcpEnabledTools,
  GUI_SCHEDULE_INTERNAL_SECRET_ENV,
  GUI_SCHEDULE_MCP_DESCRIPTOR,
  GUI_SCHEDULE_MCP_SERVER_NAME,
  GUI_SCHEDULE_MCP_TIMEOUT_MS,
  resolveScheduleMcpCommand,
  type ScheduleMcpLaunchConfig
} from './schedule-mcp-config'
import {
  buildComputerUseClaudeCodeMcpServerConfig,
  buildComputerUseLocalRuntimeMcpServerConfig,
  buildComputerUseRuntimeMcpServerConfig,
  GUI_COMPUTER_USE_MCP_DESCRIPTOR,
  GUI_COMPUTER_USE_MCP_SERVER_NAME,
  type ComputerUseMcpLaunchConfig
} from './computer-use-mcp-config'
import {
  buildPaperRadarMcpArgs,
  buildPaperRadarLocalRuntimeMcpServerConfig,
  GUI_PAPER_RADAR_MCP_DESCRIPTOR,
  GUI_PAPER_RADAR_MCP_SERVER_NAME,
  PAPER_RADAR_MCP_TIMEOUT_MS,
  paperRadarMcpEnabledTools,
  paperRadarMcpEnv,
  resolvePaperRadarMcpCommand,
  type PaperRadarMcpLaunchConfig
} from './paper-radar-mcp-config'
import {
  buildResearchSearchMcpArgs,
  buildResearchSearchLocalRuntimeMcpServerConfig,
  GUI_RESEARCH_MCP_DESCRIPTOR,
  GUI_RESEARCH_MCP_SERVER_NAME,
  RESEARCH_SEARCH_MCP_TIMEOUT_MS,
  researchSearchMcpEnabledTools,
  researchSearchMcpEnv,
  resolveResearchSearchMcpCommand,
  type ResearchSearchMcpLaunchConfig
} from './research-search-mcp-config'
import {
  buildRuntimeInspectorMcpArgs,
  buildRuntimeInspectorLocalRuntimeMcpServerConfig,
  GUI_RUNTIME_INSPECTOR_MCP_DESCRIPTOR,
  GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME,
  resolveRuntimeInspectorMcpCommand,
  RUNTIME_INSPECTOR_MCP_TIMEOUT_MS,
  runtimeInspectorMcpEnabledTools,
  runtimeInspectorMcpEnv,
  type RuntimeInspectorMcpLaunchConfig
} from './runtime-inspector-mcp-config'
import {
  buildWorkspaceIntelMcpArgs,
  buildWorkspaceIntelLocalRuntimeMcpServerConfig,
  GUI_WORKSPACE_INTEL_MCP_DESCRIPTOR,
  GUI_WORKSPACE_INTEL_MCP_SERVER_NAME,
  resolveWorkspaceIntelMcpCommand,
  WORKSPACE_INTEL_MCP_TIMEOUT_MS,
  workspaceIntelMcpEnabledTools,
  workspaceIntelMcpEnv,
  type WorkspaceIntelMcpLaunchConfig
} from './workspace-intel-mcp-config'
import {
  buildRemoteExecutorMcpArgs,
  buildRemoteExecutorLocalRuntimeMcpServerConfig,
  GUI_REMOTE_EXECUTOR_MCP_DESCRIPTOR,
  GUI_REMOTE_EXECUTOR_MCP_SERVER_NAME,
  GUI_REMOTE_EXECUTOR_MCP_TIMEOUT_MS,
  remoteExecutorMcpEnabledTools,
  remoteExecutorMcpEnv,
  resolveRemoteExecutorMcpCommand,
  type RemoteExecutorMcpLaunchConfig
} from './remote-executor-mcp-config'
import {
  buildWorkflowMcpArgs,
  buildWorkflowLocalRuntimeMcpServerConfig,
  GUI_WORKFLOW_INTERNAL_SECRET_ENV,
  GUI_WORKFLOW_MCP_DESCRIPTOR,
  GUI_WORKFLOW_MCP_SERVER_NAME,
  resolveWorkflowMcpCommand,
  WORKFLOW_MCP_TIMEOUT_MS,
  workflowMcpEnabledTools,
  workflowMcpEnv,
  type WorkflowMcpLaunchConfig
} from './workflow-mcp-config'
import {
  buildWriteAssistMcpArgs,
  buildWriteAssistLocalRuntimeMcpServerConfig,
  GUI_WRITE_ASSIST_MCP_DESCRIPTOR,
  GUI_WRITE_ASSIST_MCP_SERVER_NAME,
  resolveWriteAssistMcpCommand,
  WRITE_ASSIST_MCP_TIMEOUT_MS,
  writeAssistMcpEnabledTools,
  writeAssistMcpEnv,
  type WriteAssistMcpLaunchConfig
} from './write-assist-mcp-config'
import {
  buildScientificSkillsMcpArgs,
  buildScientificSkillsLocalRuntimeMcpServerConfig,
  buildScientificSkillsMcpJsonServerConfig,
  GUI_SCIENTIFIC_SKILLS_MCP_DESCRIPTOR,
  GUI_SCIENTIFIC_SKILLS_MCP_SERVER_NAME,
  GUI_SCIENTIFIC_SKILLS_MCP_TIMEOUT_MS,
  resolveScientificSkillsMcpCommand,
  scientificSkillsMcpEnabledTools,
  type ScientificSkillsMcpLaunchConfig
} from './scientific-skills-mcp-config'
import {
  buildScientificPlottingMcpArgs,
  buildScientificPlottingLocalRuntimeMcpServerConfig,
  buildScientificPlottingMcpJsonServerConfig,
  GUI_SCIENTIFIC_PLOTTING_MCP_DESCRIPTOR,
  GUI_SCIENTIFIC_PLOTTING_MCP_SERVER_NAME,
  GUI_SCIENTIFIC_PLOTTING_MCP_TIMEOUT_MS,
  resolveScientificPlottingMcpCommand,
  scientificPlottingMcpEnabledTools,
  type ScientificPlottingMcpLaunchConfig
} from './scientific-plotting-mcp-config'
import {
  buildImageGenerationMcpArgs,
  buildImageGenerationLocalRuntimeMcpServerConfig,
  buildImageGenerationMcpJsonServerConfig,
  GUI_IMAGE_GENERATION_MCP_DESCRIPTOR,
  GUI_IMAGE_GENERATION_MCP_SERVER_NAME,
  GUI_IMAGE_GENERATION_MCP_TIMEOUT_MS,
  resolveImageGenerationMcpCommand,
  imageGenerationMcpEnabledTools,
  type ImageGenerationMcpLaunchConfig
} from './image-generation-mcp-config'
import {
  buildPptMasterMcpArgs,
  buildPptMasterLocalRuntimeMcpServerConfig,
  buildPptMasterMcpJsonServerConfig,
  GUI_PPT_MASTER_MCP_DESCRIPTOR,
  GUI_PPT_MASTER_MCP_SERVER_NAME,
  GUI_PPT_MASTER_MCP_TIMEOUT_MS,
  resolvePptMasterMcpCommand,
  pptMasterMcpEnabledTools,
  type PptMasterMcpLaunchConfig
} from './ppt-master-mcp-config'
import {
  buildSciforgeCanvasMcpArgs,
  buildSciforgeCanvasLocalRuntimeMcpServerConfig,
  buildSciforgeCanvasMcpJsonServerConfig,
  GUI_SCIFORGE_CANVAS_MCP_DESCRIPTOR,
  GUI_SCIFORGE_CANVAS_MCP_SERVER_NAME,
  GUI_SCIFORGE_CANVAS_MCP_TIMEOUT_MS,
  resolveSciforgeCanvasMcpCommand,
  sciforgeCanvasMcpEnabledTools,
  type SciforgeCanvasMcpLaunchConfig
} from './sciforge-canvas-mcp-config'
import {
  managedGuiMcpNames,
  resolveLocalRuntimeMcpJsonPath,
  syncExternalLocalRuntimeMcpJson,
  type ManagedGuiMcpDescriptor
} from './managed-gui-mcp-config'
import { internalSecretEnv } from './internal-http-secret'

export type GuiMcpRuntimeServerConfig = {
  id: string
  command: string
  args?: string[]
  env?: Record<string, string>
  timeoutMs?: number
  enabledTools?: string[]
}

export type GuiMcpRegistryInput = {
  settings?: AppSettingsV1
  scheduleMcp?: {
    settings?: AppSettingsV1
    launch: ScheduleMcpLaunchConfig
  }
  researchMcp?: {
    launch: ResearchSearchMcpLaunchConfig
  }
  workflowMcp?: {
    settings?: AppSettingsV1
    launch: WorkflowMcpLaunchConfig
  }
  workspaceIntelMcp?: {
    settings?: AppSettingsV1
    launch: WorkspaceIntelMcpLaunchConfig
  }
  remoteExecutorMcp?: {
    settings?: AppSettingsV1
    launch: RemoteExecutorMcpLaunchConfig
    enabled?: boolean
  }
  paperRadarMcp?: {
    launch: PaperRadarMcpLaunchConfig
  }
  writeAssistMcp?: {
    settings?: AppSettingsV1
    launch: WriteAssistMcpLaunchConfig
  }
  runtimeInspectorMcp?: {
    settings?: AppSettingsV1
    launch: RuntimeInspectorMcpLaunchConfig
  }
  computerUseMcp?: {
    launch: ComputerUseMcpLaunchConfig
    enabled?: boolean
  }
  scientificSkillsMcp?: {
    settings?: AppSettingsV1
    launch: ScientificSkillsMcpLaunchConfig
  }
  scientificPlottingMcp?: {
    settings?: AppSettingsV1
    launch: ScientificPlottingMcpLaunchConfig
  }
  imageGenerationMcp?: {
    settings?: AppSettingsV1
    launch: ImageGenerationMcpLaunchConfig
  }
  pptMasterMcp?: {
    settings?: AppSettingsV1
    launch: PptMasterMcpLaunchConfig
  }
  sciforgeCanvasMcp?: {
    settings?: AppSettingsV1
    launch: SciforgeCanvasMcpLaunchConfig
  }
}

type LocalRuntimeServerBuilder = (existing: unknown) => Record<string, unknown>

export const GUI_MCP_DESCRIPTORS: readonly ManagedGuiMcpDescriptor[] = [
  GUI_SCHEDULE_MCP_DESCRIPTOR,
  GUI_RESEARCH_MCP_DESCRIPTOR,
  GUI_WORKFLOW_MCP_DESCRIPTOR,
  GUI_WORKSPACE_INTEL_MCP_DESCRIPTOR,
  GUI_REMOTE_EXECUTOR_MCP_DESCRIPTOR,
  GUI_PAPER_RADAR_MCP_DESCRIPTOR,
  GUI_WRITE_ASSIST_MCP_DESCRIPTOR,
  GUI_RUNTIME_INSPECTOR_MCP_DESCRIPTOR,
  GUI_SCIENTIFIC_SKILLS_MCP_DESCRIPTOR,
  GUI_SCIENTIFIC_PLOTTING_MCP_DESCRIPTOR,
  GUI_IMAGE_GENERATION_MCP_DESCRIPTOR,
  GUI_PPT_MASTER_MCP_DESCRIPTOR,
  GUI_SCIFORGE_CANVAS_MCP_DESCRIPTOR,
  GUI_COMPUTER_USE_MCP_DESCRIPTOR
] as const

export function managedGuiMcpServerNames(): string[] {
  return GUI_MCP_DESCRIPTORS.flatMap((descriptor) => managedGuiMcpNames(descriptor))
}

export async function syncExternalManagedGuiMcpConfig(path = resolveLocalRuntimeMcpJsonPath()): Promise<void> {
  await syncExternalLocalRuntimeMcpJson(path, managedGuiMcpServerNames())
}

export function buildLocalRuntimeManagedGuiMcpServers(
  input: GuiMcpRegistryInput,
  existingServers: Record<string, unknown> = {}
): Record<string, unknown> {
  const servers: Record<string, unknown> = {}
  for (const [serverName, build] of localRuntimeServerBuilders(input)) {
    servers[serverName] = build(existingServers[serverName])
  }
  return servers
}

export function hasEnabledManagedGuiMcpServer(servers: Record<string, unknown>): boolean {
  return Object.values(servers).some((server) => objectValue(server).enabled !== false)
}

export function buildCodexManagedGuiMcpServers(
  input: GuiMcpRegistryInput,
  existingServers: readonly GuiMcpRuntimeServerConfig[] = []
): GuiMcpRuntimeServerConfig[] {
  const servers = new Map<string, GuiMcpRuntimeServerConfig>()
  for (const server of existingServers) {
    servers.set(server.id, server)
  }
  for (const server of codexServerConfigs(input)) {
    if (!servers.has(server.id)) servers.set(server.id, server)
  }
  return [...servers.values()]
}

export function buildClaudeCodeManagedGuiMcpServers(
  input: Pick<GuiMcpRegistryInput, 'computerUseMcp'>
): Record<string, {
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
  timeout: number
  alwaysLoad: true
}> {
  const launch = input.computerUseMcp?.launch
  if (!launch || input.computerUseMcp?.enabled === false) return {}
  return {
    [GUI_COMPUTER_USE_MCP_SERVER_NAME]: buildComputerUseClaudeCodeMcpServerConfig(launch)
  }
}

function localRuntimeServerBuilders(input: GuiMcpRegistryInput): Array<[string, LocalRuntimeServerBuilder]> {
  const builders: Array<[string, LocalRuntimeServerBuilder]> = []
  const settings = input.settings
  const scheduleSettings = input.scheduleMcp?.settings ?? settings
  if (input.scheduleMcp && scheduleSettings) {
    builders.push([
      GUI_SCHEDULE_MCP_SERVER_NAME,
      (existing) => buildScheduleLocalRuntimeMcpServerConfig(scheduleSettings, input.scheduleMcp!.launch, existing)
    ])
  }
  if (input.researchMcp) {
    builders.push([
      GUI_RESEARCH_MCP_SERVER_NAME,
      (existing) => buildResearchSearchLocalRuntimeMcpServerConfig(input.researchMcp!.launch, existing)
    ])
  }
  const workflowSettings = input.workflowMcp?.settings ?? settings
  if (input.workflowMcp && workflowSettings) {
    builders.push([
      GUI_WORKFLOW_MCP_SERVER_NAME,
      (existing) => buildWorkflowLocalRuntimeMcpServerConfig(workflowSettings, input.workflowMcp!.launch, existing)
    ])
  }
  const workspaceIntelSettings = input.workspaceIntelMcp?.settings ?? settings
  if (input.workspaceIntelMcp && workspaceIntelSettings) {
    builders.push([
      GUI_WORKSPACE_INTEL_MCP_SERVER_NAME,
      (existing) => buildWorkspaceIntelLocalRuntimeMcpServerConfig(
        workspaceIntelSettings,
        input.workspaceIntelMcp!.launch,
        existing
      )
    ])
  }
  if (input.remoteExecutorMcp) {
    const remoteExecutorSettings = input.remoteExecutorMcp.settings ?? settings
    builders.push([
      GUI_REMOTE_EXECUTOR_MCP_SERVER_NAME,
      (existing) => buildRemoteExecutorLocalRuntimeMcpServerConfig(
        input.remoteExecutorMcp!.launch,
        existing,
        input.remoteExecutorMcp!.enabled !== false,
        remoteExecutorSettings
      )
    ])
  }
  if (input.paperRadarMcp) {
    builders.push([
      GUI_PAPER_RADAR_MCP_SERVER_NAME,
      (existing) => buildPaperRadarLocalRuntimeMcpServerConfig(input.paperRadarMcp!.launch, existing)
    ])
  }
  const writeAssistSettings = input.writeAssistMcp?.settings ?? settings
  if (input.writeAssistMcp && writeAssistSettings) {
    builders.push([
      GUI_WRITE_ASSIST_MCP_SERVER_NAME,
      (existing) => buildWriteAssistLocalRuntimeMcpServerConfig(writeAssistSettings, input.writeAssistMcp!.launch, existing)
    ])
  }
  const runtimeInspectorSettings = input.runtimeInspectorMcp?.settings ?? settings
  if (input.runtimeInspectorMcp && runtimeInspectorSettings) {
    builders.push([
      GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME,
      (existing) => buildRuntimeInspectorLocalRuntimeMcpServerConfig(
        runtimeInspectorSettings,
        input.runtimeInspectorMcp!.launch,
        existing
      )
    ])
  }
  const scientificSkillsSettings = input.scientificSkillsMcp?.settings ?? settings
  if (input.scientificSkillsMcp && scientificSkillsSettings) {
    builders.push([
      GUI_SCIENTIFIC_SKILLS_MCP_SERVER_NAME,
      (existing) => buildScientificSkillsLocalRuntimeMcpServerConfig(
        input.scientificSkillsMcp!.launch,
        existing,
        scientificSkillsSettings.workspaceRoot
      )
    ])
  }
  const scientificPlottingSettings = input.scientificPlottingMcp?.settings ?? settings
  if (input.scientificPlottingMcp && scientificPlottingSettings) {
    builders.push([
      GUI_SCIENTIFIC_PLOTTING_MCP_SERVER_NAME,
      (existing) => buildScientificPlottingLocalRuntimeMcpServerConfig(
        input.scientificPlottingMcp!.launch,
        existing,
        scientificPlottingSettings.workspaceRoot
      )
    ])
  }
  const imageGenerationSettings = input.imageGenerationMcp?.settings ?? settings
  if (input.imageGenerationMcp && imageGenerationSettings) {
    builders.push([
      GUI_IMAGE_GENERATION_MCP_SERVER_NAME,
      (existing) => buildImageGenerationLocalRuntimeMcpServerConfig(
        input.imageGenerationMcp!.launch,
        existing,
        imageGenerationSettings.workspaceRoot,
        imageGenerationSettings.imageGeneration
      )
    ])
  }
  const pptMasterSettings = input.pptMasterMcp?.settings ?? settings
  if (input.pptMasterMcp && pptMasterSettings) {
    builders.push([
      GUI_PPT_MASTER_MCP_SERVER_NAME,
      (existing) => buildPptMasterLocalRuntimeMcpServerConfig(
        input.pptMasterMcp!.launch,
        existing,
        pptMasterSettings.workspaceRoot
      )
    ])
  }
  const sciforgeCanvasSettings = input.sciforgeCanvasMcp?.settings ?? settings
  if (input.sciforgeCanvasMcp && sciforgeCanvasSettings) {
    builders.push([
      GUI_SCIFORGE_CANVAS_MCP_SERVER_NAME,
      (existing) => buildSciforgeCanvasLocalRuntimeMcpServerConfig(
        input.sciforgeCanvasMcp!.launch,
        existing,
        sciforgeCanvasSettings.workspaceRoot
      )
    ])
  }
  if (input.computerUseMcp) {
    builders.push([
      GUI_COMPUTER_USE_MCP_SERVER_NAME,
      (existing) => buildComputerUseLocalRuntimeMcpServerConfig(
        input.computerUseMcp!.launch,
        input.computerUseMcp!.enabled !== false,
        existing
      )
    ])
  }
  return builders
}

function codexServerConfigs(input: GuiMcpRegistryInput): GuiMcpRuntimeServerConfig[] {
  const servers: GuiMcpRuntimeServerConfig[] = []
  const settings = input.settings
  const scheduleSettings = input.scheduleMcp?.settings ?? settings
  if (input.scheduleMcp && scheduleSettings) {
    servers.push({
      id: GUI_SCHEDULE_MCP_SERVER_NAME,
      command: resolveScheduleMcpCommand(input.scheduleMcp.launch),
      args: buildScheduleMcpArgs(scheduleSettings, input.scheduleMcp.launch),
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        ...internalSecretEnv(GUI_SCHEDULE_INTERNAL_SECRET_ENV, scheduleSettings.schedule.internal.secret)
      },
      timeoutMs: GUI_SCHEDULE_MCP_TIMEOUT_MS,
      enabledTools: scheduleMcpEnabledTools()
    })
  }
  if (input.researchMcp) {
    servers.push({
      id: GUI_RESEARCH_MCP_SERVER_NAME,
      command: resolveResearchSearchMcpCommand(input.researchMcp.launch),
      args: buildResearchSearchMcpArgs(input.researchMcp.launch),
      env: researchSearchMcpEnv(process.env),
      timeoutMs: RESEARCH_SEARCH_MCP_TIMEOUT_MS,
      enabledTools: researchSearchMcpEnabledTools()
    })
  }
  const workflowSettings = input.workflowMcp?.settings ?? settings
  if (input.workflowMcp && workflowSettings) {
    servers.push({
      id: GUI_WORKFLOW_MCP_SERVER_NAME,
      command: resolveWorkflowMcpCommand(input.workflowMcp.launch),
      args: buildWorkflowMcpArgs(workflowSettings, input.workflowMcp.launch),
      env: workflowMcpEnv(internalSecretEnv(GUI_WORKFLOW_INTERNAL_SECRET_ENV, workflowSettings.workflow.webhookSecret)),
      timeoutMs: WORKFLOW_MCP_TIMEOUT_MS,
      enabledTools: workflowMcpEnabledTools()
    })
  }
  const workspaceIntelSettings = input.workspaceIntelMcp?.settings ?? settings
  if (input.workspaceIntelMcp && workspaceIntelSettings) {
    servers.push({
      id: GUI_WORKSPACE_INTEL_MCP_SERVER_NAME,
      command: resolveWorkspaceIntelMcpCommand(input.workspaceIntelMcp.launch),
      args: buildWorkspaceIntelMcpArgs(workspaceIntelSettings, input.workspaceIntelMcp.launch),
      env: workspaceIntelMcpEnv(),
      timeoutMs: WORKSPACE_INTEL_MCP_TIMEOUT_MS,
      enabledTools: workspaceIntelMcpEnabledTools()
    })
  }
  if (input.remoteExecutorMcp?.launch && input.remoteExecutorMcp.enabled !== false) {
    const remoteExecutorSettings = input.remoteExecutorMcp.settings ?? settings
    servers.push({
      id: GUI_REMOTE_EXECUTOR_MCP_SERVER_NAME,
      command: resolveRemoteExecutorMcpCommand(input.remoteExecutorMcp.launch),
      args: buildRemoteExecutorMcpArgs(input.remoteExecutorMcp.launch),
      env: remoteExecutorMcpEnv({}, remoteExecutorSettings),
      timeoutMs: GUI_REMOTE_EXECUTOR_MCP_TIMEOUT_MS,
      enabledTools: remoteExecutorMcpEnabledTools()
    })
  }
  if (input.paperRadarMcp) {
    servers.push({
      id: GUI_PAPER_RADAR_MCP_SERVER_NAME,
      command: resolvePaperRadarMcpCommand(input.paperRadarMcp.launch),
      args: buildPaperRadarMcpArgs(input.paperRadarMcp.launch),
      env: paperRadarMcpEnv(),
      timeoutMs: PAPER_RADAR_MCP_TIMEOUT_MS,
      enabledTools: paperRadarMcpEnabledTools()
    })
  }
  const writeAssistSettings = input.writeAssistMcp?.settings ?? settings
  if (input.writeAssistMcp && writeAssistSettings) {
    servers.push({
      id: GUI_WRITE_ASSIST_MCP_SERVER_NAME,
      command: resolveWriteAssistMcpCommand(input.writeAssistMcp.launch),
      args: buildWriteAssistMcpArgs(writeAssistSettings, input.writeAssistMcp.launch),
      env: writeAssistMcpEnv(),
      timeoutMs: WRITE_ASSIST_MCP_TIMEOUT_MS,
      enabledTools: writeAssistMcpEnabledTools()
    })
  }
  const runtimeInspectorSettings = input.runtimeInspectorMcp?.settings ?? settings
  if (input.runtimeInspectorMcp && runtimeInspectorSettings) {
    servers.push({
      id: GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME,
      command: resolveRuntimeInspectorMcpCommand(input.runtimeInspectorMcp.launch),
      args: buildRuntimeInspectorMcpArgs(runtimeInspectorSettings, input.runtimeInspectorMcp.launch),
      env: runtimeInspectorMcpEnv(),
      timeoutMs: RUNTIME_INSPECTOR_MCP_TIMEOUT_MS,
      enabledTools: runtimeInspectorMcpEnabledTools()
    })
  }
  const scientificSkillsSettings = input.scientificSkillsMcp?.settings ?? settings
  if (input.scientificSkillsMcp && scientificSkillsSettings) {
    servers.push({
      id: GUI_SCIENTIFIC_SKILLS_MCP_SERVER_NAME,
      command: resolveScientificSkillsMcpCommand(input.scientificSkillsMcp.launch),
      args: buildScientificSkillsMcpArgs(
        input.scientificSkillsMcp.launch,
        scientificSkillsSettings.workspaceRoot
      ),
      env: { ELECTRON_RUN_AS_NODE: '1' },
      timeoutMs: GUI_SCIENTIFIC_SKILLS_MCP_TIMEOUT_MS,
      enabledTools: scientificSkillsMcpEnabledTools()
    })
  }
  const scientificPlottingSettings = input.scientificPlottingMcp?.settings ?? settings
  if (input.scientificPlottingMcp && scientificPlottingSettings) {
    servers.push({
      id: GUI_SCIENTIFIC_PLOTTING_MCP_SERVER_NAME,
      command: resolveScientificPlottingMcpCommand(input.scientificPlottingMcp.launch),
      args: buildScientificPlottingMcpArgs(
        input.scientificPlottingMcp.launch,
        scientificPlottingSettings.workspaceRoot
      ),
      env: { ELECTRON_RUN_AS_NODE: '1' },
      timeoutMs: GUI_SCIENTIFIC_PLOTTING_MCP_TIMEOUT_MS,
      enabledTools: scientificPlottingMcpEnabledTools()
    })
  }
  const imageGenerationSettings = input.imageGenerationMcp?.settings ?? settings
  if (input.imageGenerationMcp && imageGenerationSettings) {
    const config = buildImageGenerationMcpJsonServerConfig(
      input.imageGenerationMcp.launch,
      imageGenerationSettings.workspaceRoot,
      imageGenerationSettings.imageGeneration
    )
    servers.push(runtimeServerConfigFromJson(
      GUI_IMAGE_GENERATION_MCP_SERVER_NAME,
      config,
      GUI_IMAGE_GENERATION_MCP_TIMEOUT_MS,
      imageGenerationMcpEnabledTools()
    ))
  }
  const pptMasterSettings = input.pptMasterMcp?.settings ?? settings
  if (input.pptMasterMcp && pptMasterSettings) {
    const config = buildPptMasterMcpJsonServerConfig(
      input.pptMasterMcp.launch,
      pptMasterSettings.workspaceRoot
    )
    servers.push(runtimeServerConfigFromJson(GUI_PPT_MASTER_MCP_SERVER_NAME, config, GUI_PPT_MASTER_MCP_TIMEOUT_MS, pptMasterMcpEnabledTools()))
  }
  const sciforgeCanvasSettings = input.sciforgeCanvasMcp?.settings ?? settings
  if (input.sciforgeCanvasMcp && sciforgeCanvasSettings) {
    servers.push({
      id: GUI_SCIFORGE_CANVAS_MCP_SERVER_NAME,
      command: resolveSciforgeCanvasMcpCommand(input.sciforgeCanvasMcp.launch),
      args: buildSciforgeCanvasMcpArgs(
        input.sciforgeCanvasMcp.launch,
        sciforgeCanvasSettings.workspaceRoot
      ),
      env: { ELECTRON_RUN_AS_NODE: '1' },
      timeoutMs: GUI_SCIFORGE_CANVAS_MCP_TIMEOUT_MS,
      enabledTools: sciforgeCanvasMcpEnabledTools()
    })
  }
  if (input.computerUseMcp?.launch && input.computerUseMcp.enabled !== false) {
    servers.push(buildComputerUseRuntimeMcpServerConfig(input.computerUseMcp.launch))
  }
  return servers
}

function runtimeServerConfigFromJson(
  id: string,
  config: Record<string, unknown>,
  timeoutMs: number,
  enabledTools: string[]
): GuiMcpRuntimeServerConfig {
  return {
    id,
    command: typeof config.command === 'string' ? config.command : '',
    args: Array.isArray(config.args) ? config.args.filter((item): item is string => typeof item === 'string') : [],
    env: stringRecord(config.env),
    timeoutMs,
    enabledTools
  }
}

function stringRecord(value: unknown): Record<string, string> {
  const record = objectValue(value)
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
