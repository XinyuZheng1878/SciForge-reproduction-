import assert from 'node:assert/strict'
import test from 'node:test'
import {
  capToolResultImages,
  extractToolResultImages,
  toolResultTextWithoutImages
} from './tool-result-image.js'

test('extracts read-tool and computer-use images', () => {
  assert.deepEqual(
    extractToolResultImages({ kind: 'image', mime_type: 'image/png', data_base64: 'AAA', width: 10 }),
    [{ mimeType: 'image/png', dataBase64: 'AAA', width: 10 }]
  )
  assert.deepEqual(
    extractToolResultImages({
      kind: 'computer_screenshot',
      images: [{ mime_type: 'image/jpeg', data_base64: 'BBB', height: 20 }]
    }),
    [{ mimeType: 'image/jpeg', dataBase64: 'BBB', height: 20 }]
  )
})

test('serializes tool-result text without image payloads', () => {
  const text = toolResultTextWithoutImages({
    kind: 'computer_screenshot',
    note: 'screen',
    images: [{ mime_type: 'image/png', data_base64: 'AAA' }]
  })
  assert.equal(text, '{"kind":"computer_screenshot","note":"screen","images_omitted":1}')
})

test('extracts MCP image content from wrapped computer-use results', () => {
  const output = {
    serverId: 'gui_computer_use',
    toolName: 'computer_use',
    result: {
      content: [
        { type: 'text', text: 'Screenshot is 10x20px.' },
        { type: 'image', data: 'abc123', mimeType: 'image/png' }
      ],
      structuredContent: {
        kind: 'computer_screenshot',
        action: 'screenshot',
        screen: { width: 10, height: 20 },
        images: [{ mime_type: 'image/png', width: 10, height: 20 }]
      }
    }
  }

  assert.deepEqual(extractToolResultImages(output), [{
    mimeType: 'image/png',
    dataBase64: 'abc123',
    width: 10,
    height: 20
  }])
  assert.doesNotMatch(toolResultTextWithoutImages(output), /abc123/)
})

test('caps older image payloads', () => {
  const history = ['A', 'B', 'C'].map((data) => ({
    kind: 'tool_result',
    output: { kind: 'computer_screenshot', images: [{ mime_type: 'image/png', data_base64: data }] }
  }))
  const capped = capToolResultImages(history, 1)
  assert.equal(extractToolResultImages(capped[0]?.output).length, 0)
  assert.equal(extractToolResultImages(capped[1]?.output).length, 0)
  assert.equal(extractToolResultImages(capped[2]?.output)[0]?.dataBase64, 'C')
})
