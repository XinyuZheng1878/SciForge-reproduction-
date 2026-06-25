import type {
  AppSettingsV1,
  ResearchMemorySettingsPatchV1,
  ResearchMemorySettingsV1
} from './app-settings-types'

export const DEFAULT_RESEARCH_MEMORY_BRANCH = 'main'
export const DEFAULT_RESEARCH_MEMORY_LOCAL_DIR = '.agent/github-memory'
export const FALLBACK_RESEARCH_MEMORY_LOCAL_PATH = '~/.sciforge/research-memory'

export function defaultResearchMemorySettings(): ResearchMemorySettingsV1 {
  return {
    enabled: true,
    githubRepoUrl: '',
    branch: DEFAULT_RESEARCH_MEMORY_BRANCH,
    localPath: '',
    autoFetch: true,
    defaultForAgents: true
  }
}

export function normalizeResearchMemorySettings(
  input: ResearchMemorySettingsPatchV1 | undefined
): ResearchMemorySettingsV1 {
  const defaults = defaultResearchMemorySettings()
  const branch = cleanString(input?.branch) || defaults.branch
  return {
    enabled: input?.enabled !== false,
    githubRepoUrl: cleanString(input?.githubRepoUrl) || defaults.githubRepoUrl,
    branch,
    localPath: cleanString(input?.localPath) || defaults.localPath,
    autoFetch: input?.autoFetch !== false,
    defaultForAgents: input?.defaultForAgents !== false
  }
}

export function mergeResearchMemorySettings(
  current: ResearchMemorySettingsV1 | undefined,
  patch: ResearchMemorySettingsPatchV1 | undefined
): ResearchMemorySettingsV1 {
  return normalizeResearchMemorySettings({
    ...normalizeResearchMemorySettings(current),
    ...(patch ?? {})
  })
}

export function getResearchMemorySettings(settings: AppSettingsV1): ResearchMemorySettingsV1 {
  return normalizeResearchMemorySettings(settings.researchMemory)
}

export function resolveResearchMemoryLocalPath(settings: Pick<AppSettingsV1, 'workspaceRoot' | 'researchMemory'>): string {
  const researchMemory = normalizeResearchMemorySettings(settings.researchMemory)
  if (researchMemory.localPath) return researchMemory.localPath
  const workspaceRoot = cleanString(settings.workspaceRoot)
  return workspaceRoot
    ? joinPortablePath(workspaceRoot, DEFAULT_RESEARCH_MEMORY_LOCAL_DIR)
    : FALLBACK_RESEARCH_MEMORY_LOCAL_PATH
}

export function shouldUseResearchMemoryWorkspaceRoot(settings: AppSettingsV1): boolean {
  const researchMemory = normalizeResearchMemorySettings(settings.researchMemory)
  return isResearchMemoryEnabledForAgents(settings) && Boolean(
    researchMemory.githubRepoUrl || researchMemory.localPath
  )
}

export function isResearchMemoryEnabledForAgents(settings: AppSettingsV1): boolean {
  const researchMemory = normalizeResearchMemorySettings(settings.researchMemory)
  return researchMemory.enabled && researchMemory.defaultForAgents
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function joinPortablePath(root: string, relativePath: string): string {
  const normalizedRoot = root.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
  const normalizedRelative = relativePath.trim().replace(/\\/g, '/').replace(/^\/+/g, '')
  return normalizedRoot ? `${normalizedRoot}/${normalizedRelative}` : normalizedRelative
}
