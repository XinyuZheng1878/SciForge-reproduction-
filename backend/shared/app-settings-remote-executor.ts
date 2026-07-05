import type {
  AppSettingsV1,
  RemoteExecutorSettingsPatchV1,
  RemoteExecutorSettingsV1,
  RemoteExecutorSlurmDefaultsPatchV1,
  RemoteExecutorSlurmDefaultsV1,
  RemoteExecutorSlurmSettingsPatchV1,
  RemoteExecutorSlurmSettingsV1,
  RemoteExecutorSshSettingsPatchV1,
  RemoteExecutorSshSettingsV1,
  RemoteExecutorTargetKindV1,
  RemoteExecutorTargetPatchV1,
  RemoteExecutorTargetV1,
  RemoteExecutorTrustedWorkspacePatchV1,
  RemoteExecutorTrustedWorkspaceV1
} from './app-settings-types'
import { compactStrings, normalizeBoolean } from './app-settings-normalizers'

export function defaultRemoteExecutorSettings(): RemoteExecutorSettingsV1 {
  return {
    enabled: false,
    defaultTargetId: '',
    targets: []
  }
}

export function normalizeRemoteExecutorSettings(
  input: RemoteExecutorSettingsPatchV1 | undefined
): RemoteExecutorSettingsV1 {
  const defaults = defaultRemoteExecutorSettings()
  const source = input ?? {}
  const seenIds = new Set<string>()
  const targets = Array.isArray(source.targets)
    ? source.targets
        .map((target, index) => normalizeRemoteExecutorTarget(target, index, seenIds))
        .filter((target): target is RemoteExecutorTargetV1 => target != null)
    : defaults.targets
  const defaultTargetId = normalizeRemoteExecutorTargetId(source.defaultTargetId)
  return {
    enabled: normalizeBoolean(source.enabled, defaults.enabled),
    defaultTargetId: targets.some((target) => target.id === defaultTargetId) ? defaultTargetId : '',
    targets
  }
}

export function mergeRemoteExecutorSettings(
  current: RemoteExecutorSettingsV1 | undefined,
  patch: RemoteExecutorSettingsPatchV1 | undefined
): RemoteExecutorSettingsV1 {
  const normalizedCurrent = normalizeRemoteExecutorSettings(current)
  if (!patch) return normalizedCurrent
  return normalizeRemoteExecutorSettings({
    ...normalizedCurrent,
    ...patch,
    targets: patch.targets ?? normalizedCurrent.targets
  })
}

export function getRemoteExecutorSettings(
  settings: AppSettingsV1 | { remoteExecutor?: RemoteExecutorSettingsPatchV1 }
): RemoteExecutorSettingsV1 {
  return normalizeRemoteExecutorSettings((settings as { remoteExecutor?: RemoteExecutorSettingsPatchV1 }).remoteExecutor)
}

export function getRemoteExecutorTarget(
  settings: AppSettingsV1 | { remoteExecutor?: RemoteExecutorSettingsPatchV1 },
  targetId?: string
): RemoteExecutorTargetV1 | null {
  const remoteExecutor = getRemoteExecutorSettings(settings)
  const id = normalizeRemoteExecutorTargetId(targetId || remoteExecutor.defaultTargetId)
  return remoteExecutor.targets.find((target) => target.id === id) ?? null
}

export function remoteExecutorWorkspaceMatchesTrust(
  trustedWorkspaceRoot: string,
  workspaceRoot: string
): boolean {
  const trusted = normalizeWorkspacePathForTrust(trustedWorkspaceRoot)
  const workspace = normalizeWorkspacePathForTrust(workspaceRoot)
  if (!trusted || !workspace) return false
  if (workspace === trusted) return true
  return trusted === '/' ? workspace.startsWith('/') : workspace.startsWith(`${trusted}/`)
}

export function isRemoteExecutorTargetTrustedForWorkspace(
  target: RemoteExecutorTargetV1 | undefined,
  workspaceRoot: string,
  targetFingerprint: string
): boolean {
  const fingerprint = normalizeOptionalString(targetFingerprint)
  if (!target || !fingerprint) return false
  return target.trustedWorkspaces.some((trust) => (
    trust.targetFingerprint === fingerprint &&
    trust.approvalBypass === true &&
    remoteExecutorWorkspaceMatchesTrust(trust.workspaceRoot, workspaceRoot)
  ))
}

function normalizeRemoteExecutorTarget(
  input: RemoteExecutorTargetPatchV1 | undefined,
  index: number,
  seenIds: Set<string>
): RemoteExecutorTargetV1 | null {
  const id = uniqueRemoteExecutorTargetId(normalizeRemoteExecutorTargetId(input?.id), index, seenIds)
  const label = normalizeOptionalString(input?.label) || id
  const kind = normalizeRemoteExecutorTargetKind(input?.kind)
  const ssh = normalizeRemoteExecutorSshSettings(input?.ssh)
  const slurm = normalizeRemoteExecutorSlurmSettings(input?.slurm)
  const target: RemoteExecutorTargetV1 = {
    id,
    label,
    enabled: normalizeBoolean(input?.enabled, true),
    kind,
    remoteWorkspaceRoot: normalizeOptionalString(input?.remoteWorkspaceRoot),
    trustedWorkspaces: normalizeRemoteExecutorTrustedWorkspaces(input?.trustedWorkspaces)
  }
  if (ssh) target.ssh = ssh
  if (slurm) target.slurm = slurm
  return target
}

function normalizeRemoteExecutorTargetKind(value: unknown): RemoteExecutorTargetKindV1 {
  return value === 'slurm' ? 'slurm' : 'ssh'
}

function normalizeRemoteExecutorTargetId(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
}

function uniqueRemoteExecutorTargetId(rawId: string, index: number, seenIds: Set<string>): string {
  const fallback = `target-${index + 1}`
  const baseId = rawId || fallback
  let id = baseId
  let suffix = 2
  while (seenIds.has(id)) {
    id = `${baseId}-${suffix}`
    suffix += 1
  }
  seenIds.add(id)
  return id
}

function normalizeRemoteExecutorSshSettings(
  input: RemoteExecutorSshSettingsPatchV1 | undefined
): RemoteExecutorSshSettingsV1 | undefined {
  const host = normalizeOptionalString(input?.host)
  const user = normalizeOptionalString(input?.user)
  const port = normalizeOptionalPort(input?.port)
  const pythonPath = normalizeOptionalString(input?.pythonPath)
  const identityFile = normalizeOptionalString(input?.identityFile)
  const ssh: RemoteExecutorSshSettingsV1 = {}
  if (host) ssh.host = host
  if (user) ssh.user = user
  if (port !== undefined) ssh.port = port
  if (pythonPath) ssh.pythonPath = pythonPath
  if (identityFile) ssh.identityFile = identityFile
  return Object.keys(ssh).length > 0 ? ssh : undefined
}

function normalizeRemoteExecutorSlurmSettings(
  input: RemoteExecutorSlurmSettingsPatchV1 | undefined
): RemoteExecutorSlurmSettingsV1 | undefined {
  const defaults = normalizeRemoteExecutorSlurmDefaults(input?.defaults)
  return defaults ? { defaults } : undefined
}

function normalizeRemoteExecutorSlurmDefaults(
  input: RemoteExecutorSlurmDefaultsPatchV1 | undefined
): RemoteExecutorSlurmDefaultsV1 | undefined {
  const defaults: RemoteExecutorSlurmDefaultsV1 = {}
  const partition = normalizeOptionalString(input?.partition)
  const account = normalizeOptionalString(input?.account)
  const qos = normalizeOptionalString(input?.qos)
  const timeLimit = normalizeOptionalString(input?.timeLimit)
  const nodes = normalizeOptionalPositiveInteger(input?.nodes)
  const ntasks = normalizeOptionalPositiveInteger(input?.ntasks)
  const cpusPerTask = normalizeOptionalPositiveInteger(input?.cpusPerTask)
  const gpus = normalizeOptionalPositiveInteger(input?.gpus)
  const memory = normalizeOptionalString(input?.memory)
  const constraint = normalizeOptionalString(input?.constraint)
  const gres = normalizeOptionalString(input?.gres)
  const extraArgs = compactStrings(input?.extraArgs)
  if (partition) defaults.partition = partition
  if (account) defaults.account = account
  if (qos) defaults.qos = qos
  if (timeLimit) defaults.timeLimit = timeLimit
  if (nodes !== undefined) defaults.nodes = nodes
  if (ntasks !== undefined) defaults.ntasks = ntasks
  if (cpusPerTask !== undefined) defaults.cpusPerTask = cpusPerTask
  if (gpus !== undefined) defaults.gpus = gpus
  if (memory) defaults.memory = memory
  if (constraint) defaults.constraint = constraint
  if (gres) defaults.gres = gres
  if (extraArgs.length > 0) defaults.extraArgs = extraArgs
  return Object.keys(defaults).length > 0 ? defaults : undefined
}

function normalizeRemoteExecutorTrustedWorkspaces(
  input: RemoteExecutorTrustedWorkspacePatchV1[] | undefined
): RemoteExecutorTrustedWorkspaceV1[] {
  if (!Array.isArray(input)) return []
  const trustedWorkspaces: RemoteExecutorTrustedWorkspaceV1[] = []
  const seen = new Set<string>()
  for (const item of input) {
    const trust = normalizeRemoteExecutorTrustedWorkspace(item)
    if (!trust) continue
    const key = [
      normalizeWorkspacePathForTrust(trust.workspaceRoot),
      trust.targetFingerprint,
      trust.trustedBy
    ].join('\0')
    if (seen.has(key)) continue
    seen.add(key)
    trustedWorkspaces.push(trust)
  }
  return trustedWorkspaces
}

function normalizeRemoteExecutorTrustedWorkspace(
  input: RemoteExecutorTrustedWorkspacePatchV1 | undefined
): RemoteExecutorTrustedWorkspaceV1 | null {
  if (input?.approvalBypass !== true) return null
  const workspaceRoot = normalizeOptionalString(input.workspaceRoot)
  const targetFingerprint = normalizeOptionalString(input.targetFingerprint)
  const trustedAt = normalizeOptionalString(input.trustedAt)
  const trustedBy = normalizeOptionalString(input.trustedBy)
  if (!workspaceRoot || !targetFingerprint || !trustedAt || !trustedBy) return null
  return {
    workspaceRoot,
    targetFingerprint,
    trustedAt,
    trustedBy,
    approvalBypass: true
  }
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOptionalPort(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return undefined
  const port = Math.floor(parsed)
  return port >= 1 && port <= 65_535 ? port : undefined
}

function normalizeOptionalPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return undefined
  const integer = Math.floor(parsed)
  return integer > 0 ? integer : undefined
}

function normalizeWorkspacePathForTrust(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  if (!normalized) return ''
  if (normalized === '/') return '/'
  return normalized.replace(/\/+$/g, '')
}
