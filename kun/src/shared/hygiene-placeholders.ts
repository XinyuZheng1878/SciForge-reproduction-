export const HYGIENE_MARKER_INSTRUCTION = 'metadata only; do not copy into future tool arguments'
export const OMITTED_BASH_COMMAND = ': # sciforge history omitted prior bash command; inspect paired tool result'
export const OMITTED_BASH_COMMAND_OUTPUT =
  'Skipped execution: this is a SciForge history-hygiene placeholder, not a shell command. Issue a fresh, smaller command if work is still needed.'

export function isHygienePlaceholderText(value: string): boolean {
  const trimmed = value.trim()
  return (
    (trimmed.startsWith('[cache hygiene:') || trimmed.startsWith('[sciforge request_hygiene')) &&
    trimmed.length < 4096
  )
}

export function isRequestHygieneMarkerObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const marker = (value as Record<string, unknown>).__sciforge_request_hygiene__
  return Boolean(marker && typeof marker === 'object')
}

export function isHygienePlaceholderValue(value: unknown): boolean {
  if (typeof value === 'string') return isHygienePlaceholderText(value)
  return isRequestHygieneMarkerObject(value)
}
