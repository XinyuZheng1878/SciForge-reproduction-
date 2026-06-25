import { describe, expect, it } from 'vitest'
import {
  buildPaperRadarLaunch,
  isPaperRadarServiceHealth,
  paperRadarBaseUrl,
  paperRadarDbPath,
  paperRadarProfilesPath
} from './paper-radar-sidecar'

describe('Paper Radar sidecar launch', () => {
  it('builds an on-demand dev workspace launch with local storage paths', () => {
    const launch = buildPaperRadarLaunch({
      userDataDir: '/tmp/sciforge-user-data',
      appRoot: '/repo/sciforge',
      env: {},
      npmCommand: 'npm'
    })

    expect(launch.command).toBe('npm')
    expect(launch.cwd).toBe('/repo/sciforge')
    expect(launch.args).toEqual([
      '--workspace',
      'sciforge-paper-radar-service',
      'run',
      'start'
    ])
    expect(launch.baseUrl).toBe('http://127.0.0.1:3901')
    expect(launch.dbPath).toBe(paperRadarDbPath('/tmp/sciforge-user-data'))
    expect(launch.profilesPath).toBe(paperRadarProfilesPath('/tmp/sciforge-user-data'))
    expect(launch.env.PAPER_RADAR_HOST).toBe('127.0.0.1')
    expect(launch.env.PAPER_RADAR_PORT).toBe('3901')
    expect(launch.env.PAPER_RADAR_AUTO_SYNC).toBe('0')
  })

  it('normalizes configured base URLs', () => {
    expect(paperRadarBaseUrl({ PAPER_RADAR_SERVICE_URL: 'http://127.0.0.1:3902///' })).toBe('http://127.0.0.1:3902')
  })

  it('uses explicit storage env overrides when provided', () => {
    const launch = buildPaperRadarLaunch({
      userDataDir: '/tmp/sciforge-user-data',
      appRoot: '/repo/sciforge',
      env: {
        PAPER_RADAR_SERVICE_URL: 'http://127.0.0.1:3905',
        PAPER_RADAR_DB: '/tmp/custom-paper-radar.sqlite',
        PAPER_RADAR_PROFILES: '/tmp/custom-paper-radar-profiles.json',
        PAPER_RADAR_AUTO_SYNC: '1'
      } as NodeJS.ProcessEnv,
      npmCommand: 'npm'
    })

    expect(launch.baseUrl).toBe('http://127.0.0.1:3905')
    expect(launch.dbPath).toBe('/tmp/custom-paper-radar.sqlite')
    expect(launch.profilesPath).toBe('/tmp/custom-paper-radar-profiles.json')
    expect(launch.env.PAPER_RADAR_DB).toBe('/tmp/custom-paper-radar.sqlite')
    expect(launch.env.PAPER_RADAR_PROFILES).toBe('/tmp/custom-paper-radar-profiles.json')
    expect(launch.env.PAPER_RADAR_PORT).toBe('3905')
    expect(launch.env.PAPER_RADAR_AUTO_SYNC).toBe('1')
  })

  it('accepts only the Paper Radar service health identity', () => {
    expect(isPaperRadarServiceHealth({ ok: true, service: 'sciforge.paper-radar' })).toBe(true)
    expect(isPaperRadarServiceHealth({ ok: true, service: 'legacy.paper-radar' })).toBe(false)
    expect(isPaperRadarServiceHealth({ ok: true })).toBe(false)
    expect(isPaperRadarServiceHealth({ ok: false, service: 'sciforge.paper-radar' })).toBe(false)
  })
})
