import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeBrowserNavigationUrl } from './browser-cdp-backend.js'

test('browser CDP navigation allows only http and https URLs', () => {
  assert.equal(normalizeBrowserNavigationUrl('example.com/path'), 'https://example.com/path')
  assert.equal(normalizeBrowserNavigationUrl('http://example.com'), 'http://example.com/')
  assert.equal(normalizeBrowserNavigationUrl('https://example.com?q=1'), 'https://example.com/?q=1')
  assert.throws(() => normalizeBrowserNavigationUrl('file:///etc/passwd'), /unsupported url scheme/)
  assert.throws(() => normalizeBrowserNavigationUrl('chrome://settings'), /unsupported url scheme/)
  assert.throws(() => normalizeBrowserNavigationUrl('data:text/html,hello'), /unsupported url scheme/)
})
