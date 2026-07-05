import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WorkspaceListInputSchema,
  WorkspaceReadInputSchema,
  WorkspaceTreeInputSchema,
  WORKSPACE_FILE_RESOURCE_URI_TEMPLATE,
  WORKSPACE_TREE_RESOURCE_URI,
  workspaceFileResourceUri
} from './contract.js'

test('workspace intel schemas reject unbounded inputs', () => {
  assert.equal(WorkspaceListInputSchema.safeParse({ limit: 0 }).success, false)
  assert.equal(WorkspaceListInputSchema.safeParse({ depth: 999 }).success, false)
  assert.equal(WorkspaceTreeInputSchema.safeParse({ depth: 999 }).success, false)
  assert.equal(WorkspaceReadInputSchema.safeParse({ path: 'a.txt', maxBytes: 0 }).success, false)
  assert.equal(WorkspaceReadInputSchema.safeParse({ path: '' }).success, false)
})

test('workspace resource URI helpers keep paths encoded and stable', () => {
  assert.equal(WORKSPACE_TREE_RESOURCE_URI, 'workspace://tree')
  assert.equal(WORKSPACE_FILE_RESOURCE_URI_TEMPLATE, 'workspace://file/{+path}')
  assert.equal(workspaceFileResourceUri('src/a file.ts'), 'workspace://file/src/a%20file.ts')
  assert.equal(workspaceFileResourceUri('/src/a#b.ts'), 'workspace://file/src/a%23b.ts')
})
