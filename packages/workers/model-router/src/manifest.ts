type ToolWorkerManifest = {
  protocolVersion: string;
  workerId: string;
  workerVersion: string;
  description: string;
  capabilities: string[];
  providers: Array<{
    providerId: string;
    capabilityId: string;
    transport: string;
    invokePath: string;
    healthPath: string;
    manifestPath: string;
    permissions: string[];
    status: string;
  }>;
  tools: Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    sideEffects: string[];
    timeoutMs: number;
    tags: string[];
  }>;
};

export const modelRouterManifest: ToolWorkerManifest = {
  protocolVersion: 'sciforge.tools.v1',
  workerId: 'sciforge.model-router',
  workerVersion: '0.1.0',
  description: 'Provider-compatible SciForge /v1/responses and /v1/messages facade for text reasoning and refs-first visual translation.',
  capabilities: [
    'model_router_responses',
    'model_router_messages',
    'text_reasoning',
    'vision_translation',
    'refs_first_trace',
  ],
  providers: [
    {
      providerId: 'sciforge.model-router.responses',
      capabilityId: 'model_router_responses',
      transport: 'http',
      invokePath: '/v1/responses',
      healthPath: '/healthz',
      manifestPath: '/manifest',
      permissions: ['network', 'filesystem'],
      status: 'available',
    },
    {
      providerId: 'sciforge.model-router.messages',
      capabilityId: 'model_router_messages',
      transport: 'http',
      invokePath: '/v1/messages',
      healthPath: '/healthz',
      manifestPath: '/manifest',
      permissions: ['network', 'filesystem'],
      status: 'available',
    },
    {
      providerId: 'sciforge.model-router.vision-translator',
      capabilityId: 'vision_translation',
      transport: 'http',
      invokePath: '/v1/responses',
      healthPath: '/healthz',
      manifestPath: '/manifest',
      permissions: ['network', 'filesystem'],
      status: 'available',
    },
  ],
  tools: [
    {
      id: 'model_router_responses',
      name: 'Model Router Responses',
      version: '0.1.0',
      description: 'Expose a Codex provider-compatible /v1/responses endpoint backed by profile-selected text and vision roles.',
      inputSchema: {
        input: { type: 'object', required: true, description: 'Responses-compatible input payload with optional visual refs.' },
        profile: { type: 'string', description: 'Optional registered Model Router profile id.' },
      },
      outputSchema: {
        output_text: { type: 'string', required: true },
        traceRef: { type: 'string', required: true },
      },
      sideEffects: ['network', 'write'],
      timeoutMs: 120000,
      tags: ['model-router', 'responses', 'vision', 'refs-first'],
    },
    {
      id: 'model_router_messages',
      name: 'Model Router Messages',
      version: '0.1.0',
      description: 'Expose an Anthropic Messages-compatible /v1/messages endpoint backed by the same Model Router profiles.',
      inputSchema: {
        input: { type: 'object', required: true, description: 'Messages-compatible payload.' },
        profile: { type: 'string', description: 'Optional registered Model Router profile id.' },
      },
      outputSchema: {
        content: { type: 'array', required: true },
      },
      sideEffects: ['network', 'write'],
      timeoutMs: 120000,
      tags: ['model-router', 'messages', 'claude-code'],
    },
  ],
};
