import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { firstIndexAfter } from './seekPointer.ts'
import { playbackSceneSource } from './__tests__/sceneSource.ts'

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
  const src = playbackSceneSource()
  const seekTo = src.slice(src.indexOf('function seekTo'), src.indexOf('function seekTo') + 900)

  it('façade glue：seekTo 依次接线 resetShotsTo 与 transients.rewind（行为语义见 battleRuntime.seek.test.ts）', () => {
    expect(seekTo).toMatch(/battle\.resetShotsTo\(firstIndexAfter\(DATA\.shots, T,/)
    expect(seekTo).toMatch(/transients\.rewind\(T\)/)
  })
})

describe('地图边界来源（2026-11-17 用户裁示：删除旧边界带，只用客户端导出边界）', () => {
  // 旧实现 = playback/boundary.ts 按 playableBounds 程序化画红带；与客户端
  // MapBorderRenderObject 导出（scenery.glb 的 extras.mapBorder）在四周重复。
  // 现在后者是唯一边界来源；旧 band 的模块/调用/常量必须零残留。
  const mapWorldSrc = readFileSync(resolve(here, 'playback/mapWorld.ts'), 'utf8')
  const sceneSrc = playbackSceneSource()

  it('旧边界带（buildBoundary / BOUNDARY_THICK / boundary.js）零残留', () => {
    expect(mapWorldSrc).not.toMatch(/buildBoundary\(/)
    expect(mapWorldSrc).not.toMatch(/BOUNDARY_THICK/)
    expect(mapWorldSrc).not.toMatch(/boundary\.js/)
    expect(sceneSrc).not.toMatch(/createBoundaryBand/)
    expect(sceneSrc).not.toMatch(/BOUNDARY_THICK/)
  })

  it('客户端边界走 scenery extras.mapBorder（导出器 collect_map_border）', () => {
    const assemblySrc = readFileSync(resolve(here, 'sceneryAssembly.ts'), 'utf8')
    expect(assemblySrc).toMatch(/ud\.mapBorder/)
    expect(assemblySrc).toMatch(/makeMapBorderMaterial\(/)
  })
})

describe('相机钳制调用点（#827 窄化：Integration Contract）', () => {
  // 边界带行为已随旧边界模块删除；相机钳制属独立契约，保留窄化源码守卫。
  const mapWorldSrc = readFileSync(resolve(here, 'playback/mapWorld.ts'), 'utf8')
  const playbackSrc = playbackSceneSource()

  it('宿主保留钳制注入（clamp owner = cameraTerrainClamp，行为见 clamp.test）', () => {
    expect(playbackSrc).toMatch(/applyCameraClamp\(\);/)
    expect(playbackSrc).not.toMatch(/let baseMinDistance/)
  })
})
