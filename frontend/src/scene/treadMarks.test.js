import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GENERIC_TREAD_TEXTURE, TREAD_FALLBACK, advanceTrail, createTrailState,
  resetTrailState, resolveTreadParams, trailQuadCorners, treadAlphaAt,
  TRAIL_LIFT, TRAIL_OVERLAP, TREAD_FADE,
} from './treadMarks.js'

const here = dirname(fileURLToPath(import.meta.url))
const sceneSrc = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')

describe('treadMarks 接线守卫（playbackScene 源码级，sceneryMaterials.test.js 同风格）', () => {
  it('tick() 必须驱动游标泵 updateTrails()（否则印记只在 seek 时出现）', () => {
    expect(sceneSrc).toMatch(/updateDestructibles\(T\);\s*\n\s*updateTrails\(\);/)
  })
  it('开关必须经场景 API 落到 store.treadOn（唯一 owner，不得在组件里另立状态）', () => {
    expect(sceneSrc).toMatch(/setTreadMarks: \(on\) => \{ store\.treadOn = !!on; invalidate\(\); \}/)
  })
  it('teardown 必须释放逐车 treadMesh 几何/材质与会话级贴图缓存（显存生命周期同会话）', () => {
    expect(sceneSrc).toMatch(/v\.treadMesh\.geometry\.dispose\(\)/)
    expect(sceneSrc).toMatch(/v\.treadMesh\.material\.dispose\(\)/)
    expect(sceneSrc).toMatch(/for \(const tex of treadTexCache\.values\(\)\) tex\.dispose\(\)/)
  })
})

/** 直线路径采样点：从 (x0,z0) 沿单位方向 (dx,dz) 走 step × n 米（t = 采样序号） */
function line(x0, z0, dx, dz, step, n) {
  const pts = []
  for (let i = 0; i <= n; i++) pts.push({ x: x0 + dx * step * i, z: z0 + dz * step * i, t: i })
  return pts
}

describe('resolveTreadParams', () => {
  it('authored json 逐字段透出，texture 归一化为带前导斜杠的资产路径', () => {
    const p = resolveTreadParams({ texture: 'tread/textures/USSR_01_tread.webp', manual_width: 0.835616, manual_space: 1.0 })
    expect(p).toEqual({ texture: '/tread/textures/USSR_01_tread.webp', width: 0.835616, space: 1.0, authored: true })
    // 已带斜杠的形状不双写
    expect(resolveTreadParams({ texture: '/tread/textures/X.webp' }).texture).toBe('/tread/textures/X.webp')
  })
  it('无数据 → 客户端通用贴图 + 产品回落值', () => {
    expect(resolveTreadParams(null)).toEqual({
      texture: GENERIC_TREAD_TEXTURE, width: TREAD_FALLBACK.width, space: TREAD_FALLBACK.space, authored: false,
    })
  })
  it('坏数值逐字段回落（不整条拒绝）', () => {
    const p = resolveTreadParams({ texture: '', manual_width: -1, manual_space: Number.NaN })
    expect(p.texture).toBe(GENERIC_TREAD_TEXTURE)
    expect(p.width).toBe(TREAD_FALLBACK.width)
    expect(p.space).toBe(TREAD_FALLBACK.space)
    expect(p.authored).toBe(true)
  })
})

describe('advanceTrail', () => {
  it('直线 10 m / space 1.0 → 10 段，段中心在 0.5,1.5,…,9.5，方向 = 运动方向', () => {
    const st = createTrailState()
    const added = advanceTrail(st, line(0, 0, 1, 0, 1, 10), 1.0, 1e9)
    expect(added).toBe(10)
    expect(st.segs.map((s) => s.x)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5])
    for (const s of st.segs) { expect(s.dx).toBeCloseTo(1); expect(s.dz).toBeCloseTo(0); expect(s.len).toBe(1.0) }
    expect(st.segs[0].t).toBe(1)          // 段携带出段时刻（寿命淡出用）
  })
  it('首步只作锚点不出段；累积凑满 space 后出一段', () => {
    const st = createTrailState()
    expect(advanceTrail(st, [{ x: 0, z: 0 }, { x: 0.6, z: 0 }], 1.0, 1e9)).toBe(0)   // 累计 0.6
    expect(advanceTrail(st, [{ x: 1.2, z: 0 }], 1.0, 1e9)).toBe(1)                   // 累计 1.2 → 第 1 段
    // 段中心 = 累计 1.0 处：本步内 at=0.4、回退 min(0.5, 0.4)=0.4 ⇒ x = 1.2−0.4
    expect(st.segs[0].x).toBeCloseTo(0.8)
    expect(st.segs[0].len).toBe(1.0)
  })
  it('采样粒度只影响段内相位（±space/2），不影响段数', () => {
    const st = createTrailState()
    advanceTrail(st, line(0, 0, 1, 0, 0.1, 10), 1.0, 1e9)           // 10 小步走 1 m
    const big = createTrailState()
    advanceTrail(big, [{ x: 0, z: 0 }, { x: 1, z: 0 }], 1.0, 1e9)   // 一步 1 m
    expect(big.segs.length).toBe(st.segs.length)
    expect(Math.abs(big.segs[0].x - st.segs[0].x)).toBeLessThanOrEqual(0.5 + 1e-9)
  })
  it('边界抖动防护：步长带 ~1e-10 抖动时同一整数界不得重复出段（2026-10-11 定案）', () => {
    // 复现现场：插值点位使每步 d = 0.5 − 1e-10（累计 acc 落在整数界下 1e-9 内）——
    // 旧实现 floor(acc/space)+1 对下一个半步仍算出同一 j，配合 +1e-9 容差把同一段发两次
    // （实测 20 m 窗口发 27~29 段、轨迹出现不规则双段/深浅不均）。修复后每边界只发一次。
    const st = createTrailState()
    const step = 0.5 - 1e-10
    const pts = []
    for (let i = 0; i < 10; i++) pts.push({ x: i * step, z: 0, t: i })
    const added = advanceTrail(st, pts, 1.0, 1e9)
    // 总里程 = 9 × (0.5 − 1e-10) ≈ 4.5 − 1e-9 ⇒ 精确跨越边界 1..4
    expect(added).toBe(4)
    expect(st.total).toBe(4)
    expect(st.segs.every((sg) => Number.isFinite(sg.x))).toBe(true)
  })

  it('环形上限：覆写最老槽位（槽位 = 绝对序号 % cap），total 持续累计', () => {
    const st = createTrailState()
    const added = advanceTrail(st, line(0, 0, 1, 0, 1, 12), 1.0, 10)
    expect(added).toBe(12)
    expect(st.total).toBe(12)
    expect(st.segs.length).toBe(10)
    expect(st.head).toBe(2)                       // 下一覆写槽 = 12 % 10
    // 槽位不变量：segs[k % cap] = 绝对序号 k 的段（老段被覆写、新段照常可寻址）
    expect(st.segs[0].x).toBeCloseTo(10.5)        // 槽 0 已被绝对序号 10 覆写
    expect(st.segs[1].x).toBeCloseTo(11.5)        // 槽 1 = 绝对序号 11
    expect(st.segs[7].x).toBeCloseTo(7.5)         // 槽 7 仍是绝对序号 7
    expect(st.segs[11 % 10].x).toBeCloseTo(11.5)
  })
  it('转向：段方向跟随本步位移（不经 yaw 约定）', () => {
    const st = createTrailState()
    advanceTrail(st, [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }], 1.0, 1e9)
    const last = st.segs[st.segs.length - 1]
    expect(last.dz).toBeCloseTo(1)
    expect(last.dx).toBeCloseTo(0)
  })
  it('space 非法 / 零位移步 → 不出段不漂移', () => {
    const st = createTrailState()
    expect(advanceTrail(st, line(0, 0, 1, 0, 1, 5), 0, 1e9)).toBe(0)
    expect(advanceTrail(st, [{ x: 3, z: 0 }, { x: 3, z: 0 }], 1.0, 1e9)).toBe(0)
  })
  it('seek 重算确定性：全量一次 == （走到 k、复位、重走到 k）', () => {
    const a = createTrailState()
    advanceTrail(a, line(0, 0, 0.6, 0.8, 0.7, 20), 1.0, 1e9)
    const b = createTrailState()
    advanceTrail(b, line(0, 0, 0.6, 0.8, 0.7, 8), 1.0, 1e9)
    resetTrailState(b)
    advanceTrail(b, line(0, 0, 0.6, 0.8, 0.7, 20), 1.0, 1e9)
    expect(b.segs).toEqual(a.segs)
    expect(b.total).toBe(a.total)
    expect(b.written).toBe(0)                     // 复位归零消费侧书签
  })
})

describe('treadAlphaAt', () => {
  it('after 前恒 1；after→after+dur 线性降；之后 0', () => {
    expect(treadAlphaAt(0)).toBe(1)
    expect(treadAlphaAt(TREAD_FADE.after)).toBe(1)
    const mid = TREAD_FADE.after + TREAD_FADE.dur / 2
    expect(treadAlphaAt(mid)).toBeCloseTo(0.5)
    expect(treadAlphaAt(TREAD_FADE.after + TREAD_FADE.dur)).toBe(0)
    expect(treadAlphaAt(TREAD_FADE.after + TREAD_FADE.dur + 100)).toBe(0)
  })
  it('负年龄（seek 边界时钟早于出段）按 1 处理（fail-safe 不闪烁）', () => {
    expect(treadAlphaAt(-5)).toBe(1)
  })
})

describe('trailQuadCorners', () => {
  const flat = () => 0
  it('平地：四角 = 中心 ± 横/纵半宽，逐角 y = 地形 + TRAIL_LIFT', () => {
    const out = new Float32Array(12)
    const ok = trailQuadCorners({ x: 5, z: 7, dx: 0, dz: 1, len: 1.0 }, 0.8, flat, out)
    expect(ok).toBe(true)
    const hl = 1.0 * TRAIL_OVERLAP / 2
    // 角序 (-横,-纵) (+横,-纵) (+横,+纵) (-横,+纵)；横向 r = (−uz, ux) = (−1,0)
    const expectCorner = (i, dx, dz) => {
      expect(out[i * 3]).toBeCloseTo(5 + dx)
      expect(out[i * 3 + 1]).toBeCloseTo(TRAIL_LIFT)
      expect(out[i * 3 + 2]).toBeCloseTo(7 + dz)
    }
    expectCorner(0, 0.4, -hl)
    expectCorner(1, -0.4, -hl)
    expectCorner(2, -0.4, hl)
    expectCorner(3, 0.4, hl)
  })
  it('横坡（h=x）：四角各自落到所在位置的地形高度——随坡双向弯折', () => {
    const out = new Float32Array(12)
    trailQuadCorners({ x: 0, z: 0, dx: 0, dz: 1, len: 1.0 }, 0.8, (x) => x, out)
    // +x 侧两角比 −x 侧两角高一个坡度 × 宽度（横向 r = (−uz,ux) = (−1,0) ⇒ 角0 在 +x 侧）
    expect(out[1] - out[4]).toBeCloseTo(0.8)   // 角1(−横,x=−0.4) − 角0(+横,x=+0.4)
    expect(out[10] - out[7]).toBeCloseTo(0.8)  // 角3(−横) − 角2(+横)
    // 纵向两端高度随各自 x 采样（弯坡也不插地）
    for (let i = 0; i < 4; i++) expect(out[i * 3 + 1]).toBeCloseTo(out[i * 3] + TRAIL_LIFT)
  })
  it('段长重叠：几何半长 = len × TRAIL_OVERLAP / 2（盖住转弯楔形缝）', () => {
    const out = new Float32Array(12)
    trailQuadCorners({ x: 0, z: 0, dx: 1, dz: 0, len: 1.0 }, 0.8, flat, out)
    // dir=(1,0) ⇒ 纵向 = x 分量：角0/角1 在 x 上 ±hl；横向 = z 分量 ±hw
    expect(out[0]).toBeCloseTo(-0.5 * TRAIL_OVERLAP)   // 角0 纵向 −hl
    expect(out[6]).toBeCloseTo(0.5 * TRAIL_OVERLAP)    // 角2 (+横,+纵)：纵向 +hl
    expect(Math.abs(out[2])).toBeCloseTo(0.4)          // 角0 横向 ±hw
  })
  it('退化输入：零方向段返回 false，不写 NaN', () => {
    const out = new Float32Array(12)
    expect(trailQuadCorners({ x: 0, z: 0, dx: 0, dz: 0, len: 1 }, 0.8, flat, out)).toBe(false)
    expect(out.every((v) => Number.isFinite(v))).toBe(true)
  })
})