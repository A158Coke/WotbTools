// Wave C（#741）C2 批次的编译期负向证明：geometry / Three.js helper 边界。
// 过去 JS 能静默接受的错误数据形状（section 拼错 / Vector3 当 Quaternion /
// 把 buildPack 的失败包当有效网格用），现在编译期拦截。@ts-expect-error 仅限本文件。
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildPack, raycastGridAll, isClippedModuleHit } from './armorCollisionPack.js'
import type { PackEntry } from './armorCollisionPack.js'
import { poseFromYPR, yprScene } from './glbRig.js'
import { buildInstancedMesh, groupInstanceBatches } from './sceneryInstancing.js'
import type { InstanceEntry } from './sceneryInstancing.js'
import { fallStopAngle } from './destructibles.js'
import type { TrailStamp } from './treadMarks.js'
import { computeHeSplash } from './heSplash.js'
import type { HeLayer } from './heSplash.js'
import { createArmorShaderContext } from './viewer/armorShaders.js'

describe('C2 geometry / Three.js 边界的编译期负向证明', () => {
  it('armorCollisionPack：section 码名与打包失败包的判别', () => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial())
    mesh.name = 'hull1'
    const entry: PackEntry = { mesh, section: 'hull', thickness: 40, variant: null }
    // 打包失败（非刚性矩阵/坏 section）→ ok:false，调用方必须禁用续飞
    expect(buildPack([{ ...entry, thickness: -1 }]).ok).toBe(false)

    // @ts-expect-error — negative compile proof: section 拼写错误（'hull1'）不能通过编译（JS 时代会静默产出坏包）
    const bad: PackEntry = { mesh, section: 'hull1', thickness: 40, variant: null }
    expect(bad.thickness).toBe(40)

    const failed = buildPack([{ ...entry, thickness: -1 }])
    if (!failed.ok) {
      // @ts-expect-error — negative compile proof: ok:false 的失败包没有 meshes 字段，不能当有效包消费
      void failed.meshes
    }
  })

  it('armorCollisionPack：无 grid 时 raycastGridAll 返回 null，不得把失败网格当可用网格', () => {
    expect(raycastGridAll(null, new THREE.Vector3(), new THREE.Vector3(0, 0, -1))).toBeNull()
    expect(raycastGridAll({ ok: false, reason: 'grid-too-dense' }, new THREE.Vector3(), new THREE.Vector3(0, 0, -1))).toBeNull()

    const grid = { ok: true as const, dims: [2, 2, 2], cellSize: 1, gridMin: [0, 0, 0] as [number, number, number],
      cellTotal: 8, entryTotal: 0, triRows: 1, cellsData: new Float32Array(32), entriesData: new Float32Array(0), worldTrisData: new Float32Array(768 * 4) }
    // @ts-expect-error — negative compile proof: grid 缺 entriesData/worldTrisData 不能通过编译（DDA 会静默读空）
    raycastGridAll({ ok: true, dims: [1, 1, 1], cellSize: 1, gridMin: [0, 0, 0], cellTotal: 1, entryTotal: 0, triRows: 1, cellsData: new Float32Array(4) }, new THREE.Vector3(), new THREE.Vector3(0, 0, -1))
    expect(raycastGridAll(grid, new THREE.Vector3(), new THREE.Vector3(0, 0, -1))).toEqual([])
    expect(isClippedModuleHit('hull', new THREE.Vector3(), null)).toBe(false)
  })

  it('glbRig：out 参数只接受 Quaternion（Vector3 会静默错轴）', () => {
    const q = poseFromYPR(0.5, 0, 0)
    expect(q.isQuaternion).toBe(true)
    // @ts-expect-error — negative compile proof: Vector3 不能当姿态四元数输出目标
    yprScene(0.1, 0, 0, new THREE.Vector3())
  })

  it('sceneryInstancing：批次必须有 geometry + material（合批输入形状）', () => {
    const geometry = new THREE.PlaneGeometry(1, 1)
    const material = new THREE.MeshLambertMaterial()
    const entry: InstanceEntry = {
      node: new THREE.Mesh(geometry, material), name: 'n', geometry, material,
      matrix: new THREE.Matrix4(), x: 0, y: 0, z: 0, lm: null,
    }
    const batch = groupInstanceBatches([entry], Infinity)[0]
    const mesh = buildInstancedMesh(batch)
    expect(mesh.count).toBe(1)
    // @ts-expect-error — negative compile proof: batch 缺 items（实例矩阵来源）编译失败
    const incomplete: Parameters<typeof buildInstancedMesh>[0] = { geometry, material }
    expect(incomplete).toBeTruthy()
  })

  it('destructibles：sampleGround 采样签名与树状态形状', () => {
    // @ts-expect-error — negative compile proof: 采样函数签名 (lx, ly) => number，单参对象形式不接受
    fallStopAngle(128, { x: 0, y: 0, z: 0 }, 6, (p: { x: number }) => p.x)
  })

  it('treadMarks：戳四边形必须带锚点时刻 t（淡出窗判据）', () => {
    const seg: TrailStamp = { x0: 0, z0: 0, yaw0: 0, x1: 1, z1: 0, yaw1: 0, t: 5 }
    expect(seg.t).toBe(5)
    // @ts-expect-error — negative compile proof: 戳缺 t（锚点时刻）编译失败（淡出窗会静默 NaN）
    const bad: TrailStamp = { x0: 0, z0: 0, yaw0: 0, x1: 1, z1: 0, yaw1: 0 }
    expect(bad).toBeTruthy()
  })

  it('heSplash：层链必须有 primary 判别（无主装样本不得冒充有效）', () => {
    const rays: HeLayer[][] = [[{ armor: 10, primary: true, distance: 1, section: 'hull' }]]
    const result = computeHeSplash(rays, { damage: 400, explosionRadius: 5 })
    expect(result?.samples).toBe(1)
    // @ts-expect-error — negative compile proof: 层缺 primary 判别编译失败（样本统计会静默按无效处理）
    const bad: HeLayer = { armor: 10, distance: 1, section: 'hull' }
    expect(bad).toBeTruthy()
    if (result) {
      // @ts-expect-error — negative compile proof: result 的层链快照 best 是 nullable，未收窄不能读字段
      result.best.upper
      expect(result.best).not.toBeNull()
    }
  })

  it('armorShaders：spacedMaterial side 只接受 three 的 Side 常量', () => {
    const ctx = createArmorShaderContext()
    expect(ctx.spacedMaterial(40, 200, THREE.FrontSide)).toBeTruthy()
    // @ts-expect-error — negative compile proof: side 拼写错误（'both'）不能通过编译（JS 时代静默用默认值）
    ctx.spacedMaterial(40, 200, 'both')
    ctx.dispose()
  })
})
