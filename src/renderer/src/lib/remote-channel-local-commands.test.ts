import { describe, expect, it } from 'vitest'
import { parseRemoteChannelCommand } from '@shared/remote-channel-commands'
import { isUnsupportedLocalRemoteChannelCommand } from './remote-channel-local-commands'

describe('local remote-channel composer commands', () => {
  it.each([
    '/new',
    '/help',
    '/model',
    '/model auto',
    '/model nope',
    '/mode',
    '/mode agent',
    '/mode nope'
  ])('lets the local composer handle %s', (text) => {
    expect(isUnsupportedLocalRemoteChannelCommand(parseRemoteChannelCommand(text))).toBe(false)
  })

  it.each([
    '/new private',
    '/new research',
    '/attach current',
    '/summary',
    '/detach',
    '/status',
    '/projects',
    '/use project 1',
    '/threads',
    '/use thread 1',
    '/jobs'
  ])('keeps unsupported local command %s from falling through as a message', (text) => {
    expect(isUnsupportedLocalRemoteChannelCommand(parseRemoteChannelCommand(text))).toBe(true)
  })

  it('lets ordinary messages continue to normal scheduling/runtime handling', () => {
    expect(isUnsupportedLocalRemoteChannelCommand(parseRemoteChannelCommand('remind me tomorrow'))).toBe(false)
  })
})
