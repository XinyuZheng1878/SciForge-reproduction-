const { execFileSync } = require('node:child_process')
const { chmodSync, existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const localRuntimePackage = require('./local-runtime-package.cjs')
const releaseWorkerManifest = require('./release-worker-manifest.cjs')

const LOCAL_RUNTIME_REQUIRED_PATHS = localRuntimePackage.LOCAL_RUNTIME_REQUIRED_PATHS
const MCP_NODE_ENTRY_REQUIRED_PATHS = releaseWorkerManifest.mcpNodeEntryRequiredPaths

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

function prunePackedLocalRuntimeDependencies(context) {
  localRuntimePackage.prunePackedLocalRuntimeDependencies(unpackedAppRoot(context))
}

function validateBundledLocalRuntime(context) {
  localRuntimePackage.validateBundledLocalRuntime(unpackedAppRoot(context))
}

function validateBundledReleaseRuntime(context, runtimeEntry) {
  const root = unpackedAppRoot(context)
  for (const relativePath of runtimeEntry.requiredPaths) {
    assertExists(join(root, relativePath), relativePath)
  }
}

function validateBundledReleaseRuntimes(context) {
  for (const runtimeEntry of releaseWorkerManifest.runtimeEntries) {
    validateBundledReleaseRuntime(context, runtimeEntry)
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
  prunePackedLocalRuntimeDependencies(context)
  validateBundledLocalRuntime(context)
  validateBundledReleaseRuntimes(context)
  validateBuiltMcpNodeEntries(context)
  ensureNodePtyHelpersExecutable(context)
  maybeAdhocSignMacApp(context)
}

exports.LOCAL_RUNTIME_REQUIRED_PATHS = LOCAL_RUNTIME_REQUIRED_PATHS
for (const [exportName, requiredPaths] of Object.entries(
  releaseWorkerManifest.runtimeRequiredPathExports
)) {
  exports[exportName] = requiredPaths
}
exports.MCP_NODE_ENTRY_REQUIRED_PATHS = MCP_NODE_ENTRY_REQUIRED_PATHS
exports._internals = {
  appBundlePath,
  packedResourcesDir,
  unpackedAppRoot,
  projectRoot,
  npmCommand: localRuntimePackage.npmCommand,
  prunePackedLocalRuntimeDependencies,
  validateBundledLocalRuntime,
  validateBundledReleaseRuntime,
  validateBundledReleaseRuntimes,
  validateBuiltMcpNodeEntries,
  ensureNodePtyHelpersExecutable
}
exports.default = afterPack
