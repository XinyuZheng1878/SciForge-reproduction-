import { startPaperRadarMcpServer } from './mcp-server.js'
import { createPaperRadarFixtureFetch, createPaperRadarService } from './service.js'

const quiet = process.argv.includes('--quiet')
const fixtureDir = parseArgValue(process.argv, '--fixture-dir')
const service = createPaperRadarService({
  dbPath: parseArgValue(process.argv, '--db'),
  profilesPath: parseArgValue(process.argv, '--profiles'),
  userDataDir: parseArgValue(process.argv, '--user-data-dir'),
  fetchImpl: fixtureDir ? createPaperRadarFixtureFetch(fixtureDir) : undefined
})

if (!quiet) {
  console.error('[sciforge-paper-radar] starting MCP stdio server')
  console.error(`[sciforge-paper-radar] db=${service.paths.dbPath}`)
  console.error(`[sciforge-paper-radar] profiles=${service.paths.profilesPath}`)
  if (fixtureDir) console.error(`[sciforge-paper-radar] fixtureDir=${fixtureDir}`)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    service.close()
    process.exit(0)
  })
}

await startPaperRadarMcpServer(service)

function parseArgValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  const value = index >= 0 ? argv[index + 1] : undefined
  return value?.trim() || undefined
}
