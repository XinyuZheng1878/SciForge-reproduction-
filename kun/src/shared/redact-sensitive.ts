const SECRET_ASSIGNMENT = /(\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*[:=]\s*)(?!<redacted>|REDACTED)([^\s'"`]+)/gi
const BEARER_TOKEN = /(\bBearer\s+)([A-Za-z0-9._-]{20,})/gi
const SCP_HEADER_TOKEN = /(\bSCP-HUB-API-KEY\s*[:=]\s*)(?!<redacted>|REDACTED)([^\s'"`]+)/gi
const OPENAI_STYLE_KEY = /\bsk-[A-Za-z0-9_-]{20,}\b/g
const JWT_TOKEN = /\beyJ[A-Za-z0-9._-]{40,}\b/g

export function redactSensitiveString(value: string): string {
  return value
    .replace(SECRET_ASSIGNMENT, '$1<redacted>')
    .replace(SCP_HEADER_TOKEN, '$1<redacted>')
    .replace(BEARER_TOKEN, '$1<redacted>')
    .replace(OPENAI_STYLE_KEY, 'sk-REDACTED')
    .replace(JWT_TOKEN, 'jwt-REDACTED')
}

export function redactSensitiveValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactSensitiveString(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item, seen))
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    output[key] = redactSensitiveValue(entry, seen)
  }
  return output
}
