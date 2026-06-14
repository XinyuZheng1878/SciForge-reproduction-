import { describe, expect, it } from 'vitest'
import { OutputAccumulator } from '../src/adapters/tool/output-accumulator.js'

function createAccumulator(): OutputAccumulator {
  return new OutputAccumulator({
    maxLines: 200,
    maxBytes: 20_000,
    tempFilePrefix: 'kun-output-test'
  })
}

describe('OutputAccumulator', () => {
  it('decodes UTF-8 command output', () => {
    const output = createAccumulator()

    output.append(Buffer.from('hello\n世界', 'utf8'))
    output.finish()

    expect(output.snapshot().content).toBe('hello\n世界')
  })

  it('decodes UTF-16LE command output from Windows PowerShell pipes', () => {
    const output = createAccumulator()

    output.append(Buffer.from('Start-Process\r\n浏览.html', 'utf16le'))
    output.finish()

    expect(output.snapshot().content).toBe('Start-Process\r\n浏览.html')
  })

  it('decodes UTF-16LE command output without ASCII NUL bytes', () => {
    const output = createAccumulator()

    output.append(Buffer.from('测试', 'utf16le'))
    output.finish()

    expect(output.snapshot().content).toBe('测试')
  })

  it('previews short pending output before finish', () => {
    const utf8 = createAccumulator()
    utf8.append(Buffer.from('hi', 'utf8'))
    expect(utf8.snapshot()).toMatchObject({
      content: 'hi',
      truncation: {
        totalLines: 1,
        totalBytes: 2
      }
    })

    const utf16 = createAccumulator()
    utf16.append(Buffer.from('测试', 'utf16le'))
    expect(utf16.snapshot()).toMatchObject({
      content: '测试',
      truncation: {
        totalLines: 1,
        totalBytes: Buffer.byteLength('测试', 'utf8')
      }
    })
  })
})
