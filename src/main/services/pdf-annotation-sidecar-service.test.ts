import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyPdfAnnotationSidecar } from '../../shared/pdf-annotations'
import {
  exportPdfAnnotationSidecarPackage,
  importPdfAnnotationSidecarPackage,
  loadPdfAnnotationSidecar,
  savePdfAnnotationSidecar
} from './pdf-annotation-sidecar-service'

const tempDirs: string[] = []

async function createTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-pdf-annotations-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('pdf annotation sidecar service', () => {
  it('loads an empty default sidecar and saves stable JSON under .sciforge', async () => {
    const workspaceRoot = await createTempWorkspace()
    const pdfPath = join(workspaceRoot, 'paper.pdf')
    await writeFile(pdfPath, '%PDF-1.7\nfake\n', 'utf8')

    const loaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot, pageCount: 3 })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.source).toBe('empty')
    expect(loaded.path).toContain('.sciforge/pdf-annotations/')
    expect(loaded.sidecar.pdfFingerprint.pageCount).toBe(3)

    const saved = await savePdfAnnotationSidecar({ pdfPath, workspaceRoot, sidecar: loaded.sidecar })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.sidecar.version).toBe(1)

    const content = await readFile(saved.path, 'utf8')
    expect(content).toContain('"schemaVersion": 1')
    expect(content.endsWith('\n')).toBe(true)
  })

  it('rejects default sidecar writes through symlinked metadata directories outside the workspace', async () => {
    const workspaceRoot = await createTempWorkspace()
    const outsideRoot = await createTempWorkspace()
    const pdfPath = join(workspaceRoot, 'paper.pdf')
    await writeFile(pdfPath, '%PDF-1.7\nfake\n', 'utf8')

    const loaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot, pageCount: 3 })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    await mkdir(outsideRoot, { recursive: true })
    await symlink(outsideRoot, join(workspaceRoot, '.sciforge'), 'dir')

    const saved = await savePdfAnnotationSidecar({ pdfPath, workspaceRoot, sidecar: loaded.sidecar })
    expect(saved.ok).toBe(false)
    if (!saved.ok) {
      expect(saved.message).toContain('within the selected workspace')
    }
    await expect(readdir(outsideRoot)).resolves.toEqual([])
  })

  it('loads compatible same-directory legacy sidecars', async () => {
    const workspaceRoot = await createTempWorkspace()
    const pdfPath = join(workspaceRoot, 'legacy.pdf')
    await writeFile(pdfPath, '%PDF-1.7\nlegacy\n', 'utf8')

    const empty = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(empty.ok).toBe(true)
    if (!empty.ok) return
    const legacyPath = join(workspaceRoot, 'legacy.pdf.dsgui-annotations.json')
    await writeFile(legacyPath, `${JSON.stringify(createEmptyPdfAnnotationSidecar(empty.pdfFingerprint), null, 2)}\n`, 'utf8')

    const loaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.source).toBe('legacy')
    expect(loaded.path.endsWith('/legacy.pdf.dsgui-annotations.json')).toBe(true)
  })

  it('exports and imports reviewable zip sidecar packages', async () => {
    const workspaceRoot = await createTempWorkspace()
    const pdfPath = join(workspaceRoot, 'roundtrip.pdf')
    await writeFile(pdfPath, '%PDF-1.7\nroundtrip\n', 'utf8')
    const loaded = await loadPdfAnnotationSidecar({ pdfPath, workspaceRoot })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    const exported = await exportPdfAnnotationSidecarPackage({
      pdfPath,
      workspaceRoot,
      sidecar: loaded.sidecar,
      anonymizeAuthors: true
    })
    expect(exported.ok).toBe(true)
    if (!exported.ok) return
    expect(exported.path.endsWith('roundtrip.dsgui-pdf.zip')).toBe(true)

    const zip = await JSZip.loadAsync(await readFile(exported.path))
    expect(zip.file('roundtrip.pdf')).toBeTruthy()
    expect(zip.file('annotations.json')).toBeTruthy()
    expect(zip.file('manifest.json')).toBeTruthy()

    const imported = await importPdfAnnotationSidecarPackage({
      pdfPath,
      workspaceRoot,
      packagePath: exported.path
    })
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.fingerprintMatched).toBe(true)
  })

  it('requires relocation opt-in when package fingerprint does not match', async () => {
    const workspaceRoot = await createTempWorkspace()
    const sourcePdf = join(workspaceRoot, 'source.pdf')
    const targetPdf = join(workspaceRoot, 'target.pdf')
    await writeFile(sourcePdf, '%PDF-1.7\nsource\n', 'utf8')
    await writeFile(targetPdf, '%PDF-1.7\ntarget\n', 'utf8')

    const source = await loadPdfAnnotationSidecar({ pdfPath: sourcePdf, workspaceRoot })
    expect(source.ok).toBe(true)
    if (!source.ok) return
    const exported = await exportPdfAnnotationSidecarPackage({
      pdfPath: sourcePdf,
      workspaceRoot,
      sidecar: source.sidecar
    })
    expect(exported.ok).toBe(true)
    if (!exported.ok) return

    const rejected = await importPdfAnnotationSidecarPackage({
      pdfPath: targetPdf,
      workspaceRoot,
      packagePath: exported.path
    })
    expect(rejected.ok).toBe(false)

    const imported = await importPdfAnnotationSidecarPackage({
      pdfPath: targetPdf,
      workspaceRoot,
      packagePath: exported.path,
      attemptRelocation: true
    })
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.fingerprintMatched).toBe(false)
    expect(imported.warnings[0]).toContain('fingerprint mismatch')
  })
})
