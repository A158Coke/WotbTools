import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GENERIC_TREAD_TEXTURE, TREAD_FALLBACK, advanceTrail, createTrailState, openStampOf,
  resetTrailState, resolveTreadParams, textureStemOf,
  trailStampCorners, treadAlphaAt, treadScaleFor, TRAIL_LIFT, TREAD_FADE, TREAD_RING,
  TREAD_ACTIVATE,
} from './treadMarks.ts'
import { playbackSceneSource } from './__tests__/sceneSource.ts'

const here = dirname(fileURLToPath(import.meta.url))
const sceneSrc = playbackSceneSource()
const writerSrc = readFileSync(resolve(here, 'playback', 'treadBufferWriter.ts'), 'utf8')
const treadSrc = readFileSync(resolve(here, 'playback', 'treadRuntime.ts'), 'utf8')

describe('treadMarks 接线守卫（playbackScene 源码级，sceneryMaterials.test.js 同风格）', () => {
  it('tick() 必须驱动游标泵 updateTrails()（否则印记只在 seek 时出现）', () => {
    expect(sceneSrc).toMatch(/mapWorld\.updateDestructibles\(T\);\s*\n\s*tread\.updateTrails\(\);/)
  })
  it('激活门 = 客户端 0x3632a54（0.3 m 净位移才开始拉伸活戳）', () => {
    expect(TREAD_ACTIVATE).toBeCloseTo(0.3, 6)
  })
})

function line(x0, z0, dx, dz, step, n, yaw = 0) {
  const pts = []
  for (let i = 0; i <= n; i++) pts.push({ x: x0 + dx * step * i, z: z0 + dz * step * i, t: i, yaw })
  return pts
}

describe('resolveTreadParams', () => {
  it('authored json 逐字段透出，texture 归一化为带前导斜杠的资产路径', () => {
    const p = resolveTreadParams({ texture: 'tread/textures/USSR_01_tread.webp', manual_width: 0.835616, manual_space: 1.0 })
    expect(p).toEqual({ texture: '/tread/textures/USSR_01_tread.webp', width: 0.835616, space: 1.0, authored: true })
    expect(resolveTreadParams({ texture: '/tread/textures/X.webp' }).texture).toBe('/tread/textures/X.webp')
  })
  it('无数据 → 客户端通用贴图 + 产品回落；宽度透出 null（未 authored，调用方模型实测）', () => {
    expect(resolveTreadParams(null)).toEqual({
      texture: GENERIC_TREAD_TEXTURE, width: null, space: TREAD_FALLBACK.space, authored: false,
    })
  })
  it('坏数值逐字段回落（不整条拒绝）；manual_width 非法按未 authored（null）透出', () => {
    const p = resolveTreadParams({ texture: '', manual_width: -1, manual_space: Number.NaN })
    expect(p.texture).toBe(GENERIC_TREAD_TEXTURE)
    expect(p.width).toBeNull()
    expect(p.space).toBe(TREAD_FALLBACK.space)
    expect(p.authored).toBe(true)
  })
  it('国别回落车（manual_width null / fallback:true）：width 保持 null 透出，供模型实测', () => {
    const p = resolveTreadParams({ texture: 'tread/textures/European_01_tread.webp',
      manual_width: null, manual_space: 1.0, fallback: true })
    expect(p.width).toBeNull()
    expect(p.texture).toBe('/tread/textures/European_01_tread.webp')
    expect(p.authored).toBe(false)
  })
})

describe('textureStemOf / treadScaleFor（alpha 归一化）', () => {
  it('stem 解析：取文件名去 .webp；异常输入返回空串/1', () => {
    expect(textureStemOf('/tread/textures/GB_01_tread.webp')).toBe('GB_01_tread')
    expect(textureStemOf('tread/textures/USSR_01_tread.WEBP')).toBe('USSR_01_tread')
    expect(textureStemOf(null)).toBe('')
  })
  it('scale 取 per-stem 值；缺失/异常一律 1（fail-open 到原贴图）', () => {
    const meta = { textures: { GB_01_tread: { alpha_mean: 114.7, scale: 0.8652 },
                               USSR_01_tread: { alpha_mean: 127.6, scale: 0.7778 } } }
    expect(treadScaleFor(meta, '/tread/textures/GB_01_tread.webp')).toBeCloseTo(0.8652)
    expect(treadScaleFor(meta, '/tread/textures/USSR_01_tread.webp')).toBeCloseTo(0.7778)
    expect(treadScaleFor(meta, '/tread/textures/Japan_01_tread.webp')).toBe(1)
    expect(treadScaleFor({}, '/tread/textures/GB_01_tread.webp')).toBe(1)
    expect(treadScaleFor(null, null)).toBe(1)
    expect(treadScaleFor({ textures: { X: { scale: 0 } } }, '/tread/textures/X.webp')).toBe(1)
  })
})

describe('advanceTrail（客户端槽位模型：锚点/提交 + 前沿拉伸）', () => {
  it('直线 10 m / space 1.0 → 10 戳，锚点落在采样点、相邻戳共享接缝边', () => {
    const st = createTrailState()
    const added = advanceTrail(st, line(0, 0, 1, 0, 1, 10), 1.0, 1e9)
    expect(added).toBe(10)
    expect(st.segs.map((s) => s.x1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(st.segs.map((s) => s.x0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    for (let k = 1; k < st.segs.length; k++) {
      expect(st.segs[k].x0).toBe(st.segs[k - 1].x1)
      expect(st.segs[k].z0).toBe(st.segs[k - 1].z1)
      expect(st.segs[k].yaw0).toBe(st.segs[k - 1].yaw1)
    }
    expect(st.segs[0].t).toBeCloseTo(1)
    expect(st.segs[1].t).toBeCloseTo(2)
  })
  it('前沿跟随：未满 space 不出戳，活戳末端始终拉伸到当前采样点', () => {
    const st = createTrailState()
    expect(advanceTrail(st, [{ x: 0, z: 0, t: 0, yaw: 0 }], 1.0, 50)).toBe(0)
    expect(openStampOf(st)).toBeNull()
    advanceTrail(st, [{ x: 0.3, z: 0, t: 1, yaw: 0 }], 1.0, 50)
    expect(st.total).toBe(0)
    let open = openStampOf(st)
    expect(open.x0).toBeCloseTo(0)
    expect(open.x1).toBeCloseTo(0.3)
    expect(open.t).toBeCloseTo(1)
    advanceTrail(st, [{ x: 0.6, z: 0, t: 2, yaw: 0 }], 1.0, 50)
    expect(st.total).toBe(0)
    open = openStampOf(st)
    expect(open.x1).toBeCloseTo(0.6)
  })
  it('落锚 = 当前位置（不做精确倍数插值）：戳长 ∈ [space, space+步长]', () => {
    const st = createTrailState()
    expect(advanceTrail(st, [{ x: 0, z: 0, t: 0, yaw: 0 }, { x: 0.6, z: 0, t: 1, yaw: 0 }], 1.0, 1e9)).toBe(0)
    expect(advanceTrail(st, [{ x: 1.2, z: 0, t: 2, yaw: 0 }], 1.0, 1e9)).toBe(1)
    expect(st.segs[0].x0).toBeCloseTo(0)
    expect(st.segs[0].x1).toBeCloseTo(1.2)
    expect(st.anchor.x).toBeCloseTo(1.2)
    const st2 = createTrailState()
    advanceTrail(st2, line(0, 0, 1, 0, 1, 10), 1.0, 1e9)
    for (let k = 1; k < st2.segs.length; k++) expect(st2.segs[k].x0).toBe(st2.segs[k - 1].x1)
  })
  it('采样粒度：小步与单步在 1 m 采样上同形（锚点只落在采样点）', () => {
    const st = createTrailState()
    advanceTrail(st, line(0, 0, 1, 0, 0.1, 10), 1.0, 1e9)
    const big = createTrailState()
    advanceTrail(big, [{ x: 0, z: 0, t: 0, yaw: 0 }, { x: 1, z: 0, t: 1, yaw: 0 }], 1.0, 1e9)
    expect(big.segs.length).toBe(st.segs.length)
    expect(big.segs[0].x1).toBeCloseTo(st.segs[0].x1)
  })
  it('无整数边界 ⇒ 无重复戳（旧 floor+静差防抖机制随之退休）', () => {
    const st = createTrailState()
    const step = 0.5 - 1e-10
    const pts = []
    for (let i = 0; i < 10; i++) pts.push({ x: i * step, z: 0, t: i })
    const added = advanceTrail(st, pts, 1.0, 1e9)
    expect(added).toBe(4)
    expect(st.total).toBe(4)
    expect(st.segs.every((sg) => Number.isFinite(sg.x0) && Number.isFinite(sg.x1))).toBe(true)
    for (let k = 1; k < st.segs.length; k++) expect(st.segs[k].x0).toBe(st.segs[k - 1].x1)
  })
  it('环形上限（客户端 50 槽同构）：覆写最老槽位，total 持续累计', () => {
    const st = createTrailState()
    const added = advanceTrail(st, line(0, 0, 1, 0, 1, 12), 1.0, 10)
    expect(added).toBe(12)
    expect(st.total).toBe(12)
    expect(st.segs.length).toBe(10)
    expect(st.total % 10).toBe(2)
    expect(st.segs[0].x1).toBeCloseTo(11)
    expect(st.segs[1].x1).toBeCloseTo(12)
    expect(st.segs[7].x1).toBeCloseTo(8)
    expect(TREAD_RING).toBe(50)
  })
  it('转向：锚点沿路径、朝向随点携带（长戳覆盖整个弧段）', () => {
    const st = createTrailState()
    advanceTrail(st, [
      { x: 0, z: 0, t: 0, yaw: 0 },
      { x: 2, z: 0, t: 2, yaw: 0 },
      { x: 2, z: 2, t: 4, yaw: Math.PI / 2 },
    ], 1.0, 1e9)
    expect(st.total).toBe(2)
    const last = st.segs[st.segs.length - 1]
    expect(last.x0).toBeCloseTo(2); expect(last.z0).toBeCloseTo(0)
    expect(last.x1).toBeCloseTo(2); expect(last.z1).toBeCloseTo(2)
    expect(last.yaw0).toBeCloseTo(0)
    expect(last.yaw1).toBeCloseTo(Math.PI / 2)
  })
  it('space 非法 / 零位移步 → 不出戳不漂移', () => {
    const st = createTrailState()
    expect(advanceTrail(st, line(0, 0, 1, 0, 1, 5), 0, 1e9)).toBe(0)
    expect(advanceTrail(st, [{ x: 3, z: 0 }, { x: 3, z: 0 }], 1.0, 1e9)).toBe(0)
  })
  it('停车再起步：静止不落锚；出生时刻 = 锚点时刻（不存在插值出的怪值）', () => {
    const st = createTrailState()
    const added = advanceTrail(st, [
      { x: 0, z: 0, t: 0, yaw: 0 },
      { x: 0.8, z: 0, t: 0.16, yaw: 0 },
      { x: 0.8, z: 0, t: 100, yaw: 0 },
      { x: 1.3, z: 0, t: 100.1, yaw: 0 },    // 再走 0.5 ⇒ 落锚
    ], 0.5, 64)
    expect(added).toBe(2)
    expect(st.segs[0].t).toBeCloseTo(0.16, 9)
    expect(st.segs[0].x1).toBeCloseTo(0.8)
    expect(st.segs[1].t).toBeCloseTo(100.1, 6)
    expect(st.segs[1].t).toBeGreaterThan(90)
    expect(st.segs[1].x0).toBeCloseTo(0.8)
    expect(st.segs[1].x1).toBeCloseTo(1.3)
  })
  it('静止期间的原地转向：不新出戳；转向扫掠落在跨转向的那一戳上（扭转四边形）', () => {
    const st = createTrailState()
    advanceTrail(st, [
      { x: 0, z: 0, t: 0, yaw: 0 },
      { x: 1.0, z: 0, t: 1, yaw: 0 },
      { x: 1.0, z: 0, t: 2, yaw: Math.PI / 2 },
      { x: 1.0, z: 1.0, t: 3, yaw: Math.PI / 2 },   // 再走 1 m ⇒ 落锚
    ], 1.0, 64)
    expect(st.total).toBe(2)
    expect(st.segs[0].yaw0).toBeCloseTo(0)
    expect(st.segs[0].yaw1).toBeCloseTo(0)
    expect(st.segs[1].yaw0).toBeCloseTo(0)
    expect(st.segs[1].yaw1).toBeCloseTo(Math.PI / 2)
  })
  it('淡出后起步/低速：锚点时间门控保证新印记可见（review P2 2026-10-12 复现场景）', () => {
    const st = createTrailState()
    advanceTrail(st, [{ x: 0, z: 0, t: 0, yaw: 0 }, { x: 0.2, z: 0, t: 1, yaw: 0 }], 1.0, 50)
    advanceTrail(st, [{ x: 0.2, z: 0, t: 10, yaw: 0 }], 1.0, 50)
    advanceTrail(st, [{ x: 0.4, z: 0, t: 10.1, yaw: 0 }], 1.0, 50)
    expect(st.total).toBe(0)
    const open = openStampOf(st)
    expect(open).not.toBeNull()
    expect(Math.hypot(open.x1 - open.x0, open.z1 - open.z0)).toBeCloseTo(0.4)
    expect(open.t).toBeGreaterThan(7.62)
    expect(treadAlphaAt(10.1 - open.t)).toBeGreaterThan(0)
    const st2 = createTrailState()
    let x = 0, t = 0
    for (let i = 0; i < 60; i++) { x += 0.15; t += 0.1; advanceTrail(st2, [{ x, z: 0, t, yaw: 0 }], 1.0, 50) }
    const open2 = openStampOf(st2)
    expect(open2).not.toBeNull()
    expect(open2.t).toBeGreaterThan(t - 1)
  })
  it('同一条带往返：正常累积（无空间去重；重叠由 7.62s 淡出自然收敛）', () => {
    const st = createTrailState()
    const pts = []
    for (let leg = 0; leg < 4; leg++) {
      for (let k = 1; k <= 6; k++) {
        const forward = leg % 2 === 0
        const pos = forward ? k * 0.5 : 3 - k * 0.5
        pts.push({ x: pos, z: 0, t: (leg * 6 + k) * 0.2, yaw: 0 })
      }
    }
    advanceTrail(st, pts, 1.0, 50)
    expect(st.total).toBe(8)
    expect(st.segs.length).toBe(8)
    for (let k = 1; k < st.segs.length; k++) {
      expect(st.segs[k].x0).toBe(st.segs[k - 1].x1)
    }
  })
  it('回退/折返路径也正常入环（无去重：所有新戳都是普通追加）', () => {
    const st = createTrailState()
    advanceTrail(st, [
      { x: 0, z: 0, t: 0, yaw: 0 },
      { x: 1, z: 0, t: 1, yaw: 0 },
      { x: 1, z: 1, t: 2, yaw: Math.PI / 2 },
    ], 1.0, 50)
    expect(st.total).toBe(2)
    advanceTrail(st, [{ x: -0.2, z: 1.0, t: 3, yaw: Math.PI }], 1.0, 50)
    expect(st.total).toBe(3)
    expect(st.segs.every(Boolean)).toBe(true)
  })
  it('平行车道与共线往返都正常共存（无空间判定；重叠由淡出收敛）', () => {
    const st = createTrailState()
    advanceTrail(st, [{ x: 0, z: 0, t: 0, yaw: 0 }, { x: 1, z: 0, t: 1, yaw: 0 }], 1.0, 50)
    resetTrailState(st)
    advanceTrail(st, [{ x: 1, z: 10, t: 20, yaw: Math.PI }], 1.0, 50)
    advanceTrail(st, [{ x: 0, z: 10, t: 21, yaw: Math.PI }], 1.0, 50)
    expect(st.total).toBe(2)
    expect(st.segs[0].x1).toBeCloseTo(1)
    expect(st.segs[1].z0).toBeCloseTo(10)
  })
  it('老化逐槽独立：无序出生时刻的槽各自按自身 t 老化（评审 P2 二轮复现形态）', () => {
    const st = createTrailState()
    advanceTrail(st, [{ x: 0, z: 0, t: 1, yaw: 0 }, { x: 1, z: 0, t: 2, yaw: 0 }], 1.0, 50)
    advanceTrail(st, [{ x: 2, z: 0, t: 3, yaw: 0 }], 1.0, 50)
    expect(st.segs.map((g) => g.t)).toEqual([2, 3])
    expect(treadAlphaAt(10.1 - st.segs[0].t)).toBe(0)
    expect(treadAlphaAt(10.1 - st.segs[1].t)).toBeLessThan(0.2)
  })
  it('垂直交叉的两条带共存（无空间判定）', () => {
    const st = createTrailState()
    advanceTrail(st, [{ x: 0.5, z: -0.5, t: 0, yaw: 0 }, { x: 0.5, z: 0.5, t: 1, yaw: 0 }], 1.0, 50)
    resetTrailState(st)
    advanceTrail(st, [{ x: 0, z: 0, t: 2, yaw: 0 }, { x: 1, z: 0, t: 3, yaw: 0 }], 1.0, 50)
    expect(st.total).toBe(2)
    expect(st.segs[0].z1).toBeCloseTo(0.5)
    expect(st.segs[1].x1).toBeCloseTo(1)
  })
  it('部分共线重叠共存（无去重：旧尾段保留 + 新戳追加）', () => {
    const st = createTrailState()
    advanceTrail(st, [{ x: 0, z: 0, t: 0, yaw: 0 }, { x: 1, z: 0, t: 1, yaw: 0 }], 1.0, 50)
    resetTrailState(st)
    advanceTrail(st, [{ x: 0.6, z: 0, t: 10, yaw: Math.PI }, { x: -0.4, z: 0, t: 11, yaw: Math.PI }], 1.0, 50)
    expect(st.total).toBe(2)
    expect(st.segs[0].x1).toBeCloseTo(1)
    expect(st.segs[1].x0).toBeCloseTo(0.6)
  })
  it('激活门（客户端 0x3632a54 = 0.3m）：蹭动不画，达阈后活戳出现并正常落锚', () => {
    const st = createTrailState()
    advanceTrail(st, [
      { x: 0, z: 0, t: 0, yaw: 0 },
      { x: 0.15, z: 0, t: 1, yaw: 0 },
      { x: 0, z: 0, t: 2, yaw: 0 },
      { x: -0.15, z: 0, t: 3, yaw: 0 },
    ], 1.0, 50)
    expect(st.total).toBe(0)
    expect(openStampOf(st)).toBeNull()
    const st2 = createTrailState()
    advanceTrail(st2, [{ x: 0, z: 0, t: 0, yaw: 0 }, { x: 0.35, z: 0, t: 1, yaw: 0 }], 1.0, 50)
    let open = openStampOf(st2)
    expect(open).not.toBeNull()
    expect(open.x1).toBeCloseTo(0.35)
    advanceTrail(st2, [{ x: 1.0, z: 0, t: 2, yaw: 0 }], 1.0, 50)
    expect(st2.total).toBe(1)
  })
  it('激活门浮点容差：数学上恰好 0.3m 必须激活（review 六轮 P2 复现）', () => {
    const st = createTrailState()
    advanceTrail(st, [{ x: 0.4, z: 0, t: 0, yaw: 0 }, { x: 0.7, z: 0, t: 1, yaw: 0 }], 1.0, 50)
    expect(openStampOf(st)).not.toBeNull()
    expect(openStampOf(st).x1).toBeCloseTo(0.7)
    const st2 = createTrailState()
    advanceTrail(st2, [{ x: 0, z: 0, t: 0, yaw: 0 }, { x: 0.299999, z: 0, t: 1, yaw: 0 }], 1.0, 50)
    expect(openStampOf(st2)).toBeNull()
    const st3 = createTrailState()
    advanceTrail(st3, [{ x: 0, z: 0, t: 0, yaw: 0 }, { x: 0.3, z: 0, t: 1, yaw: 0 }], 1.0, 50)
    expect(openStampOf(st3)).not.toBeNull()
  })
  it('seek 重算确定性：全量一次 ==（走到 k、复位、重走到 k）', () => {
    const a = createTrailState()
    advanceTrail(a, line(0, 0, 0.6, 0.8, 0.7, 20), 1.0, 1e9)
    const b = createTrailState()
    advanceTrail(b, line(0, 0, 0.6, 0.8, 0.7, 8), 1.0, 1e9)
    resetTrailState(b)
    advanceTrail(b, line(0, 0, 0.6, 0.8, 0.7, 20), 1.0, 1e9)
    expect(b.segs).toEqual(a.segs)
    expect(b.total).toBe(a.total)
    expect(b.written).toBe(0)
  })
})

describe('treadAlphaAt（客户端淡出窗：1 − smoothstep(start, end, age)）', () => {
  it('start 前恒 1；start→end 平滑降；end 后 0；曲线为 smoothstep（非线性）', () => {
    expect(treadAlphaAt(0)).toBe(1)
    expect(treadAlphaAt(TREAD_FADE.start)).toBe(1)
    const mid = (TREAD_FADE.start + TREAD_FADE.end) / 2
    expect(treadAlphaAt(mid)).toBeCloseTo(0.5)
    expect(treadAlphaAt(TREAD_FADE.end)).toBe(0)
    expect(treadAlphaAt(TREAD_FADE.end + 100)).toBe(0)
    const q1 = TREAD_FADE.start + (TREAD_FADE.end - TREAD_FADE.start) * 0.25
    const q3 = TREAD_FADE.start + (TREAD_FADE.end - TREAD_FADE.start) * 0.75
    expect(treadAlphaAt(q1)).toBeGreaterThan(0.75)
    expect(treadAlphaAt(q3)).toBeLessThan(0.25)
  })
  it('淡出窗取值 = 客户端引擎常数（反汇编 0x4010f94 / 0x4010f98）', () => {
    expect(TREAD_FADE.start).toBeCloseTo(5.45, 6)
    expect(TREAD_FADE.end).toBeCloseTo(7.62, 6)
  })
  it('负年龄代表未来出生的段：seek 到其出生前必须隐藏；仅容忍极小浮点抖动', () => {
    expect(treadAlphaAt(-5)).toBe(0)
    expect(treadAlphaAt(-1e-10)).toBe(1)
  })
})

describe('trailStampCorners（扫掠四边形，客户端同构）', () => {
  const flat = () => 0
  it('直线：戳 = 两横截面间的四边形，角序 [L0,R0,R1,L1]，逐角 y = 地形 + TRAIL_LIFT', () => {
    const out = new Float32Array(12)
    const ok = trailStampCorners({ x0: 5, z0: 7, yaw0: 0, x1: 5, z1: 8, yaw1: 0 }, 0.8, flat, out)
    expect(ok).toBe(true)
    expect(out[0]).toBeCloseTo(5.4)
    expect(out[2]).toBeCloseTo(7)
    expect(out[3]).toBeCloseTo(4.6)
    expect(out[5]).toBeCloseTo(7)
    expect(out[6]).toBeCloseTo(4.6)
    expect(out[8]).toBeCloseTo(8)
    expect(out[9]).toBeCloseTo(5.4)
    expect(out[11]).toBeCloseTo(8)
    for (let i = 0; i < 4; i++) expect(out[i * 3 + 1]).toBeCloseTo(TRAIL_LIFT)
  })

  it('相邻戳共享整条接缝边（转弯无缝的根因不变量）', () => {
    const marks = [
      { x: 0, z: 0, t: 0, yaw: 0 },
      { x: 0, z: 1, t: 1, yaw: 0 },
      { x: 1, z: 1, t: 2, yaw: Math.PI / 2 },
    ]
    const st = createTrailState()
    advanceTrail(st, marks, 1.0, 1e9)
    expect(st.total).toBe(2)
    const a = new Float32Array(12), b = new Float32Array(12)
    trailStampCorners(st.segs[0], 0.8, () => 0, a)
    trailStampCorners(st.segs[1], 0.8, () => 0, b)
    expect([b[0], b[2]]).toEqual([a[9], a[11]])
    expect([b[3], b[5]]).toEqual([a[6], a[8]])
  })

  it('戳携带两段横截面的朝向：急转时远端横截面随之旋转（不再各自为政）', () => {
    const out = new Float32Array(12)
    const ok = trailStampCorners(
      { x0: 0, z0: 0, yaw0: 0, x1: 0, z1: 1, yaw1: Math.PI / 2 }, 0.8, () => 0, out)
    expect(ok).toBe(true)
    expect(out[9]).toBeCloseTo(0);  expect(out[11]).toBeCloseTo(1.4)
    expect(out[6]).toBeCloseTo(0);  expect(out[8]).toBeCloseTo(0.6)
  })

  it('退化输入：NaN 位置返回 false，不写 NaN', () => {
    const out = new Float32Array(12)
    expect(trailStampCorners({ x0: NaN, z0: 0, yaw0: 0, x1: 0, z1: 1, yaw1: 0 }, 0.8, () => 0, out)).toBe(false)
    expect(out.every((v) => Number.isFinite(v))).toBe(true)
  })
})
