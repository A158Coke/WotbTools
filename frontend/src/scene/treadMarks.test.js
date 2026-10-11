import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GENERIC_TREAD_TEXTURE, TREAD_FALLBACK, advanceTrail, createTrailState,
  resetTrailState, resolveTreadParams, textureStemOf,
  trailStampCorners, treadAlphaAt, treadScaleFor, TRAIL_LIFT, TREAD_FADE,
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
  it('绘制窗口取较长侧并显式隐藏较短侧空槽（review P2 2026-10-11：转弯 L≠R 不截长边）', () => {
    expect(sceneSrc).toMatch(/Math\.min\(Math\.max\(tr\.L\.total, tr\.R\.total\), TRAIL_CAP_PER_SIDE\)/)
    expect(sceneSrc).toMatch(/for \(let k = st\.total; k < pairs; k\+\+\)/)
  })
  it('关断重开必须复位两侧路径态（不只回退 builtT；review P2 2026-10-11）', () => {
    expect(sceneSrc).toMatch(/if \(tr\.builtT !== -Infinity \|\| tr\.L\.total \|\| tr\.R\.total\) \{\s*resetTrailState\(tr\.L\); resetTrailState\(tr\.R\);/)
  })
  it('alpha 比较必须走 Math.fround 量化门控（review P3 2026-10-11：double 严格比较恒为脏）', () => {
    expect(sceneSrc).toMatch(/const a = Math\.fround\(treadAlphaAt\(T - seg\.t\) \* TREAD_OPACITY/)
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

describe('advanceTrail', () => {
  it('直线 10 m / space 1.0 → 10 戳，横截面依次落在 1..10（相邻戳共享边）', () => {
    const st = createTrailState()
    const added = advanceTrail(st, line(0, 0, 1, 0, 1, 10), 1.0, 1e9)
    expect(added).toBe(10)
    expect(st.segs.map((s) => s.x1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(st.segs.map((s) => s.x0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    for (let k = 1; k < st.segs.length; k++) {
      // 不变量：前戳的远端 = 后戳的近端（共享整条横截面）
      expect(st.segs[k].x0).toBe(st.segs[k - 1].x1)
      expect(st.segs[k].z0).toBe(st.segs[k - 1].z1)
      expect(st.segs[k].yaw0).toBe(st.segs[k - 1].yaw1)
    }
    expect(st.segs[0].t).toBeCloseTo(1)   // 戳携带出生时刻（寿命淡出用）
  })
  it('首步只作锚点不出戳；累积跨过 space 后出一戳（远端 = 交会点，步内插值）', () => {
    const st = createTrailState()
    expect(advanceTrail(st, [{ x: 0, z: 0, t: 0, yaw: 0 }, { x: 0.6, z: 0, t: 1, yaw: 0 }], 1.0, 1e9)).toBe(0)
    expect(advanceTrail(st, [{ x: 1.2, z: 0, t: 2, yaw: 0 }], 1.0, 1e9)).toBe(1)
    // 交会点 = 累计 1.0 处：本步 0.6→1.2 内 f=(1.0−0.6)/0.6 → x = 0.6+0.6·(1/3)… 精确 1.0
    expect(st.segs[0].x0).toBeCloseTo(0)
    expect(st.segs[0].x1).toBeCloseTo(1.0)
    const n = line(0, 0, 1, 0, 1, 10)
    const st2 = createTrailState()
    advanceTrail(st2, n, 1.0, 1e9)
    for (let k = 1; k < st2.segs.length; k++) expect(st2.segs[k].x0).toBe(st2.segs[k - 1].x1)
  })
  it('采样粒度不影响戳数与横截面位置（交会点插值使其精确一致）', () => {
    const st = createTrailState()
    advanceTrail(st, line(0, 0, 1, 0, 0.1, 10), 1.0, 1e9)           // 10 小步走 1 m
    const big = createTrailState()
    advanceTrail(big, [{ x: 0, z: 0, t: 0, yaw: 0 }, { x: 1, z: 0, t: 1, yaw: 0 }], 1.0, 1e9)
    expect(big.segs.length).toBe(st.segs.length)
    expect(big.segs[0].x1).toBeCloseTo(st.segs[0].x1)   // 交会点由距离分数决定 ⇒ 与步长无关
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
    expect(st.segs.every((sg) => Number.isFinite(sg.x0) && Number.isFinite(sg.x1))).toBe(true)
  })

  it('环形上限：覆写最老槽位（槽位 = 绝对序号 % cap），total 持续累计', () => {
    const st = createTrailState()
    const added = advanceTrail(st, line(0, 0, 1, 0, 1, 12), 1.0, 10)
    expect(added).toBe(12)
    expect(st.total).toBe(12)
    expect(st.segs.length).toBe(10)
    expect(st.head).toBe(2)                       // 下一覆写槽 = 12 % 10
    // 槽位不变量：segs[k % cap] = 绝对序号 k 的戳（老戳被覆写、新戳照常可寻址）
    expect(st.segs[0].x1).toBeCloseTo(11)          // 槽 0 已被绝对序号 10 覆写（远端 = 11 m）
    expect(st.segs[1].x1).toBeCloseTo(12)          // 槽 1 = 绝对序号 11
    expect(st.segs[7].x1).toBeCloseTo(8)           // 槽 7 仍是绝对序号 7
  })
  it('转向：横截面位置沿路径、朝向随点携带（在段内插值）', () => {
    const st = createTrailState()
    advanceTrail(st, [
      { x: 0, z: 0, t: 0, yaw: 0 },
      { x: 2, z: 0, t: 2, yaw: 0 },
      { x: 2, z: 2, t: 4, yaw: Math.PI / 2 },
    ], 1.0, 1e9)
    expect(st.total).toBe(4)
    const last = st.segs[st.segs.length - 1]
    expect(last.z1).toBeCloseTo(2)         // 最后一戳远端落在 z=2
    expect(last.x1).toBeCloseTo(2)
    // 朝向在 0→90° 段内插值：末戳 yaw1 = 90°
    expect(last.yaw1).toBeCloseTo(Math.PI / 2)
  })
  it('space 非法 / 零位移步 → 不出段不漂移', () => {
    const st = createTrailState()
    expect(advanceTrail(st, line(0, 0, 1, 0, 1, 5), 0, 1e9)).toBe(0)
    expect(advanceTrail(st, [{ x: 3, z: 0 }, { x: 3, z: 0 }], 1.0, 1e9)).toBe(0)
  })
  it('停车再起步：静止样本推进采样时刻（新戳出生时刻不倒退到停车前；review P2 2026-10-11）', () => {
    // 复现现场：走到 0.8 m（t≈0.16）后停在原地到 t=100（位姿采样继续、位置不变），
    // 再走到 1.3（t=100.1）。旧实现零位移直接 continue ⇒ st.t 冻在 0.16，跨过 1.0 m
    // 打戳边界时在 0.16→100.1 之间插值，出生时刻被算成 40.1 s（实际 100.04 s）⇒
    // 那一刻 alpha=0，新印记一出生就不可见。
    const st = createTrailState()
    const added = advanceTrail(st, [
      { x: 0, z: 0, t: 0, yaw: 0 },
      { x: 0.8, z: 0, t: 0.16, yaw: 0 },
      { x: 0.8, z: 0, t: 100, yaw: 0 },
      { x: 1.3, z: 0, t: 100.1, yaw: 0 },
    ], 0.5, 64)
    expect(added).toBe(2)                        // 0.5 m 与 1.0 m 两戳（静止段不出戳）
    const last = st.segs[st.total - 1]
    expect(last.t).toBeCloseTo(100.04, 6)        // 1.0 m 界在 0.8→1.3 步内 f=0.4：100 + 0.1×0.4
  })
  it('静止期间的原地转向：停顿不新出戳，转向扫掠落在跨转向的那一戳上（扭转四边形）', () => {
    const st = createTrailState()
    advanceTrail(st, [
      { x: 0, z: 0, t: 0, yaw: 0 },
      { x: 1.0, z: 0, t: 1, yaw: 0 },
      { x: 1.0, z: 0, t: 2, yaw: Math.PI / 2 },   // 原地转 90°（零位移）
      { x: 1.0, z: 1.0, t: 3, yaw: Math.PI / 2 },
    ], 0.5, 64)
    expect(st.total).toBe(4)                     // 0.5 / 1.0 / 1.5 / 2.0 m：转向段不额外出戳
    expect(st.segs[1].yaw0).toBeCloseTo(0)       // 1.0 m 戳（转向之前）朝向未变
    expect(st.segs[1].yaw1).toBeCloseTo(0)
    // 跨转向的戳从旧朝向横截面扫到新朝向横截面（覆盖原地转向掠过的区域）
    expect(st.segs[2].yaw0).toBeCloseTo(0)
    expect(st.segs[2].yaw1).toBeCloseTo(Math.PI / 2)
    expect(st.segs[3].yaw0).toBeCloseTo(Math.PI / 2)
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
    const st = { hasLast: false, acc: 0, segs: [], head: 0, total: 0, written: 0,
                 lastMark: { x: 0, z: 0, yaw: 0, t: 0 } }
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
