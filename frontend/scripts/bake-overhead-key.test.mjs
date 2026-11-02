// 俯视烘焙逐图产物生命周期回归（scripts/bake-overhead-key.mjs；PR #621 re-review P2）：
// 本图失败时，该图上一轮的 <key>.rgba / <key>.meta.json 必须已不存在——composite_overhead.py 只按文件
// 存在与否读取，留着旧成品即会被当作本轮结果合成。伪 page 模拟 /bake 页面的三次 evaluate。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { bakeKey } from './bake-overhead-key.mjs'

const SIZE = 4
const KEY = 'faust'
let outDir, uploadPath, packDir

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'bake-overhead-key-'))
  uploadPath = join(outDir, 'upload.rgba')
  packDir = mkdtempSync(join(tmpdir(), 'bake-overhead-pack-'))
  mkdirSync(join(packDir, 'map', KEY), { recursive: true })
})
afterEach(() => {
  rmSync(outDir, { recursive: true, force: true })
  rmSync(packDir, { recursive: true, force: true })
})

function seedStale() {
  writeFileSync(join(outDir, `${KEY}.rgba`), Buffer.alloc(SIZE * SIZE * 4, 0xff))   // 上一轮成品（白图）
  writeFileSync(join(outDir, `${KEY}.meta.json`), JSON.stringify({ key: KEY, ground: true }))
}

/** 伪 /bake 页面：load/render/upload 三步；upload 默认把 pixels 写到 uploadPath（同中间件）。
 *  pack 给出时模拟 ground-terrain 相：groundTerrain evaluate 把 webp 写到包内最终路径。 */
function fakePage({ load = { ok: true, span: 640, ground: true }, pixels = Buffer.alloc(SIZE * SIZE * 4, 7), upload = true, groundTerrain = true } = {}) {
  const calls = []
  const gtPath = join(packDir, 'map', KEY, 'ground-terrain.webp')
  return {
    calls,
    async evaluate(expr) {
      calls.push(expr)
      if (expr.startsWith('window.__bake.load(')) {
        if (load instanceof Error) throw load
        return load
      }
      if (expr.startsWith('window.__bake.render(')) return { covered: 16, coverPct: 100 }
      if (expr.startsWith('window.__bake.groundTerrain(')) {
        if (groundTerrain === true) {
          mkdirSync(dirname(gtPath), { recursive: true })
          writeFileSync(gtPath, Buffer.from('RIFFgtwebp'))
          return { base: 'karelia', terrainRendered: true, coverPct: 99.5, bytes: 9 }
        }
        if (groundTerrain === false) return null   // 页面合成失败：不落盘
        throw groundTerrain
      }
      if (expr.startsWith("fetch('/pixel-upload'")) {
        if (upload) writeFileSync(uploadPath, pixels)
        return 'ok'
      }
      throw new Error('unexpected evaluate: ' + expr)
    },
  }
}

const run = (page, opts = {}) => bakeKey({ page, key: KEY, outDir, span: 600, size: SIZE, mapId: 7, uploadPath, ...opts })
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

describe('ground-terrain 相（#857 Step 4）：fail-closed 生命周期', () => {
  const gtPath = () => join(packDir, 'map', KEY, 'ground-terrain.webp')
  const gtMetaPath = () => join(outDir, `${KEY}.terrain.meta.json`)
  const seedStaleGt = () => {
    writeFileSync(gtPath(), Buffer.from('old-product'))
    writeFileSync(`${gtPath()}.tmp`, Buffer.from('old-tmp'))
    writeFileSync(gtMetaPath(), JSON.stringify({ key: KEY, groundTerrain: { old: true } }))
  }

  it('成功：webp 落盘包内最终路径，terrain.meta.json 携带合成回报，无 .tmp 残留', async () => {
    seedStaleGt()
    const res = await run(fakePage({}), { pack: packDir, space: 'karelia' })
    expect(res.groundTerrain).toMatchObject({ base: 'karelia', terrainRendered: true, coverPct: 99.5 })
    expect(readFileSync(gtPath(), 'utf8')).toBe('RIFFgtwebp')
    expect(existsSync(`${gtPath()}.tmp`)).toBe(false)
    const meta = JSON.parse(readFileSync(gtMetaPath(), 'utf8'))
    expect(meta).toMatchObject({ key: KEY, span: 640, size: SIZE, groundTerrain: { base: 'karelia' } })
  })

  it('早期失败（load 抛错，未到 groundTerrain 相）：旧 gt/.tmp/terrain.meta 全部已清（清理前移）', async () => {
    seedStaleGt()
    await expect(run(fakePage({ load: new Error('page exception: Error: ground layer 缺失: tile1（HTTP 404）') }), { pack: packDir, space: 'karelia' }))
      .rejects.toThrow(/ground layer 缺失/)
    expect(existsSync(gtPath())).toBe(false)
    expect(existsSync(`${gtPath()}.tmp`)).toBe(false)
    expect(existsSync(gtMetaPath())).toBe(false)
    expect(existsSync(`${gtMetaPath()}.tmp`)).toBe(false)
  })

  it('render 抛错（load 之后、上传之前）：旧 gt/terrain.meta 同样不留', async () => {
    seedStaleGt()
    const page = fakePage({})
    const orig = page.evaluate.bind(page)
    page.evaluate = async (expr) => {
      if (expr.startsWith('window.__bake.render(')) throw new Error('render boom')
      return orig(expr)
    }
    await expect(run(page, { pack: packDir, space: 'karelia' })).rejects.toThrow('render boom')
    expect(existsSync(gtPath())).toBe(false)
    expect(existsSync(gtMetaPath())).toBe(false)
  })

  it('页面合成失败：旧成品已删除、reject、无产物残留（不留旧 ground-terrain）', async () => {
    seedStaleGt()
    await expect(run(fakePage({ groundTerrain: false }), { pack: packDir, space: 'karelia' }))
      .rejects.toThrow('ground-terrain upload missing')
    expect(existsSync(gtPath())).toBe(false)
    expect(existsSync(`${gtPath()}.tmp`)).toBe(false)
  })

  it('页面异常同样 fail-closed', async () => {
    seedStaleGt()
    await expect(run(fakePage({ groundTerrain: new Error('canvas boom') }), { pack: packDir, space: 'karelia' }))
      .rejects.toThrow('canvas boom')
    expect(existsSync(gtPath())).toBe(false)
  })

  it('未传 pack/space（旧调用形态）不进 ground-terrain 相：产物只到 rgba/meta 为止', async () => {
    const res = await run(fakePage({}))
    expect(res.groundTerrain).toBeUndefined()
    expect(existsSync(gtPath())).toBe(false)
    expect(existsSync(gtMetaPath())).toBe(false)
  })
})
