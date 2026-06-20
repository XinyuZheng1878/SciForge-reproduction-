import { describe, expect, it } from 'vitest'
import { buildWorkspaceReferenceGroups } from './workspace-reference-groups'

describe('buildWorkspaceReferenceGroups', () => {
  it('deduplicates project, write, and worktree workspace roots in display order', () => {
    expect(buildWorkspaceReferenceGroups({
      activeThreadWorkspace: '/workspace/project',
      workspaceRoot: '/workspace/project/',
      writeWorkspaceRoot: '/workspace/write',
      codeWorkspaceRoots: [
        '/workspace/project',
        '/workspace/project-worktree',
        '/workspace/write'
      ]
    })).toEqual([
      {
        id: 'project:/workspace/project',
        label: 'project',
        workspaceRoot: '/workspace/project',
        kind: 'project'
      },
      {
        id: 'write:/workspace/write',
        label: 'write',
        workspaceRoot: '/workspace/write',
        kind: 'write'
      },
      {
        id: 'worktree:/workspace/project-worktree',
        label: 'project-worktree',
        workspaceRoot: '/workspace/project-worktree',
        kind: 'worktree'
      }
    ])
  })
})
