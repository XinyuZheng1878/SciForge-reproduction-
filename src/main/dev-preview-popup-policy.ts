import { normalizeDevPreviewUrlInput } from '../shared/dev-preview-url'
import { normalizeSafeExternalUrl } from '../shared/external-url-policy'

export type DevPreviewPopupDecision =
  | { action: 'navigate-preview'; url: string }
  | { action: 'open-external'; url: string }
  | { action: 'deny' }

export function decideDevPreviewPopup(
  url: string,
  options: { fromWebview: boolean }
): DevPreviewPopupDecision {
  if (options.fromWebview) {
    const previewUrl = normalizeDevPreviewUrlInput(url)
    if (previewUrl) return { action: 'navigate-preview', url: previewUrl }
  }

  const externalUrl = normalizeSafeExternalUrl(url)
  if (externalUrl) return { action: 'open-external', url: externalUrl }

  return { action: 'deny' }
}
