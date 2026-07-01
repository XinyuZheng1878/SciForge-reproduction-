import { describe, expect, it } from 'vitest'
import { paperRadarDbPath, paperRadarProfilesPath } from './paper-radar-paths'

describe('Paper Radar storage paths', () => {
  it('resolves GUI and MCP storage under the app userData directory', () => {
    expect(paperRadarDbPath('/tmp/sciforge-user-data')).toBe('/tmp/sciforge-user-data/paper-radar/paper-radar.sqlite')
    expect(paperRadarProfilesPath('/tmp/sciforge-user-data')).toBe('/tmp/sciforge-user-data/paper-radar/profiles.json')
  })
})
