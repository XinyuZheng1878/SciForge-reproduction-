import { describe, expect, it } from 'vitest'
import {
  composerReferenceFromWorkspaceReference,
  renamedRelativePath,
  rewriteRenamedPath
} from './ChatFileTreePanel'

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

  it('derives renamed workspace paths without moving entries between directories', () => {
    expect(renamedRelativePath('pdfs/old.pdf', 'new.pdf')).toBe('pdfs/new.pdf')
    expect(renamedRelativePath('old.pdf', 'new.pdf')).toBe('new.pdf')
  })

  it('rewrites descendant paths when a directory is renamed', () => {
    expect(rewriteRenamedPath('pdfs/nested/file.pdf', 'pdfs', 'papers')).toBe('papers/nested/file.pdf')
    expect(rewriteRenamedPath('pdfs', 'pdfs', 'papers')).toBe('papers')
    expect(rewriteRenamedPath('pdfs-other/file.pdf', 'pdfs', 'papers')).toBe('pdfs-other/file.pdf')
  })
})
