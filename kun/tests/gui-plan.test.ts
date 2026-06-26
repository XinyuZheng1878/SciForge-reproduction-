import { describe, expect, it } from 'vitest'
import {
  buildGuiPlanId,
  buildPlanRelativePath,
  GUI_PLAN_RELATIVE_DIR,
  guiPlanWorkspaceMatches,
  isGuiPlanRelativePath,
  normalizeGuiPlanRelativePath,
  nextAvailablePlanRelativePath,
  planDisplayNameFromRelativePath,
  planFeatureNameFromRequest,
  validateCreatePlanToolInput
} from '../src/shared/gui-plan.js'

describe('runtime gui-plan contract', () => {
  it('accepts only direct Markdown files under the current plan directory', () => {
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/login.md`)).toBe(true)
    expect(isGuiPlanRelativePath(`  ${GUI_PLAN_RELATIVE_DIR}/Login.md  `)).toBe(true)
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}\\login.md`)).toBe(true)
    expect(isGuiPlanRelativePath('.legacy/plan/login.md')).toBe(false)
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/nested/login.md`)).toBe(false)
    expect(isGuiPlanRelativePath('../.sciforge/plan/login.md')).toBe(false)
    expect(isGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}/login.txt`)).toBe(false)
  })

  it('normalizes equivalent GUI plan relative path syntax', () => {
    expect(normalizeGuiPlanRelativePath(`  ./${GUI_PLAN_RELATIVE_DIR}\\Login.md  `)).toBe(
      `${GUI_PLAN_RELATIVE_DIR}/Login.md`
    )
    expect(normalizeGuiPlanRelativePath(`${GUI_PLAN_RELATIVE_DIR}//Login.md`)).toBe(
      `${GUI_PLAN_RELATIVE_DIR}/Login.md`
    )
  })

  it('builds sanitized plan paths from raw request text', () => {
    const request = 'Build Login: OAuth / SSO?'
    expect(planFeatureNameFromRequest(request)).toBe('build-login-oauth-sso')
    expect(planFeatureNameFromRequest('做一个登录页')).toBe('做一个登录页')
    expect(buildPlanRelativePath(request)).toBe(`${GUI_PLAN_RELATIVE_DIR}/build-login-oauth-sso.md`)
    expect(buildPlanRelativePath('../')).toBe(`${GUI_PLAN_RELATIVE_DIR}/plan.md`)
    expect(nextAvailablePlanRelativePath(request, [buildPlanRelativePath(request)])).toBe(
      `${GUI_PLAN_RELATIVE_DIR}/build-login-oauth-sso-2.md`
    )
  })

  it('keeps id, display, and input validation behavior stable', () => {
    expect(buildGuiPlanId('/tmp/ws/', `${GUI_PLAN_RELATIVE_DIR}/Login.md`)).toBe(
      `/tmp/ws:${GUI_PLAN_RELATIVE_DIR}/login.md`
    )
    expect(guiPlanWorkspaceMatches('C:\\tmp\\ws', 'c:/tmp/ws/')).toBe(true)
    expect(planDisplayNameFromRelativePath(`${GUI_PLAN_RELATIVE_DIR}/Login.md`)).toBe('login')
    expect(
      validateCreatePlanToolInput({
        markdown: '## plan',
        operation: 'draft',
        plan_relative_path: `${GUI_PLAN_RELATIVE_DIR}/login.md`
      })
    ).toEqual([])
    expect(
      validateCreatePlanToolInput({
        markdown: '## plan',
        operation: 'draft',
        plan_relative_path: '.legacy/plan/login.md'
      })
    ).toContain('plan_relative_path must be a direct Markdown file under .sciforge/plan')
  })
})
