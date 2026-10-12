import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GENERIC_TREAD_TEXTURE, TREAD_FALLBACK, advanceTrail, createTrailState, openStampOf,
  resetTrailState, resolveTreadParams, textureStemOf,
  trailStampCorners, treadAlphaAt, treadScaleFor, TRAIL_LIFT, TREAD_FADE, TREAD_RING,
} from './treadMarks.js'

const here = dirname(fileURLToPath(import.meta.url))
const sceneSrc = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')

describe('treadMarks 接线守卫（playbackScene 源码级，sceneryMaterials.test.js 同风格）', () => {
  it('tick() 必须驱动游标泵 updateTrails()（否则印记只在 seek 时出现）', () => {
    expect(sceneSrc).toMatch(/updateDestructibles\(T\);\s*\n\s*updateTrails\(\);/)
  })
  it('开关必须经场景 API 落到 store.treadOn（唯一 owner，不得在组件里另立状态）', () => {
    expect(sceneSrc).toMatch(/setTreadMarks: \(on\) => \{\s*store\.treadOn = !!on;/)
  })
  it('暂停态开关必须立即生效：setter 内同步驱动游标泵（review P2 2026-10-11）', () => {
    // 只改 store + invalidate 时，暂停（animate 不 tick）下 mesh.visible/重算要等继续
    // 播放或 seek 才更新——实测 setTreadMarks(false) 后 mesh.visible 仍为 true。
    expect(sceneSrc).toMatch(/setTreadMarks: \(on\) => \{[\s\S]{0,700}?updateTrails\(\);/)
  })
  it('客户端槽位模型接线：环 50 槽（TREAD_RING）+ 活戳独立槽 + 全窗口显式隐藏', () => {
    // 反汇编 0x83d460 `(i+0x32)%0x32`（0x32 = 50）⇒ 每侧活戳环 = 50 槽；活戳（未提交、
    // 逐帧拉伸）占独立槽位，不与环槽混用。
    expect(sceneSrc).toMatch(/const TRAIL_CAP_PER_SIDE = TREAD_RING;/)
    expect(sceneSrc).toMatch(/const TRAIL_OPEN_SLOT = TRAIL_CAP_PER_SIDE;/)
    expect(sceneSrc).toMatch(/const TRAIL_SLOTS = \(TRAIL_CAP_PER_SIDE \+ 1\) \* 2;/)
    // 绘制窗口 = 全部槽位（不再按 min/max(L,R) 取窗互相截断），无效槽显式隐藏
    expect(sceneSrc).toMatch(/geo\.setDrawRange\(0, TRAIL_SLOTS \* 6\);/)
    expect(sceneSrc).toMatch(/const open = openStampOf\(st\);/)
    expect(sceneSrc).toMatch(/hideQuads\(/)
  })
  it('淡出窗 = 客户端引擎常数（TREAD_FADE.start/end；老化扫描同源）', () => {
    expect(sceneSrc).toMatch(/const cutoff = T - TREAD_FADE\.end;/)
  })
  it('关断重开必须复位两侧路径态（不只回退 builtT；review P2 2026-10-11）', () => {
    expect(sceneSrc).toMatch(/if \(tr\.builtT !== -Infinity \|\| tr\.L\.total \|\| tr\.R\.total\) \{\s*resetTrailState\(tr\.L\); resetTrailState\(tr\.R\);/)
  })
  it('alpha 比较必须走 Math.fround 量化门控（review P3 2026-10-11：double 严格比较恒为脏）', () => {
    // 客户端口径：alpha = 淡出系数 × per-stem 归一化，**无全局压暗系数**（2026-10-12 裁示）
    expect(sceneSrc).toMatch(/Math\.fround\(treadAlphaAt\(T - t\) \* \(v\.tread\.texScale \|\| 1\)\)/)
    expect(sceneSrc).not.toMatch(/TREAD_OPACITY/)
    expect(sceneSrc).toMatch(/parr\[pos0 \+ i\] !== Math\.fround\(c12\[i\]\)/)
  })
  it('teardown 必须释放逐车 treadMesh 几何/材质与会话级贴图缓存（显存生命周期同会话）', () => {
    expect(sceneSrc).toMatch(/v\.treadMesh\.geometry\.dispose\(\)/)
    expect(sceneSrc).toMatch(/v\.treadMesh\.material\.dispose\(\)/)
    expect(sceneSrc).toMatch(/for \(const tex of treadTexCache\.values\(\)\) tex\.dispose\(\)/)
  })
})

/** 直线路径采样点：从 (x0,z0) 沿单位方向 (dx,dz) 走 step × n 米（t = 采样序号） */
function line(x0, z0, dx, dz, step, n, yaw = 0) {
  const pts = []
  for (let i = 0; i <= n; i++) pts.push({ x: x0 + dx * step * i, z: z0 + dz * step * i, t: i, yaw })
  return pts
}

describe('resolveTreadParams', () => {
  it('authored json 逐字段透出，texture 归一化为带前导斜杠的资产路径', () => {
    const p = resolveTreadParams({ texture: 'tread/textures/USSR_01_tread.webp', manual_width: 0.835616, manual_space: 1.0 })
    expect(p).toEqual({ texture: '/tread/textures/USSR_01_tread.webp', width: 0.835616, space: 1.0, authored: true })
    // 已带斜杠的形状不双写
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
    // 非法宽度不落常量（常量只存在于场景 resolveTreadWidth 一处）：透出 null ⇒ 调用方可
    // 继续走"模型履带盒实测"；早先在这里填常量会让 authoredWidth 误判为真、永久锁死
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
      // 不变量：前戳的远端 = 后戳的近端（共享整条横截面）⇒ 单趟内零重叠
      expect(st.segs[k].x0).toBe(st.segs[k - 1].x1)
      expect(st.segs[k].z0).toBe(st.segs[k - 1].z1)
      expect(st.segs[k].yaw0).toBe(st.segs[k - 1].yaw1)
    }
    // 出生时刻 = 锚点时刻（落锚即出生；客户端槽位时间随重新落锚刷新同款）
    expect(st.segs[0].t).toBeCloseTo(0)
    expect(st.segs[1].t).toBeCloseTo(1)
  })
  it('前沿跟随：未满 space 不出戳，活戳末端始终拉伸到当前采样点', () => {
    const st = createTrailState()
    expect(advanceTrail(st, [{ x: 0, z: 0, t: 0, yaw: 0 }], 1.0, 50)).toBe(0)
    expect(openStampOf(st)).toBeNull()                 // 刚起步：活戳退化（长度为 0）
    advanceTrail(st, [{ x: 0.3, z: 0, t: 1, yaw: 0 }], 1.0, 50)
    expect(st.total).toBe(0)
    let open = openStampOf(st)
    expect(open.x0).toBeCloseTo(0)
    expect(open.x1).toBeCloseTo(0.3)                   // 活戳 = 锚点 → 当前点
    expect(open.t).toBeCloseTo(0)                      // 出生 = 锚点时刻
    advanceTrail(st, [{ x: 0.6, z: 0, t: 2, yaw: 0 }], 1.0, 50)
    expect(st.total).toBe(0)                           // 仍不满 1 m
    open = openStampOf(st)
    expect(open.x1).toBeCloseTo(0.6)                   // 同一活戳继续拉伸（不新增槽位）
  })
  it('落锚 = 当前位置（不做精确倍数插值）：戳长 ∈ [space, space+步长]', () => {
    const st = createTrailState()
    expect(advanceTrail(st, [{ x: 0, z: 0, t: 0, yaw: 0 }, { x: 0.6, z: 0, t: 1, yaw: 0 }], 1.0, 1e9)).toBe(0)
    expect(advanceTrail(st, [{ x: 1.2, z: 0, t: 2, yaw: 0 }], 1.0, 1e9)).toBe(1)
    // 满 1 m 的是 1.2 这一点本身（不在 0.6→1.2 内插值出 1.0）——客户端 0x83d4ca 同款
    expect(st.segs[0].x0).toBeCloseTo(0)
    expect(st.segs[0].x1).toBeCloseTo(1.2)
    expect(st.anchor.x).toBeCloseTo(1.2)               // 就地重锚
    const st2 = createTrailState()
    advanceTrail(st2, line(0, 0, 1, 0, 1, 10), 1.0, 1e9)
    for (let k = 1; k < st2.segs.length; k++) expect(st2.segs[k].x0).toBe(st2.segs[k - 1].x1)
  })
  it('采样粒度：小步与单步在 1 m 采样上同形（锚点只落在采样点）', () => {
    const st = createTrailState()
    advanceTrail(st, line(0, 0, 1, 0, 0.1, 10), 1.0, 1e9)           // 10 小步走 1 m
    const big = createTrailState()
    advanceTrail(big, [{ x: 0, z: 0, t: 0, yaw: 0 }, { x: 1, z: 0, t: 1, yaw: 0 }], 1.0, 1e9)
    expect(big.segs.length).toBe(st.segs.length)                     // 都只落 1 戳
    expect(big.segs[0].x1).toBeCloseTo(st.segs[0].x1)
  })
  it('无整数边界 ⇒ 无重复戳（旧 floor+静差防抖机制随之退休）', () => {
    // 旧模型按 floor(acc/space)+1 找整数边界，步长抖动会把同一戳发两次（实测 20 m 发
    // 29/27 戳）；新模型锚点直接落在采样点，不存在可被重复跨越的边界。
    const st = createTrailState()
    const step = 0.5 - 1e-10
    const pts = []
    for (let i = 0; i < 10; i++) pts.push({ x: i * step, z: 0, t: i })
    const added = advanceTrail(st, pts, 1.0, 1e9)
    // 阈值带 1e-9 容差（浮点欠冲）：i=2（2s = 0.9999999998 ≥ 1−1e-9）落锚，此后每 2 步一戳
    // ⇒ i=2,4,6,8 共 4 戳、无重复（旧模型的 4 戳结论保持，但机制换成锚点距离门控）
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
    expect(st.head).toBe(2)                       // 下一覆写槽 = 12 % 10
    expect(st.segs[0].x1).toBeCloseTo(11)          // 槽 0 已被绝对序号 10 覆写（远端 = 11 m）
    expect(st.segs[1].x1).toBeCloseTo(12)          // 槽 1 = 绝对序号 11
    expect(st.segs[7].x1).toBeCloseTo(8)           // 槽 7 仍是绝对序号 7
    expect(TREAD_RING).toBe(50)                    // 生产环 = 客户端反汇编值（0x32）
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
    expect(last.yaw0).toBeCloseTo(0)              // 锚点时刻朝向
    expect(last.yaw1).toBeCloseTo(Math.PI / 2)    // 当前朝向：扫掠覆盖转向
  })
  it('space 非法 / 零位移步 → 不出戳不漂移', () => {
    const st = createTrailState()
    expect(advanceTrail(st, line(0, 0, 1, 0, 1, 5), 0, 1e9)).toBe(0)
    expect(advanceTrail(st, [{ x: 3, z: 0 }, { x: 3, z: 0 }], 1.0, 1e9)).toBe(0)
  })
  it('停车再起步：静止不落锚；出生时刻 = 锚点时刻（不存在插值出的怪值）', () => {
    // 旧模型在停车后的跨边界戳会把出生时刻在「停车前」与「起步后」之间插值（实测 40.136
    // 而实际 100.1）；新模型出生 = 锚点时刻，同客户端的槽位时间语义。
    const st = createTrailState()
    const added = advanceTrail(st, [
      { x: 0, z: 0, t: 0, yaw: 0 },
      { x: 0.8, z: 0, t: 0.16, yaw: 0 },     // 满 0.5 ⇒ 落锚
      { x: 0.8, z: 0, t: 100, yaw: 0 },      // 停车 100 s（零位移不落锚）
      { x: 1.3, z: 0, t: 100.1, yaw: 0 },    // 再走 0.5 ⇒ 落锚
    ], 0.5, 64)
    expect(added).toBe(2)
    expect(st.segs[0].t).toBeCloseTo(0, 9)
    expect(st.segs[0].x1).toBeCloseTo(0.8)
    expect(st.segs[1].t).toBeCloseTo(0.16, 9)     // = 锚点时刻（不是插值 / 停车后时刻）
    expect(st.segs[1].x0).toBeCloseTo(0.8)
    expect(st.segs[1].x1).toBeCloseTo(1.3)
  })
  it('静止期间的原地转向：不新出戳；转向扫掠落在跨转向的那一戳上（扭转四边形）', () => {
    const st = createTrailState()
    advanceTrail(st, [
      { x: 0, z: 0, t: 0, yaw: 0 },
      { x: 1.0, z: 0, t: 1, yaw: 0 },               // 满 space ⇒ 落锚
      { x: 1.0, z: 0, t: 2, yaw: Math.PI / 2 },     // 原地转 90°（零位移；活戳末端随朝向）
      { x: 1.0, z: 1.0, t: 3, yaw: Math.PI / 2 },   // 再走 1 m ⇒ 落锚
    ], 1.0, 64)
    expect(st.total).toBe(2)                        // 只有两次落锚，转向段不额外出戳
    expect(st.segs[0].yaw0).toBeCloseTo(0)
    expect(st.segs[0].yaw1).toBeCloseTo(0)          // 第一戳（转向之前）
    // 跨转向的戳从旧朝向横截面扫到新朝向横截面（覆盖原地转向掠过的区域）
    expect(st.segs[1].yaw0).toBeCloseTo(0)
    expect(st.segs[1].yaw1).toBeCloseTo(Math.PI / 2)
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
    expect(b.written).toBe(0)                     // 复位归零消费侧书签
  })
})

describe('treadAlphaAt（客户端淡出窗：1 − smoothstep(start, end, age)）', () => {
  it('start 前恒 1；start→end 平滑降；end 后 0；曲线为 smoothstep（非线性）', () => {
    expect(treadAlphaAt(0)).toBe(1)
    expect(treadAlphaAt(TREAD_FADE.start)).toBe(1)
    const mid = (TREAD_FADE.start + TREAD_FADE.end) / 2
    expect(treadAlphaAt(mid)).toBeCloseTo(0.5)          // smoothstep 中点 = 0.5
    expect(treadAlphaAt(TREAD_FADE.end)).toBe(0)
    expect(treadAlphaAt(TREAD_FADE.end + 100)).toBe(0)
    const q1 = TREAD_FADE.start + (TREAD_FADE.end - TREAD_FADE.start) * 0.25
    const q3 = TREAD_FADE.start + (TREAD_FADE.end - TREAD_FADE.start) * 0.75
    expect(treadAlphaAt(q1)).toBeGreaterThan(0.75)      // 前段压得住（smoothstep 特性）
    expect(treadAlphaAt(q3)).toBeLessThan(0.25)         // 尾段快速收掉
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
    // 沿 +z 直行、yaw=0 ⇒ 右向 = (−1, 0)·hw
    const ok = trailStampCorners({ x0: 5, z0: 7, yaw0: 0, x1: 5, z1: 8, yaw1: 0 }, 0.8, flat, out)
    expect(ok).toBe(true)
    expect(out[0]).toBeCloseTo(5.4)   // L0 = x + 0.4（右侧 −x ⇒ L 在 +x）
    expect(out[2]).toBeCloseTo(7)
    expect(out[3]).toBeCloseTo(4.6)   // R0 = x − 0.4
    expect(out[5]).toBeCloseTo(7)
    expect(out[6]).toBeCloseTo(4.6)   // R1
    expect(out[8]).toBeCloseTo(8)
    expect(out[9]).toBeCloseTo(5.4)   // L1
    expect(out[11]).toBeCloseTo(8)
    for (let i = 0; i < 4; i++) expect(out[i * 3 + 1]).toBeCloseTo(TRAIL_LIFT)
  })

  it('相邻戳共享整条接缝边（转弯无缝的根因不变量）', () => {
    // 90° 转弯路径：mark 序列 0→1→2（每米一次），朝向随之转
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
    // 前戳的角 2/3（R1/L1）与后戳的角 0/1（L0/R0）逐值相等 ⇒ 接缝闭合
    expect([b[0], b[2]]).toEqual([a[9], a[11]])
    expect([b[3], b[5]]).toEqual([a[6], a[8]])
  })

  it('戳携带两段横截面的朝向：急转时远端横截面随之旋转（不再各自为政）', () => {
    const out = new Float32Array(12)
    const ok = trailStampCorners(
      { x0: 0, z0: 0, yaw0: 0, x1: 0, z1: 1, yaw1: Math.PI / 2 }, 0.8, () => 0, out)
    expect(ok).toBe(true)
    // yaw1=90° ⇒ fwd=(−1,0)、right=(−cos90, −sin90)=(0,−1)：R1 = (0, 1−0.4)、L1 = (0, 1+0.4)
    expect(out[9]).toBeCloseTo(0);  expect(out[11]).toBeCloseTo(1.4)
    expect(out[6]).toBeCloseTo(0);  expect(out[8]).toBeCloseTo(0.6)
  })

  it('退化输入：NaN 位置返回 false，不写 NaN', () => {
    const out = new Float32Array(12)
    expect(trailStampCorners({ x0: NaN, z0: 0, yaw0: 0, x1: 0, z1: 1, yaw1: 0 }, 0.8, () => 0, out)).toBe(false)
    expect(out.every((v) => Number.isFinite(v))).toBe(true)
  })
})
