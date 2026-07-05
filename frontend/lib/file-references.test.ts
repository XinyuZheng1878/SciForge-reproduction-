import { describe, expect, it } from 'vitest'
import {
  createFileReferenceHref,
  FILE_REFERENCE_SCHEME,
  isFileReferenceHref,
  LEGACY_FILE_REFERENCE_SCHEME,
  parseFileReferenceHref
} from './file-references'

describe('file reference hrefs', () => {
  it('generates neutral SciForge file-reference hrefs', () => {
    const href = createFileReferenceHref({ path: 'src/main.ts', line: 12, column: 4 })

    expect(href.startsWith(FILE_REFERENCE_SCHEME)).toBe(true)
    expect(href.startsWith(LEGACY_FILE_REFERENCE_SCHEME)).toBe(false)
    expect(parseFileReferenceHref(href)).toEqual({
      path: 'src/main.ts',
      line: 12,
      column: 4
    })
  })

  it('still parses legacy DeepSeek file-reference hrefs without generating them', () => {
    const href = `${LEGACY_FILE_REFERENCE_SCHEME}//open?path=src%2Flegacy.ts&line=7`

    expect(isFileReferenceHref(href)).toBe(true)
    expect(parseFileReferenceHref(href)).toEqual({
      path: 'src/legacy.ts',
      line: 7
    })
  })

  it('rejects malformed internal file-reference hrefs', () => {
    expect(isFileReferenceHref(`${FILE_REFERENCE_SCHEME}//open?line=3`)).toBe(true)
    expect(parseFileReferenceHref(`${FILE_REFERENCE_SCHEME}//open?line=3`)).toBeNull()
    expect(isFileReferenceHref('https://example.test/src/main.ts')).toBe(false)
  })
})
