const { execFileSync } = require('node:child_process')
const { chmodSync, existsSync, readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const KUN_RUNTIME_REQUIRED_PATHS = [
  'kun/dist/cli/serve-entry.js',
  'kun/package.json',
  'kun/package-lock.json',
  'kun/node_modules/zod/package.json',
  'kun/node_modules/diff/package.json',
  'kun/node_modules/@modelcontextprotocol/sdk/package.json'
]

const MODEL_ROUTER_RUNTIME_REQUIRED_PATHS = [
  'packages/workers/model-router/package.json',
  'packages/workers/model-router/src/cli.ts',
  'packages/workers/model-router/src/router.ts',
  'packages/workers/model-router/src/manifest.ts',
  'packages/workers/model-router/tools/model-router-trace-audit.ts'
]

// GUI MCP workers launch through out/main/*-mcp-node-entry.js. The copied worker
// package files below are implementation dependencies, not packaged GUI entrypoints.
const COMPUTER_USE_RUNTIME_REQUIRED_PATHS = [
  'packages/workers/computer-use/package.json',
  'packages/workers/computer-use/src/mcp-server.ts',
  'packages/workers/computer-use/src/service.ts',
  'packages/workers/computer-use/src/contract.ts'
]

const SEARCH_RUNTIME_REQUIRED_PATHS = [
  'packages/workers/search/package.json',
  'packages/workers/search/src/mcp-server.ts',
  'packages/workers/search/src/research-service.ts',
  'packages/workers/search/src/types.ts'
]

const SCHEDULE_RUNTIME_REQUIRED_PATHS = [
  'packages/workers/schedule/package.json',
  'packages/workers/schedule/src/mcp-server.ts',
  'packages/workers/schedule/src/service.ts',
  'packages/workers/schedule/src/contract.ts'
]

const WORKFLOW_RUNTIME_REQUIRED_PATHS = [
  'packages/workers/workflow/package.json',
  'packages/workers/workflow/src/mcp-server.ts',
  'packages/workers/workflow/src/service.ts',
  'packages/workers/workflow/src/contract.ts'
]

const WORKSPACE_INTEL_RUNTIME_REQUIRED_PATHS = [
  'packages/workers/workspace-intel/package.json',
  'packages/workers/workspace-intel/src/mcp-server.ts',
  'packages/workers/workspace-intel/src/service.ts',
  'packages/workers/workspace-intel/src/contract.ts'
]

const WRITE_ASSIST_RUNTIME_REQUIRED_PATHS = [
  'packages/workers/write-assist/package.json',
  'packages/workers/write-assist/src/mcp-server.ts',
  'packages/workers/write-assist/src/service.ts',
  'packages/workers/write-assist/src/contract.ts'
]

const PAPER_RADAR_RUNTIME_REQUIRED_PATHS = [
  'packages/workers/paper-radar/package.json',
  'packages/workers/paper-radar/src/mcp-server.ts',
  'packages/workers/paper-radar/src/service.ts',
  'packages/workers/paper-radar/src/contract.ts',
  'plugins/paper-radar-service/package.json',
  'plugins/paper-radar-service/src/storage.ts',
  'plugins/paper-radar-service/src/profiles.ts'
]

const RUNTIME_INSPECTOR_RUNTIME_REQUIRED_PATHS = [
  'packages/workers/runtime-inspector/package.json',
  'packages/workers/runtime-inspector/src/mcp-server.ts',
  'packages/workers/runtime-inspector/src/service.ts',
  'packages/workers/runtime-inspector/src/contract.ts'
]

const MCP_NODE_ENTRY_REQUIRED_PATHS = [
  'out/main/schedule-mcp-node-entry.js',
  'out/main/computer-use-mcp-node-entry.js',
  'out/main/research-search-mcp-node-entry.js',
  'out/main/workflow-mcp-node-entry.js',
  'out/main/workspace-intel-mcp-node-entry.js',
  'out/main/write-assist-mcp-node-entry.js',
  'out/main/paper-radar-mcp-node-entry.js',
  'out/main/runtime-inspector-mcp-node-entry.js'
]

function normalizePlatform(platform) {
  return platform === 'win' ? 'win32' : platform
}

function appBundlePath(context) {
  return join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
}

function packedResourcesDir(context) {
  if (normalizePlatform(context.electronPlatformName) === 'darwin') {
    return join(appBundlePath(context), 'Contents', 'Resources')
  }
  return join(context.appOutDir, 'resources')
}

function unpackedAppRoot(context) {
  return join(packedResourcesDir(context), 'app.asar.unpacked')
}

function projectRoot(context) {
  return context.packager?.projectDir || process.cwd()
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`[after-pack] Missing ${label}: ${path}`)
  }
}

function npmCommand(args, platform = process.platform) {
  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...args]
    }
  }
  return { command: 'npm', args }
}

function prunePackedKunDependencies(context) {
  const root = unpackedAppRoot(context)
  const kunDir = join(root, 'kun')
  if (!existsSync(kunDir)) return

  assertExists(join(kunDir, 'package.json'), 'Kun package manifest')
  assertExists(join(kunDir, 'node_modules'), 'Kun node_modules')

  const prune = npmCommand(['prune', '--omit=dev', '--ignore-scripts'])
  execFileSync(prune.command, prune.args, {
    cwd: kunDir,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false'
    },
    stdio: 'inherit'
  })

  // Keep native SQLite on the app root dependency so electron-builder's
  // native-module rebuild owns the target arch and Electron ABI.
  assertExists(
    join(root, 'node_modules', 'better-sqlite3', 'package.json'),
    'root better-sqlite3 dependency'
  )
  rmSync(join(kunDir, 'node_modules', 'better-sqlite3'), { recursive: true, force: true })
}

function validateBundledKunRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of KUN_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
  assertExists(
    join(root, 'node_modules', 'better-sqlite3', 'package.json'),
    'root better-sqlite3 dependency'
  )
}

function validateBundledModelRouterRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of MODEL_ROUTER_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function validateBundledComputerUseRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of COMPUTER_USE_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function validateBundledSearchRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of SEARCH_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function validateBundledScheduleRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of SCHEDULE_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function validateBundledWorkflowRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of WORKFLOW_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function validateBundledWorkspaceIntelRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of WORKSPACE_INTEL_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function validateBundledWriteAssistRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of WRITE_ASSIST_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function validateBundledPaperRadarRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of PAPER_RADAR_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function validateBundledRuntimeInspectorRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of RUNTIME_INSPECTOR_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function validateBuiltMcpNodeEntries(context) {
  const root = projectRoot(context)
  for (const relativePath of MCP_NODE_ENTRY_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function maybeAdhocSignMacApp(context) {
  if (normalizePlatform(context.electronPlatformName) !== 'darwin') {
    return
  }

  if (
    process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.MAC_SIGN === '1'
  ) {
    console.log('[after-pack] Developer ID signing is enabled, skipping ad-hoc signing.')
    return
  }

  const appBundle = appBundlePath(context)
  if (!existsSync(appBundle)) {
    throw new Error(`[after-pack] App bundle not found for ad-hoc signing: ${appBundle}`)
  }

  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appBundle],
    { stdio: 'inherit' }
  )
}

function ensureNodePtyHelpersExecutable(context) {
  const root = unpackedAppRoot(context)
  const prebuildsDir = join(root, 'node_modules', 'node-pty', 'prebuilds')
  if (!existsSync(prebuildsDir)) return
  for (const folder of readdirSync(prebuildsDir)) {
    const helper = join(prebuildsDir, folder, 'spawn-helper')
    if (!existsSync(helper)) continue
    try {
      chmodSync(helper, 0o755)
    } catch (error) {
      console.warn(`[after-pack] could not chmod node-pty spawn-helper (${folder}):`, error.message)
    }
  }
}

async function afterPack(context) {
  prunePackedKunDependencies(context)
  validateBundledKunRuntime(context)
  validateBundledModelRouterRuntime(context)
  validateBundledComputerUseRuntime(context)
  validateBundledSearchRuntime(context)
  validateBundledScheduleRuntime(context)
  validateBundledWorkflowRuntime(context)
  validateBundledWorkspaceIntelRuntime(context)
  validateBundledWriteAssistRuntime(context)
  validateBundledPaperRadarRuntime(context)
  validateBundledRuntimeInspectorRuntime(context)
  validateBuiltMcpNodeEntries(context)
  ensureNodePtyHelpersExecutable(context)
  maybeAdhocSignMacApp(context)
}

exports.KUN_RUNTIME_REQUIRED_PATHS = KUN_RUNTIME_REQUIRED_PATHS
exports.MODEL_ROUTER_RUNTIME_REQUIRED_PATHS = MODEL_ROUTER_RUNTIME_REQUIRED_PATHS
exports.COMPUTER_USE_RUNTIME_REQUIRED_PATHS = COMPUTER_USE_RUNTIME_REQUIRED_PATHS
exports.SEARCH_RUNTIME_REQUIRED_PATHS = SEARCH_RUNTIME_REQUIRED_PATHS
exports.SCHEDULE_RUNTIME_REQUIRED_PATHS = SCHEDULE_RUNTIME_REQUIRED_PATHS
exports.WORKFLOW_RUNTIME_REQUIRED_PATHS = WORKFLOW_RUNTIME_REQUIRED_PATHS
exports.WORKSPACE_INTEL_RUNTIME_REQUIRED_PATHS = WORKSPACE_INTEL_RUNTIME_REQUIRED_PATHS
exports.WRITE_ASSIST_RUNTIME_REQUIRED_PATHS = WRITE_ASSIST_RUNTIME_REQUIRED_PATHS
exports.PAPER_RADAR_RUNTIME_REQUIRED_PATHS = PAPER_RADAR_RUNTIME_REQUIRED_PATHS
exports.RUNTIME_INSPECTOR_RUNTIME_REQUIRED_PATHS = RUNTIME_INSPECTOR_RUNTIME_REQUIRED_PATHS
exports.MCP_NODE_ENTRY_REQUIRED_PATHS = MCP_NODE_ENTRY_REQUIRED_PATHS
exports._internals = {
  appBundlePath,
  packedResourcesDir,
  unpackedAppRoot,
  projectRoot,
  npmCommand,
  prunePackedKunDependencies,
  validateBundledKunRuntime,
  validateBundledModelRouterRuntime,
  validateBundledComputerUseRuntime,
  validateBundledSearchRuntime,
  validateBundledScheduleRuntime,
  validateBundledWorkflowRuntime,
  validateBundledWorkspaceIntelRuntime,
  validateBundledWriteAssistRuntime,
  validateBundledPaperRadarRuntime,
  validateBundledRuntimeInspectorRuntime,
  validateBuiltMcpNodeEntries,
  ensureNodePtyHelpersExecutable
}
exports.default = afterPack
