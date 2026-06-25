import { execFile } from 'node:child_process'
import { access, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { AppSettingsV1 } from '../../shared/app-settings'
import {
  DEFAULT_RESEARCH_MEMORY_BRANCH,
  getResearchMemorySettings,
  resolveResearchMemoryLocalPath
} from '../../shared/app-settings'
import type { ResearchMemoryWorkspaceResult } from '../../shared/ds-gui-api'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 60_000

export async function prepareResearchMemoryWorkspace(
  settings: AppSettingsV1
): Promise<ResearchMemoryWorkspaceResult> {
  const researchMemory = getResearchMemorySettings(settings)
  const localPath = resolveResearchMemoryPath(resolveResearchMemoryLocalPath(settings))
  const githubRepoUrl = researchMemory.githubRepoUrl.trim()
  const branch = researchMemory.branch.trim() || DEFAULT_RESEARCH_MEMORY_BRANCH

  if (!researchMemory.enabled) {
    return {
      ok: false,
      localPath,
      message: 'Research Memory is disabled in Settings.'
    }
  }

  try {
    let cloned = false
    let fetched = false

    if (githubRepoUrl) {
      const existing = await directoryState(localPath)
      if (existing === 'missing' || existing === 'empty') {
        if (existing === 'missing') {
          await mkdir(dirname(localPath), { recursive: true })
        }
        await runGit(
          ['clone', '--branch', branch, githubRepoUrl, localPath],
          dirname(localPath)
        )
        cloned = true
      } else if (existing === 'directory') {
        return {
          ok: false,
          localPath,
          message: `Research Memory path is not a git repository: ${localPath}`
        }
      } else if (researchMemory.autoFetch) {
        await runGit(['fetch', '--all', '--prune'], localPath)
        fetched = true
      }
    } else {
      await mkdir(localPath, { recursive: true })
    }

    await ensureResearchMemoryScaffold(localPath)

    return {
      ok: true,
      workspaceRoot: settings.workspaceRoot.trim(),
      localPath,
      githubRepoUrl,
      branch,
      cloned,
      fetched,
      message: workspaceReadyMessage({ githubRepoUrl, cloned, fetched })
    }
  } catch (error) {
    return {
      ok: false,
      localPath,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

function resolveResearchMemoryPath(path: string): string {
  const trimmed = path.trim()
  const expanded = trimmed === '~'
    ? homedir()
    : trimmed.startsWith('~/')
      ? join(homedir(), trimmed.slice(2))
      : trimmed
  return resolve(expanded)
}

type DirectoryState = 'missing' | 'empty' | 'directory' | 'git'

async function directoryState(path: string): Promise<DirectoryState> {
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!info) return 'missing'
  if (!info.isDirectory()) return 'directory'
  if (await exists(join(path, '.git'))) return 'git'
  const entries = await readdir(path)
  return entries.length === 0 ? 'empty' : 'directory'
}

async function ensureResearchMemoryScaffold(root: string): Promise<void> {
  const agentDir = join(root, '.agent')
  const researchMemoryDir = join(agentDir, 'research-memory')
  const artifactsPath = join(agentDir, 'artifacts.yml')
  await mkdir(researchMemoryDir, { recursive: true })
  if (!(await exists(artifactsPath))) {
    await writeFile(artifactsPath, 'artifacts: []\n', 'utf8')
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false)
}

async function runGit(args: string[], cwd: string): Promise<void> {
  try {
    await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 2_000_000
    })
  } catch (error) {
    const detail = commandErrorMessage(error)
    throw new Error(detail ? `git ${args[0]} failed: ${detail}` : `git ${args[0]} failed.`)
  }
}

function commandErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error)
  const record = error as { stderr?: unknown; stdout?: unknown; message?: unknown }
  const text = typeof record.stderr === 'string' && record.stderr.trim()
    ? record.stderr
    : typeof record.stdout === 'string' && record.stdout.trim()
      ? record.stdout
      : typeof record.message === 'string'
        ? record.message
        : ''
  return text.trim().slice(0, 1_000)
}

function workspaceReadyMessage(input: {
  githubRepoUrl: string
  cloned: boolean
  fetched: boolean
}): string {
  if (!input.githubRepoUrl) return 'Local Research Memory workspace is ready.'
  if (input.cloned) return 'GitHub Memory repository cloned.'
  if (input.fetched) return 'GitHub Memory repository fetched.'
  return 'GitHub Memory workspace is ready.'
}
