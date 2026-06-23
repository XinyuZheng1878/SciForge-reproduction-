/**
 * Host computer-use executor adapted from upstream Kun. It captures the
 * screen and injects mouse / keyboard input on the host OS via
 * `@computer-use/nut-js`, with `jimp` used to downscale screenshots.
 *
 * The native modules are loaded lazily so this worker can start on platforms
 * where host automation is unavailable; diagnostics report the missing piece
 * instead of failing the whole MCP server.
 */

export type HostControlAvailability = { available: boolean; reason?: string }

export type HostScreenshot = {
  mimeType: string
  dataBase64: string
  width: number
  height: number
}

export type ScrollDirection = 'up' | 'down' | 'left' | 'right'
export type MouseButton = 'left' | 'right' | 'middle'

type ScreenContext = {
  logicalWidth: number
  logicalHeight: number
  scaleX: number
  scaleY: number
}

type NutImage = {
  toRGB(): Promise<{
    data: ArrayBufferLike
    width: number
    height: number
    pixelDensity: { scaleX: number; scaleY: number }
  }>
  toBGR(): Promise<{
    width: number
    height: number
    pixelDensity: { scaleX: number; scaleY: number }
  }>
}

type NutPoint = unknown
type NutApi = {
  screen: { grab(): Promise<NutImage> }
  mouse: {
    move(target: unknown): Promise<unknown>
    click(button: unknown): Promise<unknown>
    doubleClick(button: unknown): Promise<unknown>
    drag(target: unknown): Promise<unknown>
    scrollUp(amount: number): Promise<unknown>
    scrollDown(amount: number): Promise<unknown>
    scrollLeft(amount: number): Promise<unknown>
    scrollRight(amount: number): Promise<unknown>
    getPosition(): Promise<{ x: number; y: number }>
  }
  keyboard: {
    type(text: string): Promise<unknown>
    pressKey(...keys: unknown[]): Promise<unknown>
    releaseKey(...keys: unknown[]): Promise<unknown>
    config: { autoDelayMs: number }
  }
  clipboard?: { getContent(): Promise<string>; setContent(text: string): Promise<unknown> }
  Button: { LEFT: unknown; RIGHT: unknown; MIDDLE: unknown }
  Key: Record<string, unknown>
  Point: new (x: number, y: number) => NutPoint
  straightTo(point: NutPoint): unknown
  sleep(ms: number): Promise<void>
}

type JimpImage = {
  resize(opts: { w: number; h: number }): JimpImage
  getBuffer(mime: string): Promise<Buffer>
}
type JimpModule = {
  Jimp: { fromBitmap(bitmap: { width: number; height: number; data: Buffer }): Promise<JimpImage> }
}

export type HostControllerOptions = {
  maxImageDimension?: number
  imageMimeType?: 'image/png' | 'image/jpeg'
}

const DEFAULT_MAX_IMAGE_DIMENSION = 1280
const SCROLL_UNITS_PER_CLICK = 3

export function computeDisplayDims(
  logicalWidth: number,
  logicalHeight: number,
  maxDimension: number
): { width: number; height: number; scale: number } {
  const longest = Math.max(logicalWidth, logicalHeight)
  const scale = longest > maxDimension ? maxDimension / longest : 1
  return {
    width: Math.max(1, Math.round(logicalWidth * scale)),
    height: Math.max(1, Math.round(logicalHeight * scale)),
    scale
  }
}

export function mapDisplayToLogical(
  x: number,
  y: number,
  logicalWidth: number,
  logicalHeight: number,
  maxDimension: number
): { x: number; y: number } {
  const display = computeDisplayDims(logicalWidth, logicalHeight, maxDimension)
  const lx = display.scale > 0 ? x / display.scale : x
  const ly = display.scale > 0 ? y / display.scale : y
  return {
    x: clamp(Math.round(lx), 0, Math.max(0, logicalWidth - 1)),
    y: clamp(Math.round(ly), 0, Math.max(0, logicalHeight - 1))
  }
}

async function loadModule<T>(specifier: string): Promise<T | null> {
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>
    const def = mod.default
    if (def && typeof def === 'object') {
      return { ...(def as Record<string, unknown>), ...mod } as T
    }
    return mod as unknown as T
  } catch {
    return null
  }
}

export class HostController {
  private nut: NutApi | null = null
  private jimp: JimpModule | null = null
  private loadAttempted = false
  private loadReason?: string
  private screen: ScreenContext | null = null
  private readonly maxDimension: number
  private readonly imageMimeType: 'image/png' | 'image/jpeg'

  constructor(options: HostControllerOptions = {}) {
    this.maxDimension = Math.max(320, Math.floor(options.maxImageDimension ?? DEFAULT_MAX_IMAGE_DIMENSION))
    this.imageMimeType = options.imageMimeType ?? 'image/png'
  }

  async ensureReady(): Promise<HostControlAvailability> {
    if (!this.loadAttempted) {
      this.loadAttempted = true
      const nut = await loadModule<NutApi>('@computer-use/nut-js')
      const jimp = await loadModule<JimpModule>('jimp')
      if (!nut || typeof nut.screen?.grab !== 'function') {
        this.loadReason = 'native automation module @computer-use/nut-js is not installed for this platform'
      } else if (!jimp || typeof jimp.Jimp?.fromBitmap !== 'function') {
        this.loadReason = 'image module jimp is not installed'
      } else {
        this.nut = nut
        this.jimp = jimp
        nut.keyboard.config.autoDelayMs = 0
      }
    }
    return this.nut && this.jimp
      ? { available: true }
      : { available: false, reason: this.loadReason ?? 'computer-use backend is unavailable' }
  }

  private requireNut(): NutApi {
    if (!this.nut) throw new Error(this.loadReason ?? 'computer-use backend is unavailable')
    return this.nut
  }

  private async screenContext(): Promise<ScreenContext> {
    if (this.screen) return this.screen
    const nut = this.requireNut()
    const grab = await nut.screen.grab()
    const bgr = await grab.toBGR()
    return this.setScreenFromFrame(bgr.width, bgr.height, bgr.pixelDensity)
  }

  private setScreenFromFrame(
    physicalWidth: number,
    physicalHeight: number,
    pixelDensity: { scaleX: number; scaleY: number } | undefined
  ): ScreenContext {
    const scaleX = pixelDensity?.scaleX || 1
    const scaleY = pixelDensity?.scaleY || 1
    this.screen = {
      logicalWidth: Math.max(1, Math.round(physicalWidth / scaleX)),
      logicalHeight: Math.max(1, Math.round(physicalHeight / scaleY)),
      scaleX,
      scaleY
    }
    return this.screen
  }

  private displayDims(ctx: ScreenContext): { width: number; height: number; scale: number } {
    return computeDisplayDims(ctx.logicalWidth, ctx.logicalHeight, this.maxDimension)
  }

  private async toLogical(x: number, y: number): Promise<{ x: number; y: number }> {
    const ctx = await this.screenContext()
    return mapDisplayToLogical(x, y, ctx.logicalWidth, ctx.logicalHeight, this.maxDimension)
  }

  async screenSize(): Promise<{ width: number; height: number }> {
    const ctx = await this.screenContext()
    const display = this.displayDims(ctx)
    return { width: display.width, height: display.height }
  }

  async capture(): Promise<HostScreenshot> {
    const nut = this.requireNut()
    const jimp = this.jimp!
    const grab = await nut.screen.grab()
    const rgb = await grab.toRGB()
    const ctx = this.setScreenFromFrame(rgb.width, rgb.height, rgb.pixelDensity)
    const display = this.displayDims(ctx)
    const image = await jimp.Jimp.fromBitmap({
      width: rgb.width,
      height: rgb.height,
      data: Buffer.from(rgb.data)
    })
    const buffer = await image.resize({ w: display.width, h: display.height }).getBuffer(this.imageMimeType)
    return {
      mimeType: this.imageMimeType,
      dataBase64: buffer.toString('base64'),
      width: display.width,
      height: display.height
    }
  }

  async cursorPosition(): Promise<{ x: number; y: number }> {
    const nut = this.requireNut()
    const ctx = await this.screenContext()
    const display = this.displayDims(ctx)
    const pos = await nut.mouse.getPosition()
    return {
      x: clamp(Math.round(pos.x * display.scale), 0, display.width - 1),
      y: clamp(Math.round(pos.y * display.scale), 0, display.height - 1)
    }
  }

  async moveTo(x: number, y: number): Promise<void> {
    const nut = this.requireNut()
    const point = await this.toLogical(x, y)
    await nut.mouse.move(nut.straightTo(new nut.Point(point.x, point.y)))
  }

  async click(
    x: number | undefined,
    y: number | undefined,
    button: MouseButton = 'left',
    count: 1 | 2 = 1,
    modifiers: string[] = []
  ): Promise<void> {
    const nut = this.requireNut()
    if (typeof x === 'number' && typeof y === 'number') {
      await this.moveTo(x, y)
      await nut.sleep(80)
    }
    const nutButton =
      button === 'right' ? nut.Button.RIGHT : button === 'middle' ? nut.Button.MIDDLE : nut.Button.LEFT
    const modKeys = modifiers.length ? this.resolveKeys(modifiers.join('+')) : []
    if (modKeys.length) await nut.keyboard.pressKey(...modKeys)
    try {
      if (count === 2) await nut.mouse.doubleClick(nutButton)
      else await nut.mouse.click(nutButton)
    } finally {
      if (modKeys.length) await nut.keyboard.releaseKey(...modKeys)
    }
  }

  async drag(x1: number, y1: number, x2: number, y2: number): Promise<void> {
    const nut = this.requireNut()
    await this.moveTo(x1, y1)
    await nut.sleep(100)
    const end = await this.toLogical(x2, y2)
    await nut.mouse.drag(nut.straightTo(new nut.Point(end.x, end.y)))
  }

  async scroll(
    x: number | undefined,
    y: number | undefined,
    direction: ScrollDirection,
    amount = 3
  ): Promise<void> {
    const nut = this.requireNut()
    if (typeof x === 'number' && typeof y === 'number') await this.moveTo(x, y)
    const ticks = Math.max(1, Math.round(amount)) * SCROLL_UNITS_PER_CLICK
    switch (direction) {
      case 'up':
        await nut.mouse.scrollUp(ticks)
        break
      case 'down':
        await nut.mouse.scrollDown(ticks)
        break
      case 'left':
        await nut.mouse.scrollLeft(ticks)
        break
      case 'right':
        await nut.mouse.scrollRight(ticks)
        break
    }
  }

  async typeText(text: string): Promise<void> {
    const nut = this.requireNut()
    if (!text) return
    const trailingNewline = /\n$/.test(text)
    const body = text.replace(/\n$/, '')
    if (process.platform === 'win32' && nut.clipboard) {
      const original = await safe(() => nut.clipboard!.getContent())
      await nut.clipboard.setContent(body)
      const paste = this.resolveKeys('ctrl+v')
      await nut.keyboard.pressKey(...paste)
      await nut.sleep(50)
      await nut.keyboard.releaseKey(...paste)
      await nut.sleep(50)
      if (typeof original === 'string') await safe(() => nut.clipboard!.setContent(original))
    } else {
      await nut.keyboard.type(body)
    }
    if (trailingNewline) await this.pressHotkey('return')
  }

  async pressHotkey(keyStr: string): Promise<void> {
    const nut = this.requireNut()
    const keys = this.resolveKeys(keyStr)
    if (keys.length === 0) throw new Error(`unsupported key combination: ${keyStr}`)
    await nut.keyboard.pressKey(...keys)
    await nut.keyboard.releaseKey(...keys)
  }

  async wait(ms: number, signal?: AbortSignal): Promise<void> {
    const clamped = Math.max(0, Math.min(ms, 60_000))
    if (clamped === 0 || signal?.aborted) return
    await new Promise<void>((resolve) => {
      const cleanup = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      const onAbort = (): void => {
        cleanup()
        resolve()
      }
      const timer = setTimeout(() => {
        cleanup()
        resolve()
      }, clamped)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  private resolveKeys(keyStr: string): unknown[] {
    const nut = this.requireNut()
    const cmd = process.platform === 'darwin' ? nut.Key.LeftCmd : nut.Key.LeftSuper
    const ctrl = nut.Key.LeftControl
    const aliases: Record<string, unknown> = {
      ctrl,
      control: ctrl,
      shift: nut.Key.LeftShift,
      alt: nut.Key.LeftAlt,
      option: nut.Key.LeftAlt,
      meta: cmd,
      cmd,
      command: cmd,
      super: nut.Key.LeftSuper,
      win: nut.Key.LeftSuper,
      return: nut.Key.Enter,
      enter: nut.Key.Enter,
      esc: nut.Key.Escape,
      escape: nut.Key.Escape,
      del: nut.Key.Delete,
      delete: nut.Key.Delete,
      backspace: nut.Key.Backspace,
      tab: nut.Key.Tab,
      space: nut.Key.Space,
      up: nut.Key.Up,
      down: nut.Key.Down,
      left: nut.Key.Left,
      right: nut.Key.Right,
      arrowup: nut.Key.Up,
      arrowdown: nut.Key.Down,
      arrowleft: nut.Key.Left,
      arrowright: nut.Key.Right,
      pagedown: nut.Key.PageDown,
      pageup: nut.Key.PageUp,
      home: nut.Key.Home,
      end: nut.Key.End,
      ',': nut.Key.Comma,
      '.': nut.Key.Period,
      '-': nut.Key.Minus,
      '=': nut.Key.Equal,
      '/': nut.Key.Slash,
      ';': nut.Key.Semicolon,
      "'": nut.Key.Quote,
      '[': nut.Key.LeftBracket,
      ']': nut.Key.RightBracket,
      '\\': nut.Key.Backslash,
      '`': nut.Key.Grave
    }
    const lowerKeyTable: Record<string, unknown> = {}
    for (const [name, code] of Object.entries(nut.Key)) lowerKeyTable[name.toLowerCase()] = code
    const tokens = keyStr
      .split(/[\s+]+/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
    const resolved: unknown[] = []
    for (const part of tokens) {
      const code = aliases[part] ?? lowerKeyTable[part] ?? lowerKeyTable[`num${part}`]
      if (code === undefined) {
        throw new Error(`unsupported key token "${part}" in combination "${keyStr}"`)
      }
      resolved.push(code)
    }
    return resolved
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.max(min, Math.min(max, value))
}

async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch {
    return undefined
  }
}
