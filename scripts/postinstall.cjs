const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options
  })
}

require('./ensure-kun-install.cjs')

const buildKun = run('npm', ['--prefix', 'kun', 'run', 'build'])
if (buildKun.status !== 0) {
  process.exit(buildKun.status || 1)
}

// node-pty powers the built-in terminal in the Electron main process. Its
// bundled spawn-helper can lose the executable bit after install, which makes
// PTY creation fail on macOS/Linux. Best effort; the app still starts if this
// repair cannot run.
try {
  const { existsSync, readdirSync, chmodSync } = require('node:fs')
  const prebuildsDir = join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
  if (existsSync(prebuildsDir)) {
    for (const folder of readdirSync(prebuildsDir)) {
      const helper = join(prebuildsDir, folder, 'spawn-helper')
      if (!existsSync(helper)) continue
      try {
        chmodSync(helper, 0o755)
      } catch (error) {
        console.warn(`[postinstall] could not chmod node-pty spawn-helper (${folder}):`, error.message)
      }
    }
  }
} catch (error) {
  console.warn('[postinstall] skipped node-pty spawn-helper chmod:', error.message)
}

try {
  const electronVersion = require('electron/package.json').version
  const result = run('npx', [
    '--yes',
    'prebuild-install',
    '--runtime=electron',
    `--target=${electronVersion}`
  ], { cwd: join(__dirname, '..', 'node_modules', 'node-pty') })
  if (result.status !== 0) {
    console.warn('[postinstall] node-pty electron prebuild fell back to bundled binaries')
  }
} catch (error) {
  console.warn('[postinstall] skipped node-pty electron prebuild:', error.message)
}
