import type { PdfAnnotationKind } from '@shared/pdf-annotations'

export type PdfAssistantAnswerAnnotationKind = Extract<PdfAnnotationKind, 'note' | 'answer' | 'translation'>

export type PdfAssistantAnswerSaveRequest = {
  messageId: string
  text: string
  threadIds: string[]
  kind: PdfAssistantAnswerAnnotationKind
}

export type PdfAssistantAnswerSaver = (request: PdfAssistantAnswerSaveRequest) => boolean
