const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|bearer|client[-_]?secret|password|secret|token)/i
const SECRET_TEXT_PATTERNS = [
  /\blocal-router-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\b(authorization|api[-_]?key|client[-_]?secret|password|token)\s*[:=]\s*(?:"(?:Bearer\s+)?[^"\s,;}]+?"|'(?:Bearer\s+)?[^'\s,;}]+?'|(?:Bearer\s+)?[^\s,;"'}]+)/gi,
  /\bbearer\s+([^\s,;"'}]+)/gi
]

export const REDACTED_SECRET = '<redacted>'

export function redactSecrets<T>(value: T): T {
  return redact(value) as T
}

function redact(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value
    if (SECRET_KEY_PATTERN.test(key)) return REDACTED_SECRET
    return redactSecretText(value)
  }
  const out: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = SECRET_KEY_PATTERN.test(childKey)
      ? REDACTED_SECRET
      : redact(childValue, childKey)
  }
  return out
}

export function redactSecretText(value: string): string {
  return SECRET_TEXT_PATTERNS.reduce((current, pattern) =>
    current.replace(pattern, (match, key) => {
      if (/^(local-router-|sk-)/i.test(match)) return REDACTED_SECRET
      return match.toLowerCase().startsWith('bearer ')
        ? `Bearer ${REDACTED_SECRET}`
        : `${key}=${REDACTED_SECRET}`
    }), value)
}
