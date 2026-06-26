import { z } from 'zod'

const nonEmptyText = z.string().min(1)
const storedByteCount = z.number().int().nonnegative()
const imageDimension = z.number().int().positive()
const isoTimestamp = z.string()

const optionalImageSize = {
  width: imageDimension.optional(),
  height: imageDimension.optional()
}

const attachmentScope = {
  threadIds: z.array(nonEmptyText).default([]),
  workspaces: z.array(nonEmptyText).default([])
}

export const AttachmentTextFallback = z.object({
  dataBase64: nonEmptyText,
  mimeType: nonEmptyText,
  byteSize: storedByteCount,
  ...optionalImageSize,
  wasCompressed: z.boolean().optional()
}).strict()
export type AttachmentTextFallback = z.infer<typeof AttachmentTextFallback>

export const AttachmentMetadata = z.object({
  id: nonEmptyText,
  name: nonEmptyText,
  mimeType: nonEmptyText,
  byteSize: storedByteCount,
  hash: nonEmptyText,
  ...optionalImageSize,
  localFilePath: nonEmptyText.optional(),
  textFallback: AttachmentTextFallback.optional(),
  ...attachmentScope,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp
}).strict()
export type AttachmentMetadata = z.infer<typeof AttachmentMetadata>

export const AttachmentUploadRequest = z.object({
  name: nonEmptyText,
  mimeType: nonEmptyText.optional(),
  dataBase64: nonEmptyText,
  localFilePath: nonEmptyText.optional(),
  textFallback: AttachmentTextFallback.optional(),
  threadId: nonEmptyText.optional(),
  workspace: nonEmptyText.optional()
}).strict()
export type AttachmentUploadRequest = z.infer<typeof AttachmentUploadRequest>

export const AttachmentUploadResponse = z.object({
  attachment: AttachmentMetadata
}).strict()
export type AttachmentUploadResponse = z.infer<typeof AttachmentUploadResponse>

export const AttachmentDiagnostics = z.object({
  enabled: z.boolean(),
  rootDir: z.string(),
  count: storedByteCount,
  totalBytes: storedByteCount
}).strict()
export type AttachmentDiagnostics = z.infer<typeof AttachmentDiagnostics>
