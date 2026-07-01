import { join } from 'node:path'

export function paperRadarDbPath(userDataDir: string): string {
  return join(userDataDir, 'paper-radar', 'paper-radar.sqlite')
}

export function paperRadarProfilesPath(userDataDir: string): string {
  return join(userDataDir, 'paper-radar', 'profiles.json')
}
