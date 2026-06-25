import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceHtmlPreviewService } from './workspace-html-preview-service'

describe('WorkspaceHtmlPreviewService', () => {
  let service: WorkspaceHtmlPreviewService | null = null

  afterEach(async () => {
    await service?.close()
    service = null
  })

  it('serves an HTML file and relative assets from the workspace root', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'html-preview-'))
    await writeFile(join(workspaceRoot, 'status.html'), '<link rel="stylesheet" href="style.css"><h1>Ready</h1>', 'utf8')
    await writeFile(join(workspaceRoot, 'style.css'), 'body { color: rgb(1, 2, 3); }', 'utf8')
    service = new WorkspaceHtmlPreviewService()

    const preview = await service.preview({ workspaceRoot, path: 'status.html' })
    expect(preview).toMatchObject({ ok: true })
    if (!preview.ok) return

    const html = await fetch(preview.url)
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toContain('text/html')
    await expect(html.text()).resolves.toContain('<h1>Ready</h1>')

    const css = await fetch(new URL('style.css', preview.url))
    expect(css.status).toBe(200)
    expect(css.headers.get('content-type')).toContain('text/css')
    await expect(css.text()).resolves.toContain('rgb(1, 2, 3)')
  })

  it('rejects non-HTML entry points', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'html-preview-'))
    await writeFile(join(workspaceRoot, 'notes.txt'), 'hello', 'utf8')
    service = new WorkspaceHtmlPreviewService()

    await expect(service.preview({ workspaceRoot, path: 'notes.txt' })).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('Only .html and .htm')
    })
  })

  it('blocks served paths outside the workspace', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'html-preview-'))
    await writeFile(join(workspaceRoot, 'status.html'), '<h1>Ready</h1>', 'utf8')
    service = new WorkspaceHtmlPreviewService()

    const preview = await service.preview({ workspaceRoot, path: 'status.html' })
    expect(preview).toMatchObject({ ok: true })
    if (!preview.ok) return

    const previewUrl = new URL(preview.url)
    const blocked = await fetch(`${previewUrl.origin}/..%2Fpackage.json`)
    expect(blocked.status).toBe(403)
  })
})
