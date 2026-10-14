// 俯视烘焙逐图产物生命周期回归（scripts/bake-overhead-key.mjs；PR #621 re-review P2）：
// 本图失败时，该图上一轮的 <key>.rgba / <key>.meta.json 必须已不存在——composite_overhead.py 只按文件
// 存在与否读取，留着旧成品即会被当作本轮结果合成。伪 page 模拟 /bake 页面的三次 evaluate。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bakeKey } from './bake-overhead-key.mjs'

const SIZE = 4
const KEY = 'faust'
let outDir, uploadPath

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'bake-overhead-key-'))
  uploadPath = join(outDir, 'upload.rgba')
})
afterEach(() => rmSync(outDir, { recursive: true, force: true }))

function seedStale() {
  writeFileSync(join(outDir, `${KEY}.rgba`), Buffer.alloc(SIZE * SIZE * 4, 0xff))   // 上一轮成品（白图）
  writeFileSync(join(outDir, `${KEY}.meta.json`), JSON.stringify({ key: KEY, ground: true }))
}

/** 伪 /bake 页面：load/render/upload 三步；upload 默认把 pixels 写到 uploadPath（同中间件） */
function fakePage({ load = { ok: true, span: 640, ground: true }, pixels = Buffer.alloc(SIZE * SIZE * 4, 7), upload = true } = {}) {
  const calls = []
  return {
    calls,
    async evaluate(expr) {
      calls.push(expr)
      if (expr.startsWith('window.__bake.load(')) {
        if (load instanceof Error) throw load
        return load
      }
      if (expr.startsWith('window.__bake.render(')) return { covered: 16, coverPct: 100 }
      if (expr.startsWith("fetch('/pixel-upload'")) {
        if (upload) writeFileSync(uploadPath, pixels)
        return 'ok'
      }
      throw new Error('unexpected evaluate: ' + expr)
    },
  }
}

const run = (page) => bakeKey({ page, key: KEY, outDir, span: 600, size: SIZE, mapId: 7, uploadPath })
const outputs = () => readdirSync(outDir).filter((f) => f.startsWith(KEY)).sort()

describe('逐图产物 fail-closed：失败 = 本图无产物（含上一轮旧成品）', () => {
  it('预置旧 .rgba/.meta.json + 分层 404 ⇒ reject 且两份旧产物都已删除', async () => {
    seedStale()
    const page = fakePage({ load: new Error('page exception: Error: ground layer 缺失: tile1（HTTP 404）') })
    await expect(run(page)).rejects.toThrow(/ground layer 缺失: tile1/)
    expect(outputs()).toEqual([])
    expect(page.calls).toHaveLength(1)             // load 即失败：未渲染、未上传
  })

  it('地形不完整（load reject）同样不留旧产物', async () => {
    seedStale()
    const page = fakePage({ load: new Error('page exception: Error: terrain 不完整: terrain.json 缺失（HTTP 404）但 terrain.u16.bin 存在') })
    await expect(run(page)).rejects.toThrow(/terrain 不完整/)
    expect(outputs()).toEqual([])
  })

  it('上一张图的 upload.rgba 不得冒充本图：本图上传未落盘 ⇒ pixel upload missing，且无产物', async () => {
    seedStale()
    writeFileSync(uploadPath, Buffer.alloc(SIZE * SIZE * 4, 9))   // 上一张图残留，字节数恰好合规
    await expect(run(fakePage({ upload: false }))).rejects.toThrow('pixel upload missing')
    expect(outputs()).toEqual([])
  })

  it('像素字节数不符 ⇒ reject，且无产物', async () => {
    seedStale()
    await expect(run(fakePage({ pixels: Buffer.alloc(5) }))).rejects.toThrow(`pixel upload 5B != expected ${SIZE * SIZE * 4}B`)
    expect(outputs()).toEqual([])
  })

  it('成功：覆盖旧成品、无 .tmp 残留；meta 携带有效跨度与 ground 标志', async () => {
    seedStale()
    const pixels = Buffer.alloc(SIZE * SIZE * 4, 7)
    const page = fakePage({ pixels })
    const res = await run(page)
    expect(res).toMatchObject({ key: KEY, coverPct: 100 })
    expect(outputs()).toEqual([`${KEY}.meta.json`, `${KEY}.rgba`])
    expect(readFileSync(join(outDir, `${KEY}.rgba`)).equals(pixels)).toBe(true)
    expect(JSON.parse(readFileSync(join(outDir, `${KEY}.meta.json`), 'utf8')))
      .toEqual({ key: KEY, span: 640, size: SIZE, ground: true, covered: 16, coverPct: 100 })
    expect(page.calls[0]).toBe(`window.__bake.load("${KEY}", 600, 7)`)
    expect(page.calls[1]).toBe('window.__bake.render(640)')     // 相机用页面自愈后的有效跨度
    expect(existsSync(join(outDir, `${KEY}.rgba.tmp`))).toBe(false)
  })

  it('ground 只取页面 load 的回报：无地形图写 ground=false', async () => {
    await run(fakePage({ load: { ok: true, span: 600, ground: false } }))
    expect(JSON.parse(readFileSync(join(outDir, `${KEY}.meta.json`), 'utf8')).ground).toBe(false)
  })
})
