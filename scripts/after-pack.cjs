const { execFileSync } = require('node:child_process')
const { chmodSync, existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const localRuntimePackage = require('./local-runtime-package.cjs')

const LOCAL_RUNTIME_REQUIRED_PATHS = localRuntimePackage.LOCAL_RUNTIME_REQUIRED_PATHS

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

const SCIENTIFIC_PLOTTING_RUNTIME_REQUIRED_PATHS = [
  'packages/workers/scientific-plotting/package.json',
  'packages/workers/scientific-plotting/src/scientific-plotting-mcp-server.ts',
  'packages/workers/scientific-plotting/src/scientific-skills-mcp-server.ts',
  'packages/workers/scientific-plotting/src/scientific-plotting-engine.ts',
  'packages/workers/scientific-plotting/src/scientific-skills-index.ts',
  'packages/workers/scientific-plotting/src/contract.ts'
]

const IMAGE_GENERATION_RUNTIME_REQUIRED_PATHS = [
  'packages/workers/image-generation/package.json',
  'packages/workers/image-generation/src/mcp-server.ts',
  'packages/workers/image-generation/src/image-generation-engine.ts',
  'packages/workers/image-generation/src/contract.ts'
]

const PPT_MASTER_RUNTIME_REQUIRED_PATHS = [
  'packages/workers/ppt-master/package.json',
  'packages/workers/ppt-master/src/server.ts',
  'packages/workers/ppt-master/src/service.ts',
  'packages/workers/ppt-master/src/contract.ts',
  'packages/workers/ppt-master/ui-kit/sciforge_research/preset.json'
]

const CANVAS_RUNTIME_REQUIRED_PATHS = [
  'packages/workers/canvas/package.json',
  'packages/workers/canvas/src/sciforge-canvas-mcp-server.ts',
  'packages/workers/canvas/src/sciforge-canvas-engine.ts',
  'packages/workers/canvas/src/contract.ts'
]

const MCP_NODE_ENTRY_REQUIRED_PATHS = [
  'out/main/schedule-mcp-node-entry.js',
  'out/main/computer-use-mcp-node-entry.js',
  'out/main/research-search-mcp-node-entry.js',
  'out/main/workflow-mcp-node-entry.js',
  'out/main/workspace-intel-mcp-node-entry.js',
  'out/main/write-assist-mcp-node-entry.js',
  'out/main/paper-radar-mcp-node-entry.js',
  'out/main/runtime-inspector-mcp-node-entry.js',
  'out/main/scientific-skills-mcp-node-entry.js',
  'out/main/scientific-plotting-mcp-node-entry.js',
  'out/main/image-generation-mcp-node-entry.js',
  'out/main/ppt-master-mcp-node-entry.js',
  'out/main/sciforge-canvas-mcp-node-entry.js'
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

function prunePackedKunDependencies(context) {
  localRuntimePackage.prunePackedKunDependencies(unpackedAppRoot(context))
}

function validateBundledLocalRuntime(context) {
  localRuntimePackage.validateBundledLocalRuntime(unpackedAppRoot(context))
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

function validateBundledScientificPlottingRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of SCIENTIFIC_PLOTTING_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function validateBundledImageGenerationRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of IMAGE_GENERATION_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function validateBundledPptMasterRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of PPT_MASTER_RUNTIME_REQUIRED_PATHS) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function validateBundledCanvasRuntime(context) {
  const root = unpackedAppRoot(context)
  for (const relativePath of CANVAS_RUNTIME_REQUIRED_PATHS) {
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
  validateBundledLocalRuntime(context)
  validateBundledModelRouterRuntime(context)
  validateBundledComputerUseRuntime(context)
  validateBundledSearchRuntime(context)
  validateBundledScheduleRuntime(context)
  validateBundledWorkflowRuntime(context)
  validateBundledWorkspaceIntelRuntime(context)
  validateBundledWriteAssistRuntime(context)
  validateBundledPaperRadarRuntime(context)
  validateBundledRuntimeInspectorRuntime(context)
  validateBundledScientificPlottingRuntime(context)
  validateBundledImageGenerationRuntime(context)
  validateBundledPptMasterRuntime(context)
  validateBundledCanvasRuntime(context)
  validateBuiltMcpNodeEntries(context)
  ensureNodePtyHelpersExecutable(context)
  maybeAdhocSignMacApp(context)
}

exports.LOCAL_RUNTIME_REQUIRED_PATHS = LOCAL_RUNTIME_REQUIRED_PATHS
exports.MODEL_ROUTER_RUNTIME_REQUIRED_PATHS = MODEL_ROUTER_RUNTIME_REQUIRED_PATHS
exports.COMPUTER_USE_RUNTIME_REQUIRED_PATHS = COMPUTER_USE_RUNTIME_REQUIRED_PATHS
exports.SEARCH_RUNTIME_REQUIRED_PATHS = SEARCH_RUNTIME_REQUIRED_PATHS
exports.SCHEDULE_RUNTIME_REQUIRED_PATHS = SCHEDULE_RUNTIME_REQUIRED_PATHS
exports.WORKFLOW_RUNTIME_REQUIRED_PATHS = WORKFLOW_RUNTIME_REQUIRED_PATHS
exports.WORKSPACE_INTEL_RUNTIME_REQUIRED_PATHS = WORKSPACE_INTEL_RUNTIME_REQUIRED_PATHS
exports.WRITE_ASSIST_RUNTIME_REQUIRED_PATHS = WRITE_ASSIST_RUNTIME_REQUIRED_PATHS
exports.PAPER_RADAR_RUNTIME_REQUIRED_PATHS = PAPER_RADAR_RUNTIME_REQUIRED_PATHS
exports.RUNTIME_INSPECTOR_RUNTIME_REQUIRED_PATHS = RUNTIME_INSPECTOR_RUNTIME_REQUIRED_PATHS
exports.SCIENTIFIC_PLOTTING_RUNTIME_REQUIRED_PATHS = SCIENTIFIC_PLOTTING_RUNTIME_REQUIRED_PATHS
exports.IMAGE_GENERATION_RUNTIME_REQUIRED_PATHS = IMAGE_GENERATION_RUNTIME_REQUIRED_PATHS
exports.PPT_MASTER_RUNTIME_REQUIRED_PATHS = PPT_MASTER_RUNTIME_REQUIRED_PATHS
exports.CANVAS_RUNTIME_REQUIRED_PATHS = CANVAS_RUNTIME_REQUIRED_PATHS
exports.MCP_NODE_ENTRY_REQUIRED_PATHS = MCP_NODE_ENTRY_REQUIRED_PATHS
exports._internals = {
  appBundlePath,
  packedResourcesDir,
  unpackedAppRoot,
  projectRoot,
  npmCommand: localRuntimePackage.npmCommand,
  prunePackedKunDependencies,
  validateBundledLocalRuntime,
  validateBundledModelRouterRuntime,
  validateBundledComputerUseRuntime,
  validateBundledSearchRuntime,
  validateBundledScheduleRuntime,
  validateBundledWorkflowRuntime,
  validateBundledWorkspaceIntelRuntime,
  validateBundledWriteAssistRuntime,
  validateBundledPaperRadarRuntime,
  validateBundledRuntimeInspectorRuntime,
  validateBundledScientificPlottingRuntime,
  validateBundledImageGenerationRuntime,
  validateBundledPptMasterRuntime,
  validateBundledCanvasRuntime,
  validateBuiltMcpNodeEntries,
  ensureNodePtyHelpersExecutable
}
exports.default = afterPack
