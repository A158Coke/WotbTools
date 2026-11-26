import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { firstIndexAfter } from './seekPointer.ts'
import { playbackSceneSource } from './__tests__/sceneSource.ts'

const here = dirname(fileURLToPath(import.meta.url))

describe('firstIndexAfter（seek 游标语义）', () => {
  const events = [{ t: 10 }, { t: 20 }, { t: 30 }]

  it('seek 到 25s：跳过 10/20，指向 30s（不经补播历史 transient）', () => {
    const ptr = firstIndexAfter(events, 25)
    expect(ptr).toBe(2)
    expect(events.slice(0, ptr).every((e) => e.t <= 25)).toBe(true)
    expect(events[ptr].t).toBe(30)
  })

  it('跨过 30s 后仍会触发该事件（不是被永久丢弃）', () => {
    const ptr = firstIndexAfter(events, 25)
    let p = ptr
    const fired = []
    for (const T of [26, 28, 30, 31]) {
      while (p < events.length && events[p].t <= T) fired.push(events[p++].t)
    }
    expect(fired).toEqual([30])
  })

  it('边界：早于全部事件 / 晚于全部事件 / 恰好在事件时刻', () => {
    expect(firstIndexAfter(events, 5)).toBe(0)
    expect(firstIndexAfter(events, 35)).toBe(3)
    expect(firstIndexAfter(events, 10)).toBe(1)
    expect(firstIndexAfter([], 10)).toBe(0)
  })

  it('支持自定义取时刻函数（射击用 t_fire）', () => {
    const shots = [{ t_fire: 10 }, { t_fire: 20 }, { t_fire: 30 }]
    expect(firstIndexAfter(shots, 25, (s) => s.t_fire)).toBe(2)
  })
})

describe('playbackScene.seekTo 的游标接线（防回归）', () => {
  const src = playbackSceneSource()
  const seekTo = src.slice(src.indexOf('function seekTo'), src.indexOf('function seekTo') + 900)

  it('façade glue：seekTo 依次接线 resetShotsTo 与 transients.rewind（行为语义见 battleRuntime.seek.test.ts）', () => {
    expect(seekTo).toMatch(/battle\.resetShotsTo\(firstIndexAfter\(DATA\.shots, T,/)
    expect(seekTo).toMatch(/transients\.rewind\(T\)/)
  })
})

describe('地图边界来源（2026-11-17 用户裁示：删除旧边界带，只用客户端导出边界）', () => {
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
  const mapWorldSrc = readFileSync(resolve(here, 'playback/mapWorld.ts'), 'utf8')
  const playbackSrc = playbackSceneSource()

  it('宿主保留钳制注入（clamp owner = cameraTerrainClamp，行为见 clamp.test）', () => {
    expect(playbackSrc).toMatch(/applyCameraClamp\(\);/)
    expect(playbackSrc).not.toMatch(/let baseMinDistance/)
  })
})
