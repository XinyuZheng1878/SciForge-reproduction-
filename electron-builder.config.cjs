const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

function loadLocalReleaseEnv() {
  const candidates = [
    process.env.SCIFORGE_RELEASE_ENV,
    process.env.DEEPSEEK_GUI_RELEASE_ENV,
    join(__dirname, 'scripts', 'release.local.env'),
    join(__dirname, 'release.local.env')
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    for (const rawLine of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!match) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!process.env[match[1]]) process.env[match[1]] = value
    }
    break
  }
}

loadLocalReleaseEnv()

const hasExplicitMacSigningIdentity = Boolean(
  process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.MAC_SIGN === '1'
)

const hasNotaryToolCredentials = Boolean(
  process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER &&
    (process.env.APPLE_API_KEY || process.env.APPLE_API_KEY_BASE64)
)

const r2PublicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || 'https://sciforge.ai/api/r2')
  .trim()
  .replace(/\/+$/, '')
const r2ReleasePrefix = (process.env.R2_RELEASE_PREFIX || 'sciforge')
  .trim()
  .replace(/^\/+|\/+$/g, '')
const updateChannel = normalizeUpdateChannel(
  process.env.SCIFORGE_UPDATE_CHANNEL || process.env.DEEPSEEK_GUI_UPDATE_CHANNEL || 'stable'
)
const genericUpdateUrl = `${r2PublicBaseUrl}/${r2ReleasePrefix}/channels/${updateChannel}/latest/`
const releaseAppVersion = (
  process.env.SCIFORGE_APP_VERSION ||
  process.env.DEEPSEEK_GUI_APP_VERSION ||
  ''
).trim()
const artifactVersion = releaseAppVersion || '${version}'
const modelRouterWorkerDir = 'packages/workers/model-router'
const computerUseWorkerDir = 'packages/workers/computer-use'
const scheduleWorkerDir = 'packages/workers/schedule'
const searchWorkerDir = 'packages/workers/search'
const workflowWorkerDir = 'packages/workers/workflow'
const workspaceIntelWorkerDir = 'packages/workers/workspace-intel'
const writeAssistWorkerDir = 'packages/workers/write-assist'
const paperRadarWorkerDir = 'packages/workers/paper-radar'
const runtimeInspectorWorkerDir = 'packages/workers/runtime-inspector'
const scientificPlottingWorkerDir = 'packages/workers/scientific-plotting'
const imageGenerationWorkerDir = 'packages/workers/image-generation'
const multiAgentWorkerDir = 'packages/workers/multi-agent'
const pptMasterWorkerDir = 'packages/workers/ppt-master'
const canvasWorkerDir = 'packages/workers/canvas'
const paperRadarServiceDir = 'plugins/paper-radar-service'

function normalizeUpdateChannel(raw) {
  const value = String(raw || '').trim()
  if (value === 'stable' || value === 'frontier') return value
  throw new Error(`SCIFORGE_UPDATE_CHANNEL must be "stable" or "frontier", got: ${raw}`)
}

if (releaseAppVersion && !/^\d+\.\d+\.\d+$/.test(releaseAppVersion)) {
  throw new Error(
    `SCIFORGE_APP_VERSION must be a valid x.y.z semver for electron-updater, got: ${releaseAppVersion}`
  )
}

module.exports = {
  appId: 'com.xingyuzhong.sciforge',
  productName: 'SciForge',
  asar: true,
  asarUnpack: [
    '**/kun/dist/**/*',
    '**/kun/package*.json',
    '**/kun/node_modules/**/*',
    `**/${modelRouterWorkerDir}/**/*`,
    `**/${computerUseWorkerDir}/**/*`,
    `**/${scheduleWorkerDir}/**/*`,
    `**/${searchWorkerDir}/**/*`,
    `**/${workflowWorkerDir}/**/*`,
    `**/${workspaceIntelWorkerDir}/**/*`,
    `**/${writeAssistWorkerDir}/**/*`,
    `**/${paperRadarWorkerDir}/**/*`,
    `**/${runtimeInspectorWorkerDir}/**/*`,
    `**/${scientificPlottingWorkerDir}/**/*`,
    `**/${imageGenerationWorkerDir}/**/*`,
    `**/${multiAgentWorkerDir}/**/*`,
    `**/${pptMasterWorkerDir}/**/*`,
    `**/${canvasWorkerDir}/**/*`,
    `**/${paperRadarServiceDir}/**/*`,
    '**/node_modules/better-sqlite3/**/*',
    '**/node_modules/node-pty/**/*',
    '**/node_modules/bindings/**/*',
    '**/node_modules/file-uri-to-path/**/*'
  ],
  npmRebuild: true,
  directories: {
    output: process.env.SCIFORGE_DIST_DIR || process.env.DEEPSEEK_GUI_DIST_DIR || 'dist'
  },
  files: [
    'out/**/*',
    'package.json',
    'kun/dist/**/*',
    'kun/package.json',
    'kun/package-lock.json',
    'kun/node_modules/**/*',
    '!**/*.map',
    '!**/*.d.ts',
    '!**/*.ts',
    '!**/tsconfig*.json',
    '!**/README*',
    '!**/CHANGELOG*',
    '!**/node_modules/openclaw/**/*',
    {
      from: modelRouterWorkerDir,
      to: modelRouterWorkerDir,
      filter: [
        '**/*',
        '**/.*'
      ]
    },
    {
      from: computerUseWorkerDir,
      to: computerUseWorkerDir,
      filter: [
        '**/*',
        '**/.*'
      ]
    },
    {
      from: scheduleWorkerDir,
      to: scheduleWorkerDir,
      filter: [
        '**/*',
        '**/.*'
      ]
    },
    {
      from: searchWorkerDir,
      to: searchWorkerDir,
      filter: [
        '**/*',
        '**/.*'
      ]
    },
    {
      from: workflowWorkerDir,
      to: workflowWorkerDir,
      filter: [
        '**/*',
        '**/.*'
      ]
    },
    {
      from: workspaceIntelWorkerDir,
      to: workspaceIntelWorkerDir,
      filter: [
        '**/*',
        '**/.*'
      ]
    },
    {
      from: writeAssistWorkerDir,
      to: writeAssistWorkerDir,
      filter: [
        '**/*',
        '**/.*'
      ]
    },
    {
      from: paperRadarWorkerDir,
      to: paperRadarWorkerDir,
      filter: [
        '**/*',
        '**/.*'
      ]
    },
    {
      from: runtimeInspectorWorkerDir,
      to: runtimeInspectorWorkerDir,
      filter: [
        '**/*',
        '**/.*'
      ]
    },
    {
      from: scientificPlottingWorkerDir,
      to: scientificPlottingWorkerDir,
      filter: [
        '**/*',
        '**/.*'
      ]
    },
    {
      from: imageGenerationWorkerDir,
      to: imageGenerationWorkerDir,
      filter: [
        '**/*',
        '**/.*'
      ]
    },
    {
      from: multiAgentWorkerDir,
      to: multiAgentWorkerDir,
      filter: [
        '**/*',
        '**/.*'
      ]
    },
    {
      from: pptMasterWorkerDir,
      to: pptMasterWorkerDir,
      filter: [
        '**/*',
        '**/.*'
      ]
    },
    {
      from: canvasWorkerDir,
      to: canvasWorkerDir,
      filter: [
        '**/*',
        '**/.*'
      ]
    },
    {
      from: paperRadarServiceDir,
      to: paperRadarServiceDir,
      filter: [
        '**/*',
        '**/.*'
      ]
    }
  ],
  extraResources: [
    { from: 'LICENSE', to: 'compliance/LICENSE' },
    { from: 'THIRD_PARTY_NOTICES.md', to: 'compliance/THIRD_PARTY_NOTICES.md' },
    { from: 'src/asset/img/README.md', to: 'compliance/ASSET_PROVENANCE.md' }
  ],
  artifactName: `SciForge-${artifactVersion}-\${os}-\${arch}.\${ext}`,
  publish: [
    {
      provider: 'generic',
      url: genericUpdateUrl
    }
  ],
  afterPack: './scripts/after-pack.cjs',
  afterSign: './scripts/mac-notarize.cjs',
  mac: {
    category: 'public.app-category.developer-tools',
    identity: hasExplicitMacSigningIdentity ? undefined : null,
    // We notarize in scripts/mac-notarize.cjs so APPLE_API_KEY_BASE64 can be supported.
    notarize: false,
    hardenedRuntime: hasExplicitMacSigningIdentity,
    forceCodeSigning: hasExplicitMacSigningIdentity,
    timestamp: hasExplicitMacSigningIdentity ? 'http://timestamp.apple.com/ts01' : null,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    icon: './src/asset/img/sciforge.png',
    // arm64 (Apple Silicon) + x64 (Intel). On M 系列 Mac 本地打包会各出一组 dmg/zip。
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] }
    ]
  },
  dmg: {
    sign: hasExplicitMacSigningIdentity
  },
  win: {
    icon: './src/asset/img/sciforge.png',
    target: [{ target: 'nsis', arch: ['x64'] }]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    allowElevation: true,
    selectPerMachineByDefault: false,
    // 明确创建快捷方式；always 在覆盖安装时也会重建（即使用户曾删掉桌面图标）
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: 'SciForge',
    uninstallDisplayName: 'SciForge',
    deleteAppDataOnUninstall: false
  },
  linux: {
    category: 'Development',
    icon: './src/asset/img/sciforge.png',
    target: [{ target: 'AppImage', arch: ['x64'] }]
  },
  extraMetadata: {
    ...(releaseAppVersion ? { version: releaseAppVersion } : {}),
    updateChannel,
    buildHints: {
      macSigningEnabled: hasExplicitMacSigningIdentity,
      notarizationEnabled: hasNotaryToolCredentials
    }
  }
}
