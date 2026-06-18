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

export type AnthropicMessagesRequest = {
  model?: string;
  messages?: unknown;
  system?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
  temperature?: unknown;
  top_p?: unknown;
  max_tokens?: unknown;
  metadata?: unknown;
  stream?: unknown;
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
    messages: responsesInputToMessages(request, toolAliases),
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
  const reasoningContent = messageReasoningContent(message);
  const output = toolCalls.length > 0
    ? toolCalls.map((toolCall) => chatToolCallToResponseItem(toolCall, toolNameAliases, reasoningContent))
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

export function anthropicMessagesToResponses(
  request: AnthropicMessagesRequest,
  options: { defaultModel?: string } = {},
): ResponsesRequest {
  return compactJsonObject({
    model: stringValue(request.model) || options.defaultModel || '',
    instructions: anthropicSystemToText(request.system),
    input: anthropicMessagesToResponsesInput(request.messages),
    tools: anthropicToolsToResponsesTools(request.tools),
    tool_choice: request.tool_choice,
    temperature: request.temperature,
    top_p: request.top_p,
    max_tokens: request.max_tokens,
    metadata: request.metadata,
  }) as ResponsesRequest;
}

export function responseToAnthropicMessage(
  response: JsonObject,
  request: Pick<AnthropicMessagesRequest, 'model'> = {},
): JsonObject {
  const output = Array.isArray(response.output) ? response.output : [];
  const content = responseOutputToAnthropicContent(output);
  const text = stringValue(response.output_text);
  const stopReason = content.some((part) => part.type === 'tool_use') ? 'tool_use' : 'end_turn';
  return {
    id: stringValue(response.id) || makeId('msg'),
    type: 'message',
    role: 'assistant',
    model: stringValue(request.model) || stringValue(response.model),
    content: content.length > 0 ? content : text ? [{ type: 'text', text }] : [],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: estimateTokenCount(text || JSON.stringify(content)),
    },
  };
}

export function estimateAnthropicMessagesInputTokens(request: AnthropicMessagesRequest): number {
  return estimateTokenCount(JSON.stringify({
    system: request.system,
    messages: request.messages,
    tools: request.tools,
  }));
}

function responsesInputToMessages(
  request: ResponsesRequest,
  toolNameAliases: Record<string, string>,
): JsonValue[] {
  const messages: JsonValue[] = [];
  if (request.instructions?.trim()) {
    messages.push({ role: 'system', content: request.instructions.trim() });
  }
  const input = request.input;
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    const aliasByOriginal = new Map(Object.entries(toolNameAliases).map(([alias, original]) => [original, alias]));
    for (const item of input) {
      const message = responseInputItemToMessage(item, aliasByOriginal);
      if (message) messages.push(message);
    }
  }
  if (messages.length === 0) messages.push({ role: 'user', content: '' });
  return messages;
}

function anthropicSystemToText(system: unknown): string | undefined {
  if (typeof system === 'string') return system.trim() || undefined;
  const text = anthropicContentToText(system);
  return text.trim() || undefined;
}

function anthropicMessagesToResponsesInput(messages: unknown): JsonValue[] {
  if (!Array.isArray(messages)) return [{ role: 'user', content: [{ type: 'input_text', text: '' }] }];
  const input: JsonValue[] = [];
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const role = stringValue(message.role) || 'user';
    const textParts: JsonObject[] = [];
    const flushTextParts = (): void => {
      if (textParts.length === 0) return;
      input.push({ role, content: [...textParts] });
      textParts.length = 0;
    };
    const parts = anthropicContentParts(message.content);
    for (const part of parts) {
      if (isRecord(part) && part.type === 'tool_use') {
        const callId = stringValue(part.id) || makeId('toolu');
        const name = stringValue(part.name) || 'tool';
        flushTextParts();
        input.push({
          id: callId,
          type: 'function_call',
          status: 'completed',
          call_id: callId,
          name,
          arguments: JSON.stringify(jsonValue(part.input) ?? {}),
        });
        continue;
      }
      if (isRecord(part) && part.type === 'tool_result') {
        const callId = stringValue(part.tool_use_id);
        const output = anthropicContentToText(part.content) || stringifyJsonValue(part.content) || '';
        if (callId) {
          flushTextParts();
          input.push({
            type: 'function_call_output',
            call_id: callId,
            output,
          });
        } else {
          textParts.push({ type: 'input_text', text: output });
        }
        continue;
      }
      const normalized = anthropicContentPartToResponsesPart(part);
      if (normalized) textParts.push(normalized);
    }
    flushTextParts();
  }
  return input.length > 0 ? input : [{ role: 'user', content: [{ type: 'input_text', text: '' }] }];
}

function anthropicContentParts(content: unknown): unknown[] {
  if (typeof content === 'string') return [content];
  if (Array.isArray(content)) return content;
  return [''];
}

function anthropicContentPartToResponsesPart(part: unknown): JsonObject | null {
  if (typeof part === 'string') return { type: 'input_text', text: part };
  if (!isRecord(part)) return null;
  if (part.type === 'text') return { type: 'input_text', text: stringValue(part.text) };
  if (part.type === 'image') {
    const source = isRecord(part.source) ? part.source : {};
    const data = stringValue(source.data);
    const mediaType = stringValue(source.media_type) || 'image/png';
    if (data) return { type: 'input_image', image_url: `data:${mediaType};base64,${data}` };
  }
  return { type: 'input_text', text: stringifyJsonValue(part) || '' };
}

function anthropicContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!isRecord(part)) return '';
      return stringValue(part.text) || stringValue(part.content);
    })
    .filter(Boolean)
    .join('\n');
}

function anthropicToolsToResponsesTools(tools: unknown): JsonValue[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const responsesTools = tools.map((tool): JsonObject | null => {
    if (!isRecord(tool)) return null;
    const name = stringValue(tool.name);
    if (!name) return null;
    return compactJsonObject({
      type: 'function',
      name,
      description: stringValue(tool.description) || undefined,
      parameters: jsonValue(tool.input_schema) ?? {},
    });
  }).filter((tool): tool is JsonObject => Boolean(tool));
  return responsesTools.length > 0 ? responsesTools : undefined;
}

function responseOutputToAnthropicContent(output: JsonValue[]): JsonObject[] {
  const content: JsonObject[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item.type === 'message' && Array.isArray(item.content)) {
      const text = item.content
        .map((part) => isRecord(part) ? stringValue(part.text) : '')
        .filter(Boolean)
        .join('\n');
      if (text) content.push({ type: 'text', text });
      continue;
    }
    if (item.type === 'function_call') {
      content.push({
        type: 'tool_use',
        id: stringValue(item.call_id) || stringValue(item.id) || makeId('toolu'),
        name: stringValue(item.name),
        input: parseJsonObject(stringValue(item.arguments)) ?? {},
      });
    }
  }
  return content;
}

function parseJsonObject(raw: string): JsonObject | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? compactJsonObject(parsed) : null;
  } catch {
    return null;
  }
}

function stringifyJsonValue(value: unknown): string | undefined {
  const normalized = jsonValue(value);
  return normalized === undefined ? undefined : JSON.stringify(normalized);
}

function estimateTokenCount(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function responseInputItemToMessage(
  item: unknown,
  aliasByOriginal: Map<string, string>,
): JsonObject | null {
  if (!isRecord(item)) return null;
  if (item.type === 'function_call') {
    const name = stringValue(item.name);
    const callId = stringValue(item.call_id) || stringValue(item.id);
    if (!name || !callId) return null;
    return compactJsonObject({
      role: 'assistant',
      content: null,
      reasoning_content: stringValue(item.reasoning_content) || undefined,
      tool_calls: [{
        id: callId,
        type: 'function',
        function: {
          name: aliasByOriginal.get(name) ?? name,
          arguments: stringValue(item.arguments) || '{}',
        },
      }],
    });
  }
  if (item.type === 'function_call_output') {
    const callId = stringValue(item.call_id) || stringValue(item.id);
    if (!callId) return null;
    return {
      role: 'tool',
      tool_call_id: callId,
      content: functionCallOutputText(item.output),
    };
  }
  const role = chatRoleFromResponseRole(stringValue(item.role));
  const content = Array.isArray(item.content)
    ? chatContentFromResponseParts(item.content)
    : stringValue(item.content) || '';
  return {
    role,
    content,
  };
}

function chatRoleFromResponseRole(role: string): string {
  if (role === 'assistant' || role === 'tool' || role === 'system' || role === 'user') return role;
  if (role === 'developer') return 'system';
  return 'user';
}

function chatContentFromResponseParts(parts: unknown[]): JsonValue {
  const chatParts = parts.map(responseContentPartToChatPart).filter((part): part is JsonObject => Boolean(part));
  if (!chatParts.some((part) => part.type === 'image_url')) {
    return chatParts
      .map((part) => stringValue(part.text) || stringValue(part.content))
      .filter(Boolean)
      .join('\n');
  }
  return chatParts;
}

function functionCallOutputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (typeof entry === 'string') return entry;
      if (!isRecord(entry)) return '';
      return stringValue(entry.text) || stringValue(entry.output) || stringValue(entry.content);
    }).filter(Boolean).join('\n');
  }
  const normalized = jsonValue(value);
  return normalized === undefined ? '' : JSON.stringify(normalized);
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
  reasoningContent = '',
): JsonObject {
  const record = isRecord(toolCall) ? toolCall : {};
  const fn = isRecord(record.function) ? record.function : {};
  const chatName = stringValue(fn.name) || stringValue(record.name) || '';
  return compactJsonObject({
    id: makeId('fc'),
    type: 'function_call',
    status: 'completed',
    call_id: stringValue(record.id) || makeId('call'),
    name: toolNameAliases[chatName] ?? chatName,
    arguments: stringValue(fn.arguments) || stringValue(record.arguments) || '',
    reasoning_content: reasoningContent || undefined,
  });
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

function messageReasoningContent(message: Record<string, unknown>): string {
  const direct = stringValue(message.reasoning_content);
  if (direct) return direct;
  if (isRecord(message.reasoning)) {
    return stringValue(message.reasoning.content) || stringValue(message.reasoning.text);
  }
  return '';
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
