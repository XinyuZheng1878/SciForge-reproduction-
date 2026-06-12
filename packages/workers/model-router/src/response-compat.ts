import { randomBytes } from 'node:crypto';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type ResponsesRequest = {
  model?: string;
  input?: unknown;
  instructions?: string;
  tools?: unknown;
  tool_choice?: unknown;
  temperature?: unknown;
  top_p?: unknown;
  max_tokens?: unknown;
  parallel_tool_calls?: unknown;
  metadata?: unknown;
};

export function makeId(prefix: string): string {
  const cleanPrefix = prefix.replace(/[^A-Za-z0-9_-]+/g, '_') || 'id';
  return `${cleanPrefix}_${randomBytes(12).toString('hex')}`;
}

export function messageOutputItem(text: string, id = makeId('msg')): JsonObject {
  return {
    id,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [{
      type: 'output_text',
      text,
      annotations: [],
    }],
  };
}

export function chatToolNameAliasesFromResponsesTools(tools: unknown): Record<string, string> {
  if (!Array.isArray(tools)) return {};
  const aliases: Record<string, string> = {};
  const used = new Set<string>();
  tools.forEach((tool, index) => {
    const original = responseToolName(tool);
    if (!original) return;
    const alias = chatToolNameAlias(original, index, used);
    if (alias !== original) aliases[alias] = original;
  });
  return aliases;
}

export function responsesToChatCompletions(
  request: ResponsesRequest,
  options: { defaultModel?: string } = {},
): JsonObject {
  const toolAliases = chatToolNameAliasesFromResponsesTools(request.tools);
  return compactJsonObject({
    model: stringValue(request.model) || options.defaultModel || '',
    messages: responsesInputToMessages(request),
    tools: responsesToolsToChatTools(request.tools, toolAliases),
    tool_choice: request.tool_choice,
    temperature: request.temperature,
    top_p: request.top_p,
    max_tokens: request.max_tokens,
    parallel_tool_calls: request.parallel_tool_calls,
    metadata: request.metadata,
  });
}

export function chatCompletionToResponse(
  payload: unknown,
  request: Pick<ResponsesRequest, 'model'> = {},
  toolNameAliases: Record<string, string> = {},
): JsonObject {
  const completion = isRecord(payload) ? payload : {};
  const message = firstChoiceMessage(completion);
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const output = toolCalls.length > 0
    ? toolCalls.map((toolCall) => chatToolCallToResponseItem(toolCall, toolNameAliases))
    : responseTextFromMessage(message)
      ? [messageOutputItem(responseTextFromMessage(message))]
      : [];
  return {
    id: stringValue(completion.id) || makeId('resp'),
    object: 'response',
    created_at: numberValue(completion.created) || Math.floor(Date.now() / 1000),
    model: stringValue(request.model) || stringValue(completion.model) || '',
    status: 'completed',
    output,
    output_text: toolCalls.length > 0 ? '' : responseTextFromMessage(message),
  };
}

function responsesInputToMessages(request: ResponsesRequest): JsonValue[] {
  const messages: JsonValue[] = [];
  if (request.instructions?.trim()) {
    messages.push({ role: 'system', content: request.instructions.trim() });
  }
  const input = request.input;
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) {
      const message = responseInputItemToMessage(item);
      if (message) messages.push(message);
    }
  }
  if (messages.length === 0) messages.push({ role: 'user', content: '' });
  return messages;
}

function responseInputItemToMessage(item: unknown): JsonObject | null {
  if (!isRecord(item)) return null;
  const role = stringValue(item.role) || 'user';
  const content = Array.isArray(item.content)
    ? item.content.map(responseContentPartToChatPart).filter((part): part is JsonObject => Boolean(part))
    : stringValue(item.content) || '';
  return {
    role,
    content,
  };
}

function responseContentPartToChatPart(part: unknown): JsonObject | null {
  if (!isRecord(part)) return null;
  if (part.type === 'input_text') {
    return {
      type: 'text',
      text: stringValue(part.text) || '',
    };
  }
  if (part.type === 'input_image') {
    const imageUrl = stringValue(part.image_url) || stringValue(part.url);
    if (!imageUrl) return null;
    return {
      type: 'image_url',
      image_url: { url: imageUrl },
    };
  }
  return jsonObjectValue(part);
}

function responsesToolsToChatTools(
  tools: unknown,
  aliases: Record<string, string>,
): JsonValue[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const aliasByOriginal = new Map(Object.entries(aliases).map(([alias, original]) => [original, alias]));
  const chatTools = tools.map((tool) => responseToolToChatTool(tool, aliasByOriginal)).filter(Boolean);
  return chatTools.length > 0 ? chatTools as JsonValue[] : undefined;
}

function responseToolToChatTool(tool: unknown, aliasByOriginal: Map<string, string>): JsonObject | null {
  if (!isRecord(tool)) return null;
  if (tool.type !== 'function') return null;
  const name = responseToolName(tool);
  if (!name) return null;
  const description = stringValue(tool.description).trim();
  return {
    type: 'function',
    function: compactJsonObject({
      name: aliasByOriginal.get(name) ?? name,
      description: description || undefined,
      parameters: jsonValue(tool.parameters) ?? {},
    }),
  };
}

function responseToolName(tool: unknown): string {
  if (!isRecord(tool) || tool.type !== 'function') return '';
  const direct = stringValue(tool.name);
  if (direct) return direct;
  return isRecord(tool.function) ? stringValue(tool.function.name) : '';
}

function chatToolNameAlias(name: string, index: number, used: Set<string>): string {
  const base = name
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 56) || `tool_${index + 1}`;
  let candidate = /^[A-Za-z0-9_-]{1,64}$/.test(name) ? name : base;
  let suffix = 2;
  while (used.has(candidate)) {
    const room = Math.max(1, 64 - String(suffix).length - 1);
    candidate = `${base.slice(0, room)}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function chatToolCallToResponseItem(
  toolCall: unknown,
  toolNameAliases: Record<string, string>,
): JsonObject {
  const record = isRecord(toolCall) ? toolCall : {};
  const fn = isRecord(record.function) ? record.function : {};
  const chatName = stringValue(fn.name) || stringValue(record.name) || '';
  return {
    id: makeId('fc'),
    type: 'function_call',
    status: 'completed',
    call_id: stringValue(record.id) || makeId('call'),
    name: toolNameAliases[chatName] ?? chatName,
    arguments: stringValue(fn.arguments) || stringValue(record.arguments) || '',
  };
}

function firstChoiceMessage(completion: Record<string, unknown>): Record<string, unknown> {
  const choices = Array.isArray(completion.choices) ? completion.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : {};
  return isRecord(firstChoice.message) ? firstChoice.message : {};
}

function responseTextFromMessage(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!isRecord(part)) return '';
      return stringValue(part.text) || stringValue(part.content);
    })
    .filter(Boolean)
    .join('\n');
}

function compactJsonObject(values: Record<string, unknown>): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(values)) {
    const normalized = jsonValue(value);
    if (normalized !== undefined) out[key] = normalized;
  }
  return out;
}

function jsonObjectValue(value: Record<string, unknown>): JsonObject {
  return compactJsonObject(value);
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.map(jsonValue).filter((item): item is JsonValue => item !== undefined);
  if (isRecord(value)) return compactJsonObject(value);
  return undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
