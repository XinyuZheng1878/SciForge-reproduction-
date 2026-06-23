import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('package metadata declares computer-use worker capabilities and side effects', async () => {
  const metadata = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  ) as {
    exports: Record<string, string>
    sciforge: Record<string, unknown>
  }

  assert.equal(metadata.sciforge.lifecycleLayer, 'workers')
  assert.equal(metadata.sciforge.publicContract, true)
  assert.equal(metadata.sciforge.runtimeAdapter, true)
  assert.equal(metadata.sciforge.mcpServer, true)
  assert.equal(metadata.sciforge.sideEffects, 'host-ui, filesystem, process')
  assert.equal(metadata.exports['./contract'], './src/contract.ts')
  assert.equal(metadata.exports['./service'], './src/service.ts')
  assert.equal(metadata.exports['./mcp-server'], './src/mcp-server.ts')
})
