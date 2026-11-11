import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { firstIndexAfter } from './seekPointer.ts'

const here = dirname(fileURLToPath(import.meta.url))

describe('firstIndexAfter（seek 游标语义）', () => {
  // 评审要求的场景：事件在 10 / 20 / 30s，seek 到 25s
  const events = [{ t: 10 }, { t: 20 }, { t: 30 }]

  it('seek 到 25s：跳过 10/20，指向 30s（不经补播历史 transient）', () => {
    const ptr = firstIndexAfter(events, 25)
    expect(ptr).toBe(2)
    // 被跳过的全部 <= 25；指针处的事件 > 25（跨过时才会触发）
    expect(events.slice(0, ptr).every((e) => e.t <= 25)).toBe(true)
    expect(events[ptr].t).toBe(30)
  })

  it('跨过 30s 后仍会触发该事件（不是被永久丢弃）', () => {
    const ptr = firstIndexAfter(events, 25)
    // 复刻 tick 的消费条件：t <= T 才消费
    let p = ptr
    const fired = []
    for (const T of [26, 28, 30, 31]) {
      while (p < events.length && events[p].t <= T) fired.push(events[p++].t)
    }
    expect(fired).toEqual([30])
  })

  it('边界：早于全部事件 / 晚于全部事件 / 恰好在事件时刻', () => {
    expect(firstIndexAfter(events, 5)).toBe(0)      // 还没到 → 全部待触发
    expect(firstIndexAfter(events, 35)).toBe(3)     // 全过 → 游标到底
    expect(firstIndexAfter(events, 10)).toBe(1)     // 恰好等于：该事件视为已发生（与射击游标同式）
    expect(firstIndexAfter([], 10)).toBe(0)         // 空表不越界
  })

  it('支持自定义取时刻函数（射击用 t_fire）', () => {
    const shots = [{ t_fire: 10 }, { t_fire: 20 }, { t_fire: 30 }]
    expect(firstIndexAfter(shots, 25, (s) => s.t_fire)).toBe(2)
  })
})

describe('playbackScene.seekTo 的游标接线（防回归）', () => {
  // 行为语义已由行为测试接替（#827 Wave 1 Pilot）：
  //   - 游标重定/不补播历史/事件不丢弃 → playback/battleRuntime.seek.test.ts（运行生产代码）
  //   - rewind/clear 内部实现 → playback/transientFeedback3d.test.ts（既有模块行为测试）
  // 此处仅保留 façade seekTo 三行 glue 的 Integration Contract 守卫：场景内核依赖 WebGL
  // 无法实例化、宿主无注入点（F3 分类标注）。只重定 shotPtr 是 PR #411 的 P0——
  // transient 游标被 clearEffects 归零后会被紧随的 tick() 补播全部历史事件。
  const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')
  const seekTo = src.slice(src.indexOf('function seekTo'), src.indexOf('function seekTo') + 900)

  it('façade glue：seekTo 依次接线 resetShotsTo 与 transients.rewind（行为语义见 battleRuntime.seek.test.ts）', () => {
    expect(seekTo).toMatch(/battle\.resetShotsTo\(firstIndexAfter\(DATA\.shots, T,/)
    expect(seekTo).toMatch(/transients\.rewind\(T\)/)
  })
})

describe('边界 fail-closed（PR #411 P0-2）', () => {
  // buildBoundary 空边界语义已行为化（#827）：createBoundaryBand 工厂无需 WebGL，
  // 直接断言 build(null) 清空已有条带且不新增对象。调用点权威来源守卫（:83）随
  // mapWorld harness 移交 Wave 2。
  const mapWorldSrc = readFileSync(resolve(here, 'playback/mapWorld.ts'), 'utf8')

  it('buildBoundary 对空边界只清理不绘制（行为测试）', async () => {
    const { createBoundaryBand } = await import('./playback/boundary.ts')
    const added = []
    const band = createBoundaryBand({
      getScene: () => ({ add: (o) => added.push(o), remove: () => {} }),
      disposeObject3D: () => {},
      groundY: () => 0,
    })
    const bounds = { cx: 0, cz: 0, hx: 50, hz: 50 }
    band.build(bounds, 2)
    const countAfterBuild = added.length
    expect(countAfterBuild).toBeGreaterThan(0)
    band.build(null, 2)
    expect(added.length).toBe(countAfterBuild) // 只清理，不新增对象
    band.build(undefined, 2)
    expect(added.length).toBe(countAfterBuild)
  })

  it('调用点一律传权威 playableBoundsFor()，不再有车辆/地形范围兜底', () => {
    const calls = [...mapWorldSrc.matchAll(/buildBoundary\(([^;]*?), BOUNDARY_THICK\)/gs)].map((m) => m[1].trim())
    expect(calls.length).toBeGreaterThan(0)
    for (const arg of calls) expect(arg).toBe('playableBoundsFor()')
    // 兜底对象（车辆 ext / terrain span）不得再出现在边界构造里
    expect(mapWorldSrc).not.toMatch(/buildBoundary\(\{\s*cx, cz, hx: ext/)
    expect(mapWorldSrc).not.toMatch(/hx: \(\(heightMeta && heightMeta\.span\)/)
  })
})

describe('相机距离钳制（PR #411 P1-3）', () => {
  const src = readFileSync(resolve(here, 'playbackScene.js'), 'utf8')
  // 钳制实现 2026-11-05 出仓 playback/cameraTerrainClamp.ts（#820 Wave B6A），
  // 守卫随实现迁移（与边界带同纪律）；场景侧只保留注入与调用。
  const clampSrc = readFileSync(resolve(here, 'playback/cameraTerrainClamp.ts'), 'utf8')
  // 相机钳制调用 2026-11-06 出仓 playback/cameraRuntime.ts（#820 Step 2）
  const cameraSrc = readFileSync(resolve(here, 'playback/cameraRuntime.ts'), 'utf8')

  it('设置 controls.minDistance / maxDistance 且基于 ext', () => {
    expect(clampSrc).toMatch(/baseMinDistance = Math\.max\(20, ext \* 0\.08\)/)
    expect(clampSrc).toMatch(/controls\.minDistance = baseMinDistance/)
    expect(clampSrc).toMatch(/controls\.maxDistance = ext \* 2\.2/)
    expect(cameraSrc).toMatch(/controls\.minDistance = deps\.baseMinDistance\(\)/)
    expect(src).toMatch(/applyCameraClamp\(\);/)
  })

  it('基准距离只有模块一处分份状态，场景侧经 accessor 读取', () => {
    expect(src).toMatch(/baseMinDistance: \(\) => cameraTerrainClamp\.baseMinDistance\(\),/)
    expect(cameraSrc).toMatch(/controls\.minDistance = deps\.baseMinDistance\(\)/)
    expect(src).not.toMatch(/let baseMinDistance/)
  })
})
