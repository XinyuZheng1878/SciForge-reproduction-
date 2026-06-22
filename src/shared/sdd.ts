export const SDD_RELATIVE_DIR = '.sciforge/sdd'
export const SDD_LEGACY_DEEPSEEK_RELATIVE_DIR = '.deepseekgui/sdd'
export const SDD_LEGACY_RELATIVE_DIR = '.kunsdd'
/**
 * One requirement = one self-contained directory:
 * `.sciforge/sdd/requirements/<uuid>/{requirement.md, trace.json, img/}`.
 *
 * Pre-existing `.deepseekgui/sdd/...`, `.kunsdd/draft/<uuid>/requirement.md`
 * drafts, and `.kunsdd/img/...` images are still recognized for read-only
 * continuity, but new SciForge SDD files are written under `.sciforge/sdd`.
 */
export const SDD_REQUIREMENTS_RELATIVE_DIR = `${SDD_RELATIVE_DIR}/requirements`
export const SDD_IMAGE_RELATIVE_DIR = `${SDD_RELATIVE_DIR}/img`
export const SDD_LEGACY_DEEPSEEK_REQUIREMENTS_RELATIVE_DIR = `${SDD_LEGACY_DEEPSEEK_RELATIVE_DIR}/requirements`
export const SDD_LEGACY_DEEPSEEK_IMAGE_RELATIVE_DIR = `${SDD_LEGACY_DEEPSEEK_RELATIVE_DIR}/img`
export const SDD_LEGACY_DRAFT_RELATIVE_DIR = `${SDD_LEGACY_RELATIVE_DIR}/draft`
export const SDD_LEGACY_IMAGE_RELATIVE_DIR = `${SDD_LEGACY_RELATIVE_DIR}/img`
export const SDD_DRAFT_FILE_NAME = 'requirement.md'
export const SDD_TRACE_FILE_NAME = 'trace.json'

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeSddRelativePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

export function buildSddDraftRelativePath(id: string): string {
  return `${SDD_REQUIREMENTS_RELATIVE_DIR}/${id}/${SDD_DRAFT_FILE_NAME}`
}

export function buildLegacySddDraftRelativePath(id: string): string {
  return `${SDD_LEGACY_DRAFT_RELATIVE_DIR}/${id}/${SDD_DRAFT_FILE_NAME}`
}

export function isSddDraftRelativePath(value: string): boolean {
  const normalized = normalizeSddRelativePath(value)
  const parts = normalized.split('/')
  return isCurrentSddDraftParts(parts) || isLegacySddDraftParts(parts)
}

export function sddDraftFolderFromRelativePath(value: string): string | null {
  const normalized = normalizeSddRelativePath(value)
  const parts = normalized.split('/')
  if (isCurrentSddDraftParts(parts) || isLegacySddDraftParts(parts)) return parts.at(-2) ?? null
  return null
}

export function sddRequirementUnitDir(draftRelativePath: string): string | null {
  const folder = sddDraftFolderFromRelativePath(draftRelativePath)
  if (!folder) return null
  return isLegacySddDraftRelativePath(draftRelativePath)
    ? `${SDD_LEGACY_DRAFT_RELATIVE_DIR}/${folder}`
    : isLegacyDeepseekSddDraftRelativePath(draftRelativePath)
      ? `${SDD_LEGACY_DEEPSEEK_REQUIREMENTS_RELATIVE_DIR}/${folder}`
    : `${SDD_REQUIREMENTS_RELATIVE_DIR}/${folder}`
}

export function sddUnitImageDir(draftRelativePath: string): string | null {
  const folder = sddDraftFolderFromRelativePath(draftRelativePath)
  if (!folder) return null
  return isLegacySddDraftRelativePath(draftRelativePath)
    ? SDD_LEGACY_IMAGE_RELATIVE_DIR
    : isLegacyDeepseekSddDraftRelativePath(draftRelativePath)
      ? `${SDD_LEGACY_DEEPSEEK_REQUIREMENTS_RELATIVE_DIR}/${folder}/img`
    : `${SDD_REQUIREMENTS_RELATIVE_DIR}/${folder}/img`
}

export function sddDraftTraceRelativePath(draftRelativePath: string): string | null {
  const unit = sddRequirementUnitDir(draftRelativePath)
  if (!unit || isLegacySddDraftRelativePath(draftRelativePath)) return null
  return `${unit}/${SDD_TRACE_FILE_NAME}`
}

export function sddDraftRelativePathForPlanPath(planRelativePath: string): string | null {
  const normalized = normalizeSddRelativePath(planRelativePath)
  const currentMatch = /^\.sciforge\/plan\/sdd-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-\d+)?\.md$/i.exec(normalized)
  if (currentMatch) return buildSddDraftRelativePath(currentMatch[1].toLowerCase())
  const legacyDeepseekMatch = /^\.deepseekgui\/plan\/sdd-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-\d+)?\.md$/i.exec(normalized)
  if (legacyDeepseekMatch) {
    return `${SDD_LEGACY_DEEPSEEK_REQUIREMENTS_RELATIVE_DIR}/${legacyDeepseekMatch[1].toLowerCase()}/${SDD_DRAFT_FILE_NAME}`
  }
  const legacyMatch = /^\.kunsdd\/plan\/sdd-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-\d+)?\.md$/i.exec(normalized)
  if (legacyMatch) return buildLegacySddDraftRelativePath(legacyMatch[1].toLowerCase())
  return null
}

export function isSddImageRelativePath(value: string): boolean {
  const normalized = normalizeSddRelativePath(value)
  const currentMatch = /^\.sciforge\/sdd\/requirements\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/img\/(.+)$/i.exec(normalized)
  if (currentMatch) return isSafeNestedRelativePath(currentMatch[2] ?? '')
  const legacyDeepseekMatch = /^\.deepseekgui\/sdd\/requirements\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/img\/(.+)$/i.exec(normalized)
  if (legacyDeepseekMatch) return isSafeNestedRelativePath(legacyDeepseekMatch[2] ?? '')
  if (!normalized.startsWith(`${SDD_LEGACY_IMAGE_RELATIVE_DIR}/`)) return false
  const rest = normalized.slice(SDD_LEGACY_IMAGE_RELATIVE_DIR.length + 1)
  return isSafeNestedRelativePath(rest)
}

function isSafeNestedRelativePath(rest: string): boolean {
  return Boolean(rest) && !rest.split('/').some((part) => !part || part === '.' || part === '..')
}

function isCurrentSddDraftParts(parts: string[]): boolean {
  return (
    parts.length === 5 &&
    (parts[0] === '.sciforge' || parts[0] === '.deepseekgui') &&
    parts[1] === 'sdd' &&
    parts[2] === 'requirements' &&
    UUID_LIKE.test(parts[3] ?? '') &&
    parts[4] === SDD_DRAFT_FILE_NAME
  )
}

function isLegacySddDraftParts(parts: string[]): boolean {
  return (
    parts.length === 4 &&
    parts[0] === '.kunsdd' &&
    parts[1] === 'draft' &&
    UUID_LIKE.test(parts[2] ?? '') &&
    parts[3] === SDD_DRAFT_FILE_NAME
  )
}

function isLegacySddDraftRelativePath(value: string): boolean {
  return isLegacySddDraftParts(normalizeSddRelativePath(value).split('/'))
}

function isLegacyDeepseekSddDraftRelativePath(value: string): boolean {
  const parts = normalizeSddRelativePath(value).split('/')
  return isCurrentSddDraftParts(parts) && parts[0] === '.deepseekgui'
}
