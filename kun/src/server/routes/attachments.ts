import {
  AttachmentUploadRequest,
  type AttachmentUploadResponse,
  type AttachmentUploadRequest as AttachmentUploadBody
} from '../../contracts/attachments.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'

export async function uploadAttachment(
  store: AttachmentStore | undefined,
  request: Request
): Promise<JsonResponse> {
  if (!store) return attachmentStoreUnavailable()
  const upload = await parseUploadBody(request)
  if (!upload.ok) return upload.response

  try {
    return jsonResponse(uploadResponse(await store.create(storeCreateInput(upload.value))), 201)
  } catch (error) {
    return ERRORS.attachmentValidation(errorMessage(error))
  }
}

export async function getAttachmentMetadata(
  store: AttachmentStore | undefined,
  id: string
): Promise<JsonResponse> {
  if (!store) return attachmentStoreUnavailable()
  const attachment = await store.get(id)
  if (!attachment) return ERRORS.notFound(`attachment not found: ${id}`)
  return jsonResponse({ attachment })
}

export async function getAttachmentContent(
  store: AttachmentStore | undefined,
  id: string,
  request: Request
): Promise<JsonResponse> {
  if (!store) return attachmentStoreUnavailable()

  try {
    const { data, ...attachment } = await store.resolveContent(id, attachmentReadScope(request))
    return jsonResponse({ attachment, dataBase64: data.toString('base64') })
  } catch (error) {
    const message = errorMessage(error)
    return isAttachmentAuthorizationError(message) ? ERRORS.forbidden(message) : ERRORS.notFound(message)
  }
}

export async function attachmentDiagnostics(
  store: AttachmentStore | undefined
): Promise<JsonResponse> {
  if (!store) {
    return jsonResponse({ enabled: false, rootDir: '', count: 0, totalBytes: 0 })
  }
  return jsonResponse(await store.diagnostics())
}

type ParsedUploadBody =
  | { ok: true; value: AttachmentUploadBody }
  | { ok: false; response: JsonResponse }

async function parseUploadBody(request: Request): Promise<ParsedUploadBody> {
  const body = await readJsonBody(request)
  if (!body.ok) return body

  const upload = AttachmentUploadRequest.safeParse(body.value)
  return upload.success
    ? { ok: true, value: upload.data }
    : {
        ok: false,
        response: ERRORS.attachmentValidation('invalid attachment upload body', upload.error.issues)
      }
}

function storeCreateInput(input: AttachmentUploadBody): Parameters<AttachmentStore['create']>[0] {
  return {
    name: input.name,
    mimeType: input.mimeType,
    data: Buffer.from(input.dataBase64, 'base64'),
    localFilePath: input.localFilePath,
    textFallback: input.textFallback,
    threadId: input.threadId,
    workspace: input.workspace
  }
}

function uploadResponse(attachment: AttachmentUploadResponse['attachment']): AttachmentUploadResponse {
  return { attachment }
}

function attachmentReadScope(request: Request): Parameters<AttachmentStore['resolveContent']>[1] {
  const params = new URL(request.url).searchParams
  return {
    threadId: params.get('thread_id') ?? undefined,
    workspace: params.get('workspace') ?? undefined
  }
}

function attachmentStoreUnavailable(): JsonResponse {
  return ERRORS.unavailable('attachment store is unavailable')
}

function isAttachmentAuthorizationError(message: string): boolean {
  return /\bnot authorized\b/i.test(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
