import type { AppSettingsV1 } from '../shared/app-settings'
import {
  buildScheduleMcpArgs,
  buildScheduleKunMcpServerConfig,
  scheduleMcpEnabledTools,
  GUI_SCHEDULE_INTERNAL_SECRET_ENV,
  GUI_SCHEDULE_MCP_DESCRIPTOR,
  GUI_SCHEDULE_MCP_SERVER_NAME,
  GUI_SCHEDULE_MCP_TIMEOUT_MS,
  resolveScheduleMcpCommand,
  type ScheduleMcpLaunchConfig
} from './schedule-mcp-config'
import {
  buildComputerUseMcpArgs,
  buildComputerUseKunMcpServerConfig,
  computerUseMcpEnabledTools,
  computerUseMcpEnvForLaunch,
  COMPUTER_USE_MCP_TIMEOUT_MS,
  GUI_COMPUTER_USE_MCP_DESCRIPTOR,
  GUI_COMPUTER_USE_MCP_SERVER_NAME,
  resolveComputerUseMcpCommand,
  type ComputerUseMcpLaunchConfig
} from './computer-use-mcp-config'
import {
  buildPaperRadarMcpArgs,
  buildPaperRadarKunMcpServerConfig,
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
  buildResearchSearchKunMcpServerConfig,
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
  buildRuntimeInspectorKunMcpServerConfig,
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
  buildWorkspaceIntelKunMcpServerConfig,
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
  buildWorkflowKunMcpServerConfig,
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
  buildWriteAssistKunMcpServerConfig,
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
  resolveKunMcpJsonPath,
  syncExternalKunMcpJson,
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

type KunServerBuilder = (existing: unknown) => Record<string, unknown>

export const GUI_MCP_DESCRIPTORS: readonly ManagedGuiMcpDescriptor[] = [
  GUI_SCHEDULE_MCP_DESCRIPTOR,
  GUI_RESEARCH_MCP_DESCRIPTOR,
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

export async function syncExternalManagedGuiMcpConfig(path = resolveKunMcpJsonPath()): Promise<void> {
  await syncExternalKunMcpJson(path, managedGuiMcpServerNames())
}

export function buildKunManagedGuiMcpServers(
  input: GuiMcpRegistryInput,
  existingServers: Record<string, unknown> = {}
): Record<string, unknown> {
  const servers: Record<string, unknown> = {}
  for (const [serverName, build] of kunServerBuilders(input)) {
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
    [GUI_COMPUTER_USE_MCP_SERVER_NAME]: {
      type: 'stdio',
      command: resolveComputerUseMcpCommand(launch),
      args: buildComputerUseMcpArgs(launch),
      env: computerUseMcpEnvForLaunch(launch),
      timeout: COMPUTER_USE_MCP_TIMEOUT_MS,
      alwaysLoad: true
    }
  }
}

function kunServerBuilders(input: GuiMcpRegistryInput): Array<[string, KunServerBuilder]> {
  const builders: Array<[string, KunServerBuilder]> = []
  const settings = input.settings
  const scheduleSettings = input.scheduleMcp?.settings ?? settings
  if (input.scheduleMcp && scheduleSettings) {
    builders.push([
      GUI_SCHEDULE_MCP_SERVER_NAME,
      (existing) => buildScheduleKunMcpServerConfig(scheduleSettings, input.scheduleMcp!.launch, existing)
    ])
  }
  if (input.researchMcp) {
    builders.push([
      GUI_RESEARCH_MCP_SERVER_NAME,
      (existing) => buildResearchSearchKunMcpServerConfig(input.researchMcp!.launch, existing)
    ])
  }
  const workflowSettings = input.workflowMcp?.settings ?? settings
  if (input.workflowMcp && workflowSettings) {
    builders.push([
      GUI_WORKFLOW_MCP_SERVER_NAME,
      (existing) => buildWorkflowKunMcpServerConfig(workflowSettings, input.workflowMcp!.launch, existing)
    ])
  }
  const workspaceIntelSettings = input.workspaceIntelMcp?.settings ?? settings
  if (input.workspaceIntelMcp && workspaceIntelSettings) {
    builders.push([
      GUI_WORKSPACE_INTEL_MCP_SERVER_NAME,
      (existing) => buildWorkspaceIntelKunMcpServerConfig(
        workspaceIntelSettings,
        input.workspaceIntelMcp!.launch,
        existing
      )
    ])
  }
  if (input.paperRadarMcp) {
    builders.push([
      GUI_PAPER_RADAR_MCP_SERVER_NAME,
      (existing) => buildPaperRadarKunMcpServerConfig(input.paperRadarMcp!.launch, existing)
    ])
  }
  const writeAssistSettings = input.writeAssistMcp?.settings ?? settings
  if (input.writeAssistMcp && writeAssistSettings) {
    builders.push([
      GUI_WRITE_ASSIST_MCP_SERVER_NAME,
      (existing) => buildWriteAssistKunMcpServerConfig(writeAssistSettings, input.writeAssistMcp!.launch, existing)
    ])
  }
  const runtimeInspectorSettings = input.runtimeInspectorMcp?.settings ?? settings
  if (input.runtimeInspectorMcp && runtimeInspectorSettings) {
    builders.push([
      GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME,
      (existing) => buildRuntimeInspectorKunMcpServerConfig(
        runtimeInspectorSettings,
        input.runtimeInspectorMcp!.launch,
        existing
      )
    ])
  }
  if (input.computerUseMcp) {
    builders.push([
      GUI_COMPUTER_USE_MCP_SERVER_NAME,
      (existing) => buildComputerUseKunMcpServerConfig(
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
    servers.push({
      id: GUI_COMPUTER_USE_MCP_SERVER_NAME,
      command: resolveComputerUseMcpCommand(input.computerUseMcp.launch),
      args: buildComputerUseMcpArgs(input.computerUseMcp.launch),
      env: computerUseMcpEnvForLaunch(input.computerUseMcp.launch),
      timeoutMs: COMPUTER_USE_MCP_TIMEOUT_MS,
      enabledTools: computerUseMcpEnabledTools()
    })
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
