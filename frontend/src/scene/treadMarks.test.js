import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GENERIC_TREAD_TEXTURE, TREAD_FALLBACK, advanceTrail, createTrailState,
  resetTrailState, resolveTreadParams, trailQuadMatrix, TRAIL_LIFT,
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
  it('teardown 必须释放逐车 treadMesh 与会话级贴图缓存（显存生命周期同会话）', () => {
    expect(sceneSrc).toMatch(/v\.treadMesh\.dispose\(\)/)
    expect(sceneSrc).toMatch(/for \(const tex of treadTexCache\.values\(\)\) tex\.dispose\(\)/)
  })
})

/** 直线路径采样点：从 (x0,z0) 沿单位方向 (dx,dz) 走 step × n 米 */
function line(x0, z0, dx, dz, step, n) {
  const pts = []
  for (let i = 0; i <= n; i++) pts.push({ x: x0 + dx * step * i, z: z0 + dz * step * i })
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

describe('trailQuadMatrix', () => {
  const flat = () => 0
  it('平地：单位正交基、四角 = 中心 ± 横/纵半宽、抬升 TRAIL_LIFT', () => {
    const out = new Float32Array(16)
    const ok = trailQuadMatrix({ x: 5, z: 7, dx: 0, dz: 1, len: 1.0 }, 0.8, flat, out)
    expect(ok).toBe(true)
    // 列主序：col0 = 横向半宽，col2 = 纵向半长，col3 = 中心
    expect(out[0]).toBeCloseTo(0.4)           // r = n×f = (+1,0,0)（n=up, f=+z 的右手基）
    expect(out[5]).toBeCloseTo(1)             // col1 = 法线 (0,1,0)
    expect(out[9]).toBeCloseTo(0)             // 平地 f 无 y 分量
    expect(out[10]).toBeCloseTo(0.5)          // f·len/2 = +z·0.5
    expect(out[12]).toBeCloseTo(5)
    expect(out[13]).toBeCloseTo(TRAIL_LIFT)
    expect(out[14]).toBeCloseTo(7)
    expect(out[15]).toBe(1)
    // 正交性：r·f = 0、|n| = 1
    expect(out[0] * out[8] + out[1] * out[9] + out[2] * out[10]).toBeCloseTo(0)
  })
  it('横坡（h=x）：法线随坡倾斜、f 仍在切平面（f·n=0）', () => {
    const out = new Float32Array(16)
    trailQuadMatrix({ x: 0, z: 0, dx: 0, dz: 1, len: 1.0 }, 0.8, (x) => x, out)
    const n = [out[4], out[5], out[6]]
    const f = [out[8], out[9], out[10]]
    const r = [out[0], out[1], out[2]]
    // n ∝ (−1,1,0)/√2（h 随 +x 抬升 ⇒ 法线朝 −x 倾）
    expect(n[0]).toBeLessThan(0)
    expect(Math.abs(n[0] + n[1])).toBeLessThan(1e-6)   // 归一化的 (−1,1,0)/√2 两分量互为相反数
    // f·n = 0（沿路方向贴合坡面）且 f 保持 +z
    expect(f[0] * n[0] + f[1] * n[1] + f[2] * n[2]).toBeCloseTo(0)
    expect(f[2]).toBeGreaterThan(0)
    // r·f = 0、|r| = 1
    expect(r[0] * f[0] + r[1] * f[1] + r[2] * f[2]).toBeCloseTo(0)
    expect(Math.hypot(r[0], r[1], r[2])).toBeCloseTo(0.4)   // col0 = r·hw（hw=0.4）
  })
  it('退化输入：零方向段返回 false，不写 NaN', () => {
    const out = new Float32Array(16)
    expect(trailQuadMatrix({ x: 0, z: 0, dx: 0, dz: 0, len: 1 }, 0.8, flat, out)).toBe(false)
    expect(out.every((v) => Number.isFinite(v))).toBe(true)
  })
  it('16 元素列主序可被 three.js Matrix4.fromArray 复原（形状契约）', async () => {
    const { Matrix4 } = await import('three')
    const out = new Float32Array(16)
    trailQuadMatrix({ x: 1, z: 2, dx: 1, dz: 0, len: 1.2 }, 0.9, flat, out)
    const m = new Matrix4().fromArray(out)
    const e = m.elements
    expect(e[12]).toBeCloseTo(1)
    expect(e[13]).toBeCloseTo(TRAIL_LIFT)
    expect(e[14]).toBeCloseTo(2)
    expect(m.determinant()).toBeCloseTo(0.45 * 0.6)   // det = hw·hl（正交基，width/len 乘入列）
  })
})
