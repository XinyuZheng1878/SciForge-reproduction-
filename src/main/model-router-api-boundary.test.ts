import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type DirectCallMarker = {
  label: string
  pattern: RegExp
}

type DirectCallHit = {
  file: string
  line: number
  column: number
  marker: string
  text: string
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sourceRoots = ['src', 'kun/src', 'packages/workers', 'plugins/vision-router-service/src', 'scripts']
const sourceExtensions = new Set([
  '.bat',
  '.cjs',
  '.cmd',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.ps1',
  '.py',
  '.sh',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml'
])
const excludedSegments = new Set(['dist', 'docs', 'node_modules', 'out', 'tests'])
const excludedFileNames = new Set(['package-lock.json'])
const excludedPrefixes = ['packages/workers/model-router/']
const testFilePattern = /(?:^|[/.-])(?:test|spec)\.[cm]?[jt]sx?$/

const directCallMarkers: DirectCallMarker[] = [
  { label: 'DeepSeek API host', pattern: /api\.deepseek\.com/i },
  { label: 'OpenAI API host', pattern: /api\.openai\.com/i },
  { label: 'DashScope marker', pattern: /dashscope/i },
  { label: 'beta completions endpoint', pattern: /\/beta\/completions/i },
  { label: 'chat completions endpoint', pattern: /\/chat\/completions/i },
  { label: 'messages endpoint', pattern: /\/v1\/messages/i },
  { label: 'DeepSeek API key env', pattern: /\bDEEPSEEK_API_KEY\b/ },
  { label: 'OpenAI API key env', pattern: /\bOPENAI_API_KEY\b/ },
  { label: 'DashScope API key env', pattern: /\bDASHSCOPE_API_KEY\b/ },
  { label: 'Qwen API key env', pattern: /\bQWEN_API_KEY\b/ }
]

function toRepoPath(path: string): string {
  return relative(repoRoot, path).replaceAll('\\', '/')
}

function isExcludedProductionPath(path: string): boolean {
  const repoPath = toRepoPath(path)
  const fileName = repoPath.split('/').at(-1) ?? ''
  if (excludedFileNames.has(fileName)) return true
  if (excludedPrefixes.some((prefix) => repoPath.startsWith(prefix))) return true
  if (repoPath.split('/').some((segment) => excludedSegments.has(segment))) return true
  return testFilePattern.test(repoPath)
}

function isSourceLikeFile(path: string): boolean {
  return sourceExtensions.has(extname(path))
}

function collectProductionFiles(root: string): string[] {
  if (!existsSync(root)) return []
  if (isExcludedProductionPath(root)) return []

  const stats = statSync(root)
  if (stats.isDirectory()) {
    return readdirSync(root)
      .flatMap((entry) => collectProductionFiles(join(root, entry)))
      .sort()
  }

  if (!stats.isFile()) return []
  return isSourceLikeFile(root) ? [root] : []
}

function scanProductionDirectCallMarkers(): { files: string[]; hits: DirectCallHit[] } {
  const files = sourceRoots
    .flatMap((sourceRoot) => collectProductionFiles(join(repoRoot, sourceRoot)))
    .filter((path) => !isExcludedProductionPath(path))
    .map(toRepoPath)
    .sort()

  const hits = files.flatMap((file) => {
    const absolutePath = join(repoRoot, file)
    return readFileSync(absolutePath, 'utf8').split(/\r?\n/).flatMap((text, index) => {
      const lineHits: DirectCallHit[] = []
      for (const marker of directCallMarkers) {
        const column = text.search(marker.pattern)
        if (column >= 0) {
          lineHits.push({
            file,
            line: index + 1,
            column: column + 1,
            marker: marker.label,
            text: text.trim().replace(/\s+/g, ' ')
          })
        }
      }
      return lineHits
    })
  })

  return { files, hits }
}

function isAllowedBoundaryMarker(hit: DirectCallHit): boolean {
  if (hit.file === 'kun/src/adapters/model/model-error-probe.ts') {
    return hit.marker === 'DeepSeek API host' && hit.text.includes("host === 'api.deepseek.com'")
  }
  if (hit.file === 'kun/src/contracts/model-endpoint-format.ts') {
    return hit.marker === 'chat completions endpoint' || hit.marker === 'messages endpoint'
  }
  if (
    hit.file === 'src/main/local-runtime-process.ts' ||
    hit.file === 'src/main/runtime/codex/codex-config.ts' ||
    hit.file === 'src/main/runtime/claude-code/claude-code-config.ts'
  ) {
    return /^'[A-Z0-9_]+(?:_API_KEY)?',?$/.test(hit.text)
  }
  if (
    hit.marker === 'chat completions endpoint' &&
    (
      hit.file === 'packages/workers/sci-modality-router/src/experts.ts' ||
      hit.file === 'packages/workers/sci-modality-router/provider/server.py' ||
      hit.file === 'plugins/vision-router-service/src/qwen.ts'
    )
  ) {
    return true
  }
  return false
}

function formatHits(hits: DirectCallHit[]): string {
  return hits
    .map((hit) => `${hit.file}:${hit.line}:${hit.column} [${hit.marker}] ${hit.text}`)
    .join('\n')
}

describe('model router API boundary static audit inventory', () => {
  it('keeps the static scan scoped to production code outside the Model Router package', () => {
    const { files, hits } = scanProductionDirectCallMarkers()

    expect(files).toContain('src/main/index.ts')
    expect(files).toContain('src/shared/app-settings-types.ts')
    expect(files).toContain('packages/workers/sci-modality-router/src/experts.ts')
    expect(files).toContain('plugins/vision-router-service/src/qwen.ts')
    expect(files.some((file) => file.startsWith('packages/workers/model-router/'))).toBe(false)
    expect(files.some((file) => testFilePattern.test(file))).toBe(false)
    expect(hits.every((hit) => !hit.file.startsWith('packages/workers/model-router/'))).toBe(true)
  })
})

describe('P7/P8 model router API boundary enforcement', () => {
  it('blocks direct LLM provider markers in production code outside Model Router', () => {
    const { hits } = scanProductionDirectCallMarkers()
    const disallowedHits = hits.filter((hit) => !isAllowedBoundaryMarker(hit))

    expect(formatHits(disallowedHits)).toBe('')
  })
})
