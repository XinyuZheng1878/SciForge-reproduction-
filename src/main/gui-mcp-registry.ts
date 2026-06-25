import { isResearchMemoryEnabledForAgents, type AppSettingsV1 } from '../shared/app-settings'
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
  buildResearchMemoryMcpArgs,
  buildResearchMemoryLocalRuntimeMcpServerConfig,
  GUI_RESEARCH_MEMORY_MCP_DESCRIPTOR,
  GUI_RESEARCH_MEMORY_MCP_SERVER_NAME,
  RESEARCH_MEMORY_MCP_TIMEOUT_MS,
  researchMemoryMcpEnabledTools,
  researchMemoryMcpEnv,
  resolveResearchMemoryMcpCommand,
  type ResearchMemoryMcpLaunchConfig
} from './research-memory-mcp-config'
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
  managedGuiMcpNames,
  resolveLocalRuntimeMcpJsonPath,
  syncExternalLocalRuntimeMcpJson,
  type ManagedGuiMcpDescriptor
} from './managed-gui-mcp-config'

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
  researchMemoryMcp?: {
    settings?: AppSettingsV1
    launch: ResearchMemoryMcpLaunchConfig
  }
  workflowMcp?: {
    settings?: AppSettingsV1
    launch: WorkflowMcpLaunchConfig
  }
  workspaceIntelMcp?: {
    settings?: AppSettingsV1
    launch: WorkspaceIntelMcpLaunchConfig
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
}

type LocalRuntimeServerBuilder = (existing: unknown) => Record<string, unknown>

export const GUI_MCP_DESCRIPTORS: readonly ManagedGuiMcpDescriptor[] = [
  GUI_SCHEDULE_MCP_DESCRIPTOR,
  GUI_RESEARCH_MCP_DESCRIPTOR,
  GUI_RESEARCH_MEMORY_MCP_DESCRIPTOR,
  GUI_WORKFLOW_MCP_DESCRIPTOR,
  GUI_WORKSPACE_INTEL_MCP_DESCRIPTOR,
  GUI_PAPER_RADAR_MCP_DESCRIPTOR,
  GUI_WRITE_ASSIST_MCP_DESCRIPTOR,
  GUI_RUNTIME_INSPECTOR_MCP_DESCRIPTOR,
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
  const researchMemorySettings = input.researchMemoryMcp?.settings ?? settings
  if (input.researchMemoryMcp && researchMemorySettings) {
    builders.push([
      GUI_RESEARCH_MEMORY_MCP_SERVER_NAME,
      (existing) => buildResearchMemoryLocalRuntimeMcpServerConfig(
        researchMemorySettings,
        input.researchMemoryMcp!.launch,
        existing
      )
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
        ...localSecretEnv(GUI_SCHEDULE_INTERNAL_SECRET_ENV, scheduleSettings.schedule.internal.secret)
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
  const researchMemorySettings = input.researchMemoryMcp?.settings ?? settings
  if (input.researchMemoryMcp && researchMemorySettings && isResearchMemoryEnabledForAgents(researchMemorySettings)) {
    servers.push({
      id: GUI_RESEARCH_MEMORY_MCP_SERVER_NAME,
      command: resolveResearchMemoryMcpCommand(input.researchMemoryMcp.launch),
      args: buildResearchMemoryMcpArgs(researchMemorySettings, input.researchMemoryMcp.launch),
      env: researchMemoryMcpEnv(),
      timeoutMs: RESEARCH_MEMORY_MCP_TIMEOUT_MS,
      enabledTools: researchMemoryMcpEnabledTools()
    })
  }
  const workflowSettings = input.workflowMcp?.settings ?? settings
  if (input.workflowMcp && workflowSettings) {
    servers.push({
      id: GUI_WORKFLOW_MCP_SERVER_NAME,
      command: resolveWorkflowMcpCommand(input.workflowMcp.launch),
      args: buildWorkflowMcpArgs(workflowSettings, input.workflowMcp.launch),
      env: workflowMcpEnv(localSecretEnv(GUI_WORKFLOW_INTERNAL_SECRET_ENV, workflowSettings.workflow.webhookSecret)),
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
  if (input.computerUseMcp?.launch && input.computerUseMcp.enabled !== false) {
    servers.push(buildComputerUseRuntimeMcpServerConfig(input.computerUseMcp.launch))
  }
  return servers
}

function localSecretEnv(name: string, value: string | undefined): Record<string, string> {
  const secret = value?.trim()
  return secret ? { [name]: secret } : {}
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
