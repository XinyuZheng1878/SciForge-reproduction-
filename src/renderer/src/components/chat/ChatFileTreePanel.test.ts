import { describe, expect, it } from 'vitest'
import { composerReferenceFromWorkspaceReference } from './ChatFileTreePanel'

describe('ChatFileTreePanel helpers', () => {
  it('converts shared workspace references into composer references', () => {
    expect(composerReferenceFromWorkspaceReference({
      workspaceRoot: '/tmp/workspace',
      relativePath: 'src',
      name: 'src',
      kind: 'directory'
    })).toEqual({
      path: 'src',
      relativePath: 'src',
      name: 'src',
      workspaceRoot: '/tmp/workspace',
      kind: 'directory'
    })

    expect(composerReferenceFromWorkspaceReference({
      workspaceRoot: '/tmp/workspace',
      relativePath: 'assets/panel.png',
      name: 'panel.png',
      kind: 'image',
      mimeType: 'image/png',
      size: 128
    })).toEqual({
      path: 'assets/panel.png',
      relativePath: 'assets/panel.png',
      name: 'panel.png',
      workspaceRoot: '/tmp/workspace',
      kind: 'image',
      mimeType: 'image/png',
      modelRouterObject: true
    })
  })
})
