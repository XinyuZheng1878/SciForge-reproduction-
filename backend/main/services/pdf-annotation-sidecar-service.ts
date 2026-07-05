import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import JSZip from 'jszip'
import {
  PDF_ANNOTATION_DEFAULT_DIR,
  PDF_ANNOTATION_LEGACY_SUFFIX,
  PDF_ANNOTATION_PACKAGE_SUFFIX,
  createEmptyPdfAnnotationSidecar,
  migratePdfAnnotationSidecar,
  pdfAnnotationSidecarSchema,
  stablePdfAnnotationSidecar,
  type PdfAnnotationAuthor,
  type PdfAnnotationSidecar,
  type PdfAnnotationSidecarExportPayload,
  type PdfAnnotationSidecarExportResult,
  type PdfAnnotationSidecarImportPayload,
  type PdfAnnotationSidecarImportResult,
  type PdfAnnotationSidecarLoadResult,
  type PdfAnnotationSidecarSavePayload,
  type PdfAnnotationSidecarSaveResult,
  type PdfAnnotationSidecarTarget,
  type PdfFingerprint
} from '../../shared/pdf-annotations'
import {
  canonicalPath,
  expandHomePath,
  pathExists,
  resolveOpenTargetPath,
  resolveSafeWorkspaceWriteTarget,
  type ResolvedWorkspaceWriteTarget,
  writeSafeWorkspaceFile
} from './workspace-paths'

const MAX_SIDECAR_JSON_BYTES = 16 * 1024 * 1024
const MAX_IMPORT_PACKAGE_BYTES = 160 * 1024 * 1024

type ResolvedPdfTarget = {
  pdfPath: string
  workspaceRoot?: string
  sidecarRoot: string
  defaultSidecarTarget: ResolvedWorkspaceWriteTarget
  defaultSidecarPath: string
  legacySidecarPath: string
  exportPackageTarget: ResolvedWorkspaceWriteTarget
  exportPackagePath: string
  fingerprint: PdfFingerprint
}

type ResolvePdfAnnotationTargetOptions = {
  createDefaultSidecarParents?: boolean
  createExportPackageParents?: boolean
}

function normalizeWorkspaceRoot(workspaceRoot: string | undefined): string | undefined {
  const value = workspaceRoot?.trim()
  if (!value) return undefined
  return expandHomePath(value)
}

function withoutPdfExtension(name: string): string {
  return extname(name).toLowerCase() === '.pdf' ? name.slice(0, -4) : name
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

async function fingerprintPdf(path: string, pageCount?: number): Promise<PdfFingerprint> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error('PDF annotation target must be a file.')
  return {
    sha256: await sha256File(path),
    size: info.size,
    mtimeMs: info.mtimeMs,
    ...(pageCount ? { pageCount } : {}),
    fileName: basename(path)
  }
}

async function resolvePdfAnnotationTarget(
  target: PdfAnnotationSidecarTarget,
  options?: ResolvePdfAnnotationTargetOptions
): Promise<ResolvedPdfTarget> {
  const workspaceRoot = normalizeWorkspaceRoot(target.workspaceRoot)
  const pdfPath = await resolveOpenTargetPath(target.pdfPath, workspaceRoot)
  const fingerprint = await fingerprintPdf(pdfPath, target.pageCount)
  const sidecarRoot = workspaceRoot
    ? await canonicalPath(workspaceRoot)
    : dirname(pdfPath)
  const defaultSidecarTarget = await resolveSafeWorkspaceWriteTarget(
    join(PDF_ANNOTATION_DEFAULT_DIR, `${fingerprint.sha256}.json`),
    sidecarRoot,
    { createParentDirectories: options?.createDefaultSidecarParents ?? false }
  )
  const legacySidecarPath = join(dirname(pdfPath), `${basename(pdfPath)}${PDF_ANNOTATION_LEGACY_SUFFIX}`)
  const exportPackageTarget = await resolveSafeWorkspaceWriteTarget(
    `${withoutPdfExtension(basename(pdfPath))}${PDF_ANNOTATION_PACKAGE_SUFFIX}`,
    sidecarRoot,
    { createParentDirectories: options?.createExportPackageParents ?? false }
  )
  return {
    pdfPath,
    workspaceRoot,
    sidecarRoot,
    defaultSidecarTarget,
    defaultSidecarPath: defaultSidecarTarget.path,
    legacySidecarPath,
    exportPackageTarget,
    exportPackagePath: exportPackageTarget.path,
    fingerprint
  }
}

async function readJsonFile(path: string): Promise<unknown> {
  const info = await stat(path)
  if (info.size > MAX_SIDECAR_JSON_BYTES) {
    throw new Error('PDF annotation sidecar is too large.')
  }
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function writeJsonFile(target: ResolvedWorkspaceWriteTarget, value: unknown): Promise<void> {
  const tmpTarget = await resolveSafeWorkspaceWriteTarget(
    join(target.parentPath, `${basename(target.path)}.tmp-${process.pid}-${randomUUID()}`),
    target.workspaceRoot,
    { createParentDirectories: false }
  )
  const content = `${JSON.stringify(value, null, 2)}\n`
  await writeSafeWorkspaceFile(tmpTarget, content, { encoding: 'utf8', exclusive: true })
  try {
    await resolveSafeWorkspaceWriteTarget(target.path, target.workspaceRoot, {
      createParentDirectories: false
    })
    await rename(tmpTarget.path, target.path)
  } catch (error) {
    await rm(tmpTarget.path, { force: true })
    throw error
  }
}

function withResolvedFingerprint(sidecar: PdfAnnotationSidecar, target: ResolvedPdfTarget): PdfAnnotationSidecar {
  return stablePdfAnnotationSidecar({
    ...sidecar,
    schemaVersion: 1,
    pdfFingerprint: target.fingerprint,
    manifest: {
      ...sidecar.manifest,
      sourcePdfName: basename(target.pdfPath),
      sourcePdfPath: target.pdfPath,
      updatedAt: sidecar.updatedAt
    }
  })
}

export async function loadPdfAnnotationSidecar(
  target: PdfAnnotationSidecarTarget
): Promise<PdfAnnotationSidecarLoadResult> {
  try {
    const resolved = await resolvePdfAnnotationTarget(target)
    const warnings: string[] = []
    const candidates: Array<{ path: string; source: 'default' | 'legacy' }> = [
      { path: resolved.defaultSidecarPath, source: 'default' },
      { path: resolved.legacySidecarPath, source: 'legacy' }
    ]

    for (const candidate of candidates) {
      if (!(await pathExists(candidate.path))) continue
      try {
        const sidecar = withResolvedFingerprint(migratePdfAnnotationSidecar(await readJsonFile(candidate.path)), resolved)
        return {
          ok: true,
          sidecar,
          path: candidate.path,
          source: candidate.source,
          pdfFingerprint: resolved.fingerprint,
          ...(candidate.source === 'legacy' ? { legacyPath: candidate.path } : {}),
          warnings
        }
      } catch (error) {
        warnings.push(`${candidate.source} sidecar skipped: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return {
      ok: true,
      sidecar: createEmptyPdfAnnotationSidecar(resolved.fingerprint, {
        sourcePdfName: basename(resolved.pdfPath),
        sourcePdfPath: resolved.pdfPath
      }),
      path: resolved.defaultSidecarPath,
      source: 'empty',
      pdfFingerprint: resolved.fingerprint,
      warnings
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function savePdfAnnotationSidecar(
  payload: PdfAnnotationSidecarSavePayload
): Promise<PdfAnnotationSidecarSaveResult> {
  try {
    const resolved = await resolvePdfAnnotationTarget(payload, { createDefaultSidecarParents: true })
    const now = new Date().toISOString()
    const sidecar = stablePdfAnnotationSidecar({
      ...withResolvedFingerprint(payload.sidecar, resolved),
      version: payload.sidecar.version + 1,
      updatedAt: now,
      manifest: {
        ...payload.sidecar.manifest,
        sourcePdfName: basename(resolved.pdfPath),
        sourcePdfPath: resolved.pdfPath,
        updatedAt: now
      }
    })
    const parsed = pdfAnnotationSidecarSchema.parse(sidecar)
    await writeJsonFile(resolved.defaultSidecarTarget, parsed)
    return {
      ok: true,
      sidecar: parsed,
      path: resolved.defaultSidecarPath,
      savedAt: now
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

function anonymizeAuthors(authors: PdfAnnotationAuthor[]): PdfAnnotationAuthor[] {
  return authors.map((author, index) => ({
    ...author,
    name: `Anonymous ${index + 1}`,
    email: undefined,
    anonymous: true,
    updatedAt: new Date().toISOString()
  }))
}

export async function exportPdfAnnotationSidecarPackage(
  payload: PdfAnnotationSidecarExportPayload
): Promise<PdfAnnotationSidecarExportResult> {
  try {
    const resolved = await resolvePdfAnnotationTarget(payload, { createExportPackageParents: true })
    const loaded = payload.sidecar
      ? { ok: true as const, sidecar: payload.sidecar }
      : await loadPdfAnnotationSidecar(payload)
    if (!loaded.ok) return loaded

    const now = new Date().toISOString()
    const sidecar = stablePdfAnnotationSidecar({
      ...withResolvedFingerprint(loaded.sidecar, resolved),
      authors: payload.anonymizeAuthors ? anonymizeAuthors(loaded.sidecar.authors) : loaded.sidecar.authors,
      updatedAt: now,
      manifest: {
        ...loaded.sidecar.manifest,
        sourcePdfName: basename(resolved.pdfPath),
        sourcePdfPath: resolved.pdfPath,
        exchangePackage: basename(resolved.exportPackagePath),
        updatedAt: now
      }
    })
    const zip = new JSZip()
    zip.file(basename(resolved.pdfPath), await readFile(resolved.pdfPath))
    zip.file('annotations.json', `${JSON.stringify(sidecar, null, 2)}\n`)
    zip.file('manifest.json', `${JSON.stringify(sidecar.manifest, null, 2)}\n`)
    const bytes = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    })
    await writeSafeWorkspaceFile(resolved.exportPackageTarget, bytes)
    return {
      ok: true,
      path: resolved.exportPackagePath,
      manifest: sidecar.manifest,
      exportedAt: now
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function readImportPackage(payload: PdfAnnotationSidecarImportPayload, workspaceRoot?: string): Promise<Buffer> {
  if (payload.packageBase64?.trim()) {
    const bytes = Buffer.from(payload.packageBase64.trim(), 'base64')
    if (bytes.length > MAX_IMPORT_PACKAGE_BYTES) throw new Error('PDF annotation package is too large.')
    return bytes
  }
  const rawPath = payload.packagePath?.trim()
  if (!rawPath) throw new Error('PDF annotation package path is required.')
  const path = await resolveOpenTargetPath(rawPath, workspaceRoot)
  const info = await stat(path)
  if (info.size > MAX_IMPORT_PACKAGE_BYTES) throw new Error('PDF annotation package is too large.')
  return readFile(path)
}

export async function importPdfAnnotationSidecarPackage(
  payload: PdfAnnotationSidecarImportPayload
): Promise<PdfAnnotationSidecarImportResult> {
  try {
    const resolved = await resolvePdfAnnotationTarget(payload, { createDefaultSidecarParents: true })
    const zip = await JSZip.loadAsync(await readImportPackage(payload, resolved.workspaceRoot))
    const annotationsEntry = zip.file('annotations.json')
    if (!annotationsEntry) throw new Error('PDF annotation package is missing annotations.json.')
    const sidecar = migratePdfAnnotationSidecar(JSON.parse(await annotationsEntry.async('string')) as unknown)
    const fingerprintMatched = sidecar.pdfFingerprint.sha256 === resolved.fingerprint.sha256
    if (!fingerprintMatched && payload.attemptRelocation !== true) {
      return {
        ok: false,
        message: 'PDF fingerprint does not match this annotation package.'
      }
    }

    const now = new Date().toISOString()
    const imported = stablePdfAnnotationSidecar({
      ...withResolvedFingerprint(sidecar, resolved),
      updatedAt: now,
      manifest: {
        ...sidecar.manifest,
        sourcePdfName: basename(resolved.pdfPath),
        sourcePdfPath: resolved.pdfPath,
        updatedAt: now
      }
    })
    await writeJsonFile(resolved.defaultSidecarTarget, imported)
    return {
      ok: true,
      sidecar: imported,
      path: resolved.defaultSidecarPath,
      importedAt: now,
      pdfFingerprint: resolved.fingerprint,
      fingerprintMatched,
      warnings: fingerprintMatched ? [] : ['PDF fingerprint mismatch; imported with anchor relocation allowed.']
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
