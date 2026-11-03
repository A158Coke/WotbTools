// Wave C（#741）C4 批次的编译期负向证明：playback state / annotation / camera 边界。
// 锁定：地图取景几何契约（map2d index 的 worldBounds/orientation）、AnnotationHitLike
// 结构面、recorder facet 判别、erase ring 形状。@ts-expect-error 仅限本文件。
import { describe, expect, it } from 'vitest'
import { geometryMatches, selectMap2dSources, isValidIndex } from '../../data/map2dOverlay.js'
import type { Map2dBounds, Map2dIndex } from '../../data/map2dOverlay.js'
import { recorderModeAt, sampleRecorderCamera, isReversing, reticleRadiusPx } from './cameraRig.js'
import { buildEraserRing, sanitizePoints } from './annotation3d.js'
import { mountedShell, armorHighlightBlock } from './armorHighlight.js'
import type { HighlightConfig } from './armorHighlight.js'

describe('C4 playback state / annotation / camera 的编译期负向证明', () => {
  it('map2d：几何契约（worldBounds/orientation）不符时索引条目被拒', () => {
    const bounds: Map2dBounds = { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
    const good = {
      orientation: 'top=+Z,left=+X',
      width: 1254, height: 1254,
      worldBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 },
      sha256: 'a'.repeat(64), path: 'map2d/x.webp',
    }
    expect(geometryMatches(good, bounds)).toBe(true)
    expect(geometryMatches(good, { xMin: -300, xMax: 300, yMin: -300, yMax: 299 })).toBe(false)
    expect(geometryMatches({ ...good, orientation: 'top=+Y,left=+X' }, bounds)).toBe(false)

    // @ts-expect-error — negative compile proof: geometryMatches 的 bounds 缺 yMax（四值缺一不可）
    geometryMatches(good, { xMin: -300, xMax: 300, yMin: -300 })
  })

  it('map2d：决策纯函数的输入形状（schema/timestamp 门控）', () => {
    // @ts-expect-error — negative compile proof: 候选缺 source 判别（stored/remote）编译失败
    selectMap2dSources({ remoteIndex: null, storedIndex: null, embedded: null, boundsByCode: {} }, [{ index: null }])
    // schemaVersion 错误 → 全部包内（fail-closed）
    const bad = selectMap2dSources({
      remoteIndex: { schemaVersion: 1, generated: '2026-01-01T00:00:00Z', maps: {} } as Map2dIndex,
      storedIndex: null,
      embedded: { contentGeneratedAt: '2025-01-01T00:00:00Z', maps: { x: { sha256: 'a' } } },
      boundsByCode: {},
    })
    expect(bad.active).toBe(false)
    expect(isValidIndex(null)).toBe(false)
  })

  it('cameraRig：录像者 facet 判别与几何入参', () => {
    const facet = {
      version: 1 as const, author_eid: 7,
      aim: { t: [0], yaw: [0.1], pitch: [0], ray_x: [0], ray_y: [0], ray_z: [1] },
      mode: { t: [0], raw: [1] },
      zoom: { t: [0], raw: [10] },
      bloom: { t: [0], raw: [2] },
      client_options: { backward_zoom: null },
    }
    expect(recorderModeAt(facet, 0)).toBe('ARCADE')
    const sample = sampleRecorderCamera(facet, 0)
    expect(sample.mode).toBe('ARCADE')
    // @ts-expect-error — negative compile proof: facet 缺 zoom 列（Type31 缩放解码静默 NaN）
    sampleRecorderCamera({ ...facet, zoom: undefined }, 0)
    // @ts-expect-error — negative compile proof: 位置差分需要 {x,z} 形状（缺 x 字段的点对不行）
    isReversing({ z: 0 }, { x: 1, z: 0 }, 0)
    // @ts-expect-error — negative compile proof: reticleRadiusPx 缺 viewportH 编译失败
    reticleRadiusPx({ bloomRaw: 2, fovDeg: 55 })
  })

  it('annotation3d：semantic 点形状（缺 X/Y 或锚点方向不合法）', () => {
    const clean = sanitizePoints([{ x: 0, y: 0 }, { x: 3, y: 0 }])
    expect(clean.length).toBe(2)
    // @ts-expect-error — negative compile proof: 坐标必须是 {x, y}（数组/标量不能当语义点）
    sanitizePoints([[0, 0], [3, 0]])
    const ring = buildEraserRing({ x: 0, y: 0 }, 2, () => 1)
    expect(ring?.segments).toBe(48)
    // @ts-expect-error — negative compile proof: eraser center 缺 y（半径几何无法落位）
    buildEraserRing({ x: 0 }, 2, () => 1)
  })

  it('armorHighlight：mountedShell 弹表形状与资格判定', () => {
    const cfg: HighlightConfig = {
      shell_global_ids: [101, 102],
      caliber: 120,
      shells: [{ caliber: 120, penetration: 200, damage: 320, explosion_radius: 3 }],
    }
    const mounted = mountedShell(cfg, 101)
    expect(mounted?.caliber).toBe(120)
    // @ts-expect-error — negative compile proof: shell_global_ids 必须是 number[]（联表 indexOf 的键域）
    const bad: HighlightConfig = { shell_global_ids: ['101'] }
    expect(bad).toBeTruthy()
    // 弹表缺 shells → mountedShell 返回 null（runtime fail-closed，与 JS 同式）
    expect(mountedShell({ shell_global_ids: [101] }, 101)).toBeNull()
    expect(armorHighlightBlock({
      targetTankId: 1, targetConfig: {}, authorConfig: cfg, shellId: null,
      targetEquipment: [], authorEquipment: [],
    })).toBe('shell_unknown')
  })
})
