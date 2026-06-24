export function schemaSafeMcpToolArguments(
  args: Record<string, unknown>,
  schema: unknown
): Record<string, unknown> {
  const repaired = repairJsonValueForSchema(args, schema)
  return asRecord(repaired) ?? args
}

export function mcpInputValidationFailure(error: unknown): {
  code: 'tool_input_validation_failed'
  error: string
  hint: string
} | null {
  const message = errorMessage(error)
  if (!isMcpInputValidationErrorMessage(message)) return null
  return {
    code: 'tool_input_validation_failed',
    error: message,
    hint: 'Adjust the tool arguments to match the MCP input schema before retrying; do not repeat the same invalid arguments.'
  }
}

function repairJsonValueForSchema(value: unknown, schema: unknown): unknown {
  const record = asRecord(schema)
  if (!record) return value
  const types = schemaTypes(record.type)
  if (types.includes('object') || asRecord(record.properties)) {
    const source = asRecord(value)
    if (!source) return value
    const properties = asRecord(record.properties)
    if (!properties) return value
    const out: Record<string, unknown> = { ...source }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) continue
      out[key] = repairJsonValueForSchema(out[key], propertySchema)
    }
    return out
  }
  if (types.includes('array')) {
    const source = arrayValue(value)
    if (!Array.isArray(value)) return value
    const maxItems = finiteNumber(record.maxItems)
    const bounded = maxItems === undefined ? source : source.slice(0, Math.max(0, Math.floor(maxItems)))
    if (record.items === undefined) return bounded
    return bounded.map((item) => repairJsonValueForSchema(item, record.items))
  }
  if (types.includes('number') || types.includes('integer')) {
    return repairNumberValueForSchema(value, record, types.includes('integer'))
  }
  return value
}

function repairNumberValueForSchema(
  value: unknown,
  schema: Record<string, unknown>,
  integer: boolean
): unknown {
  let number = typeof value === 'number' ? value : numericStringValue(value)
  if (!Number.isFinite(number)) return value
  const minimum = finiteNumber(schema.minimum)
  const maximum = finiteNumber(schema.maximum)
  const exclusiveMinimum = finiteNumber(schema.exclusiveMinimum)
  const exclusiveMaximum = finiteNumber(schema.exclusiveMaximum)
  if (minimum !== undefined) number = Math.max(number, minimum)
  if (maximum !== undefined) number = Math.min(number, maximum)
  if (exclusiveMinimum !== undefined && number <= exclusiveMinimum) {
    number = integer ? Math.floor(exclusiveMinimum + 1) : exclusiveMinimum + Number.EPSILON
  }
  if (exclusiveMaximum !== undefined && number >= exclusiveMaximum) {
    number = integer ? Math.ceil(exclusiveMaximum - 1) : exclusiveMaximum - Number.EPSILON
  }
  if (integer) number = Math.trunc(number)
  return number
}

function schemaTypes(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  return arrayValue(value).filter((entry): entry is string => typeof entry === 'string')
}

function numericStringValue(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return Number.NaN
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMcpInputValidationErrorMessage(message: string): boolean {
  return /input validation|invalid (?:tool )?(?:input|arguments)|schema validation|expected .* received|required|must be (?:<=|>=|less than|greater than|at most|at least)/i.test(message)
}
