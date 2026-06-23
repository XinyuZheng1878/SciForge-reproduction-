import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createWorkspaceIntelService } from './service.js'

test('lists, trees, reads, previews, and references guarded workspace files', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-service-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  await mkdir(join(workspaceRoot, 'src'), { recursive: true })
  await writeFile(join(workspaceRoot, 'README.md'), '# Hello\n\nRead me.\n', 'utf8')
  await writeFile(join(workspaceRoot, 'src', 'index.ts'), 'export const answer = 42\n', 'utf8')
  await writeFile(join(workspaceRoot, '.hidden'), 'hidden\n', 'utf8')

  const service = createWorkspaceIntelService()
  const listing = await service.listWorkspace({ workspaceRoot })
  assert.equal(listing.ok, true)
  if (!listing.ok) return
  assert.deepEqual(listing.entries.map((entry) => entry.relativePath), ['src', 'README.md'])
  assert.equal(listing.entries.some((entry) => entry.relativePath === '.hidden'), false)

  const tree = await service.tree({ workspaceRoot, depth: 2 })
  assert.equal(tree.ok, true)
  if (!tree.ok) return
  assert.equal(tree.tree.kind, 'directory')
  assert.ok(tree.tree.children?.some((entry) => entry.relativePath === 'src'))

  const read = await service.readFile({ workspaceRoot, path: 'src/index.ts' })
  assert.equal(read.ok, true)
  if (!read.ok) return
  assert.equal(read.relativePath, 'src/index.ts')
  assert.match(read.content, /answer = 42/)

  const preview = await service.preview({ workspaceRoot, path: 'README.md', maxChars: 20 })
  assert.equal(preview.ok, true)
  if (!preview.ok) return
  assert.equal(preview.kind, 'text')
  assert.match(preview.contentSummary, /Hello/)

  const references = await service.referenceList({ workspaceRoot, recursive: true, limit: 10 })
  assert.equal(references.ok, true)
  if (!references.ok) return
  assert.ok(references.references.some((reference) => reference.relativePath === 'src/index.ts'))
})

test('rejects path traversal and symlink escapes', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-guard-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  const outsideRoot = join(tempRoot, 'outside')
  await mkdir(workspaceRoot, { recursive: true })
  await mkdir(outsideRoot, { recursive: true })
  await writeFile(join(outsideRoot, 'secret.txt'), 'secret\n', 'utf8')
  await symlink(join(outsideRoot, 'secret.txt'), join(workspaceRoot, 'linked-secret.txt'))

  const service = createWorkspaceIntelService()
  const traversal = await service.readFile({ workspaceRoot, path: '../outside/secret.txt' })
  assert.equal(traversal.ok, false)
  if (traversal.ok) return
  assert.equal(traversal.error.code, 'path_outside_workspace')

  const symlinkRead = await service.readFile({ workspaceRoot, path: 'linked-secret.txt' })
  assert.equal(symlinkRead.ok, false)
  if (symlinkRead.ok) return
  assert.equal(symlinkRead.error.code, 'path_outside_workspace')

  const listing = await service.listWorkspace({ workspaceRoot })
  assert.equal(listing.ok, true)
  if (!listing.ok) return
  assert.equal(listing.entries[0]?.kind, 'symlink')
  assert.equal(listing.entries[0]?.targetInsideWorkspace, false)
  assert.equal(listing.entries[0]?.relativePath, 'linked-secret.txt')
})

test('handles binary and oversized files without unbounded reads', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-binary-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  await writeFile(join(workspaceRoot, 'binary.bin'), Buffer.from([0x66, 0x00, 0x67, 0x68]))
  await writeFile(join(workspaceRoot, 'huge.txt'), 'a'.repeat(70_000), 'utf8')

  const service = createWorkspaceIntelService()
  const binary = await service.readFile({ workspaceRoot, path: 'binary.bin' })
  assert.equal(binary.ok, false)
  if (binary.ok) return
  assert.equal(binary.error.code, 'binary_file')

  const binaryPreview = await service.preview({ workspaceRoot, path: 'binary.bin' })
  assert.equal(binaryPreview.ok, true)
  if (!binaryPreview.ok) return
  assert.equal(binaryPreview.kind, 'binary')
  assert.equal(binaryPreview.content, undefined)

  const huge = await service.readFile({ workspaceRoot, path: 'huge.txt', maxBytes: 1024 })
  assert.equal(huge.ok, true)
  if (!huge.ok) return
  assert.equal(huge.content.length, 1024)
  assert.equal(huge.truncated, true)
  assert.equal(huge.nextOffset, 1024)
})

test('lists and reads project skills by id', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-skills-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  const skillRoot = join(workspaceRoot, '.codex', 'skills', 'demo-skill')
  await mkdir(skillRoot, { recursive: true })
  await writeFile(join(skillRoot, 'SKILL.md'), [
    '---',
    'name: demo-skill',
    'description: Demonstrate skill discovery.',
    '---',
    '',
    '# Demo',
    '',
    'Use this skill for tests.'
  ].join('\n'), 'utf8')

  const service = createWorkspaceIntelService()
  const list = await service.listSkills({ workspaceRoot })
  assert.equal(list.ok, true)
  if (!list.ok) return
  assert.equal(list.validationErrors.length, 0)
  assert.equal(list.skills[0]?.id, 'demo-skill')
  assert.equal(list.skills[0]?.name, 'Demo Skill')
  assert.equal(list.skills[0]?.scope, 'project')
  assert.equal(list.skills[0]?.entryRelativePath, '.codex/skills/demo-skill/SKILL.md')

  const read = await service.readSkill({ workspaceRoot, skillId: 'demo-skill' })
  assert.equal(read.ok, true)
  if (!read.ok) return
  assert.match(read.content, /Use this skill/)
})
