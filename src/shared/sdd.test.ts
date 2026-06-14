import { describe, expect, it } from 'vitest'
import {
  SDD_DRAFT_FILE_NAME,
  SDD_IMAGE_RELATIVE_DIR,
  buildSddDraftRelativePath,
  buildLegacySddDraftRelativePath,
  isSddDraftRelativePath,
  isSddImageRelativePath,
  normalizeSddRelativePath,
  sddDraftRelativePathForPlanPath,
  sddDraftTraceRelativePath,
  sddUnitImageDir
} from './sdd'

describe('sdd shared paths', () => {
  it('builds a canonical draft requirement path', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    expect(buildSddDraftRelativePath(id)).toBe(`.deepseekgui/sdd/requirements/${id}/${SDD_DRAFT_FILE_NAME}`)
  })

  it('validates current and legacy uuid-backed requirement drafts', () => {
    expect(isSddDraftRelativePath('.deepseekgui/sdd/requirements/123e4567-e89b-12d3-a456-426614174000/requirement.md')).toBe(true)
    expect(isSddDraftRelativePath('.kunsdd/draft/123e4567-e89b-12d3-a456-426614174000/requirement.md')).toBe(true)
    expect(isSddDraftRelativePath('.kunsdd/draft/not-a-uuid/requirement.md')).toBe(false)
    expect(isSddDraftRelativePath('.kunsdd/draft/123e4567-e89b-12d3-a456-426614174000/other.md')).toBe(false)
    expect(isSddDraftRelativePath('.kunsdd/draft/123e4567-e89b-12d3-a456-426614174000/nested/requirement.md')).toBe(false)
  })

  it('normalizes separators before image validation', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    expect(normalizeSddRelativePath('./.deepseekgui\\sdd\\requirements\\123e4567-e89b-12d3-a456-426614174000\\img\\wireframe.png')).toBe(`.deepseekgui/sdd/requirements/${id}/img/wireframe.png`)
    expect(isSddImageRelativePath(`.deepseekgui/sdd/requirements/${id}/img/wireframe.png`)).toBe(true)
    expect(isSddImageRelativePath(`.deepseekgui/sdd/requirements/${id}/img/nested/wireframe.png`)).toBe(true)
    expect(isSddImageRelativePath(`.deepseekgui/sdd/requirements/${id}/img/../escape.png`)).toBe(false)
    expect(isSddImageRelativePath(`${SDD_IMAGE_RELATIVE_DIR}/wireframe.png`)).toBe(false)
    expect(isSddImageRelativePath('.kunsdd/img/legacy.png')).toBe(true)
    expect(isSddImageRelativePath('img/wireframe.png')).toBe(false)
  })

  it('derives unit paths without migrating legacy drafts', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    const current = buildSddDraftRelativePath(id)
    const legacy = buildLegacySddDraftRelativePath(id)

    expect(sddUnitImageDir(current)).toBe(`.deepseekgui/sdd/requirements/${id}/img`)
    expect(sddDraftTraceRelativePath(current)).toBe(`.deepseekgui/sdd/requirements/${id}/trace.json`)
    expect(sddUnitImageDir(legacy)).toBe('.kunsdd/img')
    expect(sddDraftTraceRelativePath(legacy)).toBeNull()
  })

  it('maps SDD plan paths back to current or legacy drafts', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    expect(sddDraftRelativePathForPlanPath(`.deepseekgui/plan/sdd-${id}.md`)).toBe(
      `.deepseekgui/sdd/requirements/${id}/requirement.md`
    )
    expect(sddDraftRelativePathForPlanPath(`.kunsdd/plan/sdd-${id}.md`)).toBe(
      `.kunsdd/draft/${id}/requirement.md`
    )
    expect(sddDraftRelativePathForPlanPath('.deepseekgui/plan/other.md')).toBeNull()
  })
})
