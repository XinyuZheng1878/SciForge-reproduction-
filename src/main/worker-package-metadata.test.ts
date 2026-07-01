import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type WorkerPackageJson = {
  name?: string
  private?: boolean
  type?: string
  bin?: Record<string, string>
  exports?: Record<string, string>
  files?: string[]
  scripts?: Record<string, string>
  sciforge?: {
    lifecycleLayer?: string
    runtime?: string
    language?: string
    distribution?: string
    publicContract?: boolean
    runtimeAdapter?: boolean
    mcpServer?: boolean
    publicNpmPackage?: boolean
    sideEffects?: string
  }
}

const allowedSideEffects = new Set(['none', 'filesystem', 'network', 'host-ui', 'process'])
const workerRoot = join(process.cwd(), 'packages', 'workers')

function readWorkerPackageJson(packageDir: string): WorkerPackageJson {
  return JSON.parse(readFileSync(join(workerRoot, packageDir, 'package.json'), 'utf8')) as WorkerPackageJson
}

function readPackageJson(relativePath: string): WorkerPackageJson {
  return JSON.parse(readFileSync(join(process.cwd(), relativePath), 'utf8')) as WorkerPackageJson
}

function parseSideEffects(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean)
}

describe('worker package metadata', () => {
  const workerPackages = readdirSync(workerRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  it('keeps worker package.json declarations consistent', () => {
    expect(workerPackages.length).toBeGreaterThan(0)

    for (const packageDir of workerPackages) {
      const metadata = readWorkerPackageJson(packageDir)
      const runtime = metadata.sciforge?.runtime ?? metadata.sciforge?.language ?? 'node'

      expect(metadata.name, packageDir).toMatch(/^@sciforge\/[a-z0-9-]+$/)
      if (runtime === 'python') {
        if (metadata.files) {
          expect(metadata.files, metadata.name).toEqual(expect.arrayContaining(['package.json', 'README.md']))
        }
        expect(metadata.scripts?.start, metadata.name).toContain('python')
      } else {
        expect(metadata.type, metadata.name).toBe('module')
        expect(metadata.exports, metadata.name).toBeDefined()
        expect(metadata.files, metadata.name).toEqual(expect.arrayContaining(['src', 'package.json', 'README.md']))
        if (metadata.sciforge?.mcpServer) {
          expect(metadata.bin, metadata.name).toBeDefined()
          expect(metadata.scripts?.start, metadata.name).toContain('src/cli.ts')
        }
      }

      expect(metadata.sciforge?.lifecycleLayer, metadata.name).toBe('workers')
      expect(typeof metadata.sciforge?.publicContract, metadata.name).toBe('boolean')
      expect(typeof metadata.sciforge?.runtimeAdapter, metadata.name).toBe('boolean')
      expect(typeof metadata.sciforge?.mcpServer, metadata.name).toBe('boolean')
      expect(metadata.sciforge?.sideEffects, metadata.name).toBeTruthy()

      for (const sideEffect of parseSideEffects(metadata.sciforge?.sideEffects ?? '')) {
        expect(allowedSideEffects.has(sideEffect), `${metadata.name} sideEffects includes ${sideEffect}`).toBe(true)
      }
    }
  })

  it('keeps MCP worker public exports on the standard service boundary', () => {
    for (const packageDir of workerPackages) {
      const metadata = readWorkerPackageJson(packageDir)
      if (!metadata.sciforge?.mcpServer) continue
      if ((metadata.sciforge.runtime ?? metadata.sciforge.language) === 'python') continue

      expect(metadata.exports, metadata.name).toEqual(expect.objectContaining({
        '.': './src/index.ts',
        './contract': './src/contract.ts',
        './mcp-server': './src/mcp-server.ts',
        './service': './src/service.ts'
      }))
    }
  })

  it('keeps the Paper Radar service plugin private while core ownership is pending', () => {
    const metadata = readPackageJson('plugins/paper-radar-service/package.json')

    expect(metadata.name).toBe('sciforge-paper-radar-service')
    expect(metadata.private).toBe(true)
    expect(metadata.sciforge?.distribution).toBe('private-internal-service')
    expect(metadata.sciforge?.publicNpmPackage).toBe(false)
  })
})
