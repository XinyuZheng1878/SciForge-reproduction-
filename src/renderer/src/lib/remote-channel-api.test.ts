import { describe, expect, it, vi } from 'vitest'
import type { SciForgeApi } from '@shared/sciforge-api'
import {
  createRemoteChannelTaskFromTextApi,
  mirrorRemoteChannelMessageApi,
  onRemoteChannelActivityApi,
  pollConnectPhoneInstallApi,
  startConnectPhoneInstallQrApi,
  updateRemoteChannelActiveThreadContextApi
} from './remote-channel-api'

describe('remote-channel api selectors', () => {
  it('prefers neutral connect-phone and remote-channel APIs', () => {
    const api = {
      startConnectPhoneInstallQr: vi.fn(),
      pollConnectPhoneInstall: vi.fn(),
      onRemoteChannelActivity: vi.fn(),
      updateRemoteChannelActiveThreadContext: vi.fn(),
      mirrorRemoteChannelMessage: vi.fn(),
      createRemoteChannelTaskFromText: vi.fn()
    } as unknown as SciForgeApi

    expect(startConnectPhoneInstallQrApi(api)).toBe(api.startConnectPhoneInstallQr)
    expect(pollConnectPhoneInstallApi(api)).toBe(api.pollConnectPhoneInstall)
    expect(onRemoteChannelActivityApi(api)).toBe(api.onRemoteChannelActivity)
    expect(updateRemoteChannelActiveThreadContextApi(api)).toBe(api.updateRemoteChannelActiveThreadContext)
    expect(mirrorRemoteChannelMessageApi(api)).toBe(api.mirrorRemoteChannelMessage)
    expect(createRemoteChannelTaskFromTextApi(api)).toBe(api.createRemoteChannelTaskFromText)
  })

  it('does not create renderer fallbacks for removed Claw APIs', () => {
    const api = {} as unknown as SciForgeApi

    expect(startConnectPhoneInstallQrApi(api)).toBeUndefined()
    expect(pollConnectPhoneInstallApi(api)).toBeUndefined()
    expect(onRemoteChannelActivityApi(api)).toBeUndefined()
    expect(updateRemoteChannelActiveThreadContextApi(api)).toBeUndefined()
    expect(mirrorRemoteChannelMessageApi(api)).toBeUndefined()
    expect(createRemoteChannelTaskFromTextApi(api)).toBeUndefined()
  })
})
