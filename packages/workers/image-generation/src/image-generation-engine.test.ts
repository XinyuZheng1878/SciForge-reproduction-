import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getImageGenerationStatus,
  renderImageGeneration
} from './image-generation-engine'

let workspaceRoot = ''
let previousAllowPlaceholder: string | undefined
let previousImageApiKey: string | undefined
let previousImageBaseUrl: string | undefined
let previousImageModel: string | undefined
let previousFetch: typeof fetch | undefined

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'image-generation-'))
  previousAllowPlaceholder = process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER
  previousImageApiKey = process.env.SCIFORGE_IMAGE_API_KEY
  previousImageBaseUrl = process.env.SCIFORGE_IMAGE_BASE_URL
  previousImageModel = process.env.SCIFORGE_IMAGE_MODEL
  previousFetch = globalThis.fetch
  delete process.env.SCIFORGE_IMAGE_API_KEY
  delete process.env.SCIFORGE_IMAGE_BASE_URL
  delete process.env.SCIFORGE_IMAGE_MODEL
})

afterEach(() => {
  vi.restoreAllMocks()
  if (previousFetch) globalThis.fetch = previousFetch
  if (previousAllowPlaceholder === undefined) delete process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER
  else process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = previousAllowPlaceholder
  if (previousImageApiKey === undefined) delete process.env.SCIFORGE_IMAGE_API_KEY
  else process.env.SCIFORGE_IMAGE_API_KEY = previousImageApiKey
  if (previousImageBaseUrl === undefined) delete process.env.SCIFORGE_IMAGE_BASE_URL
  else process.env.SCIFORGE_IMAGE_BASE_URL = previousImageBaseUrl
  if (previousImageModel === undefined) delete process.env.SCIFORGE_IMAGE_MODEL
  else process.env.SCIFORGE_IMAGE_MODEL = previousImageModel
  if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true })
  workspaceRoot = ''
})

describe('image generation engine', () => {
  it('reports a degraded placeholder provider when no image API key is configured', async () => {
    const status = await getImageGenerationStatus(workspaceRoot)

    expect(status.ok).toBe(true)
    expect(status.provider).toBe('placeholder')
    expect(status.configured).toBe(false)
    expect(status.warnings.length).toBeGreaterThan(0)
  })

  it('renders a non-destructive placeholder artifact when explicitly enabled for local tests', async () => {
    process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = '1'

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'demo-image',
      recipe: {
        mode: 'text_to_image',
        prompt: 'A clean science illustration with several labeled regions',
        size: { width: 512, height: 320 },
        outputFormat: 'png'
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.status).toBe('rendered_placeholder')
    expect(existsSync(result.outputPath)).toBe(true)
    expect(existsSync(result.manifestPath)).toBe(true)
    expect(existsSync(result.artifactManifestPath)).toBe(true)
    expect(readFileSync(result.outputPath).byteLength).toBeGreaterThan(1024)
    expect(JSON.parse(readFileSync(result.artifactManifestPath, 'utf8'))).toMatchObject({
      kind: 'sciforge_artifact',
      sourceTool: 'image_generation',
      artifactKind: 'generated_image'
    })
  })

  it('rejects output directories outside the workspace', async () => {
    process.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER = '1'

    const result = await renderImageGeneration({
      workspaceRoot,
      outputDir: join(workspaceRoot, '..', 'escaped-images'),
      recipe: {
        mode: 'text_to_image',
        prompt: 'Path safety test',
        size: { width: 256, height: 256 },
        outputFormat: 'png'
      }
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected render to fail')
    expect(result.status).toBe('invalid_workspace')
  })

  it('renders with an explicitly configured image endpoint', async () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    process.env.SCIFORGE_IMAGE_API_KEY = 'test-key'
    process.env.SCIFORGE_IMAGE_BASE_URL = 'http://image-provider.local'
    process.env.SCIFORGE_IMAGE_MODEL = 'test-image-model'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'http://image-provider.local/v1/images/generations') {
        return new Response(JSON.stringify({
          data: [{ b64_json: pngBase64 }]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      throw new Error('Unexpected URL ' + url)
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await renderImageGeneration({
      workspaceRoot,
      imageId: 'gemini-chat-image',
      recipe: {
        mode: 'text_to_image',
        prompt: 'A tiny generated image',
        size: { width: 512, height: 512 },
        outputFormat: 'png'
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.provider).toBe('image-endpoint')
    expect(existsSync(result.outputPath)).toBe(true)
    expect(readFileSync(result.outputPath).toString('base64')).toBe(pngBase64)
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'http://image-provider.local/v1/images/generations'
    ])
  })
})
