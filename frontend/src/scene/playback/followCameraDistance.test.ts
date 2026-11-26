import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  FOLLOW_FALLBACK_RADIUS_M,
  FOLLOW_MODEL_CLEARANCE_M,
  followCameraMinDistance,
  followModelRadius,
} from './followCameraDistance.js'
import type { RuntimeVehicle } from './vehicleRuntime.js'

function groupAt(x: number, z: number, sizeX: number, sizeY: number, sizeZ: number): THREE.Group {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  group.add(new THREE.Mesh(new THREE.BoxGeometry(sizeX, sizeY, sizeZ), new THREE.MeshBasicMaterial()))
  group.updateMatrixWorld(true)
  return group
}

function vehicle(group: THREE.Group, glb: THREE.Object3D | null = null): RuntimeVehicle {
  return { group, glb } as unknown as RuntimeVehicle
}

describe('followCameraMinDistance', () => {
  it('低模履带外廓：水平外接半径 + 1 m', () => {
    const v = vehicle(groupAt(0, 0, 3.6, 0.75, 6.5))
    expect(followCameraMinDistance(v)).toBeCloseTo(Math.hypot(1.8, 3.25) + FOLLOW_MODEL_CLEARANCE_M, 6)
  })

  it('用 GLB 而不是低模量外廓（GLB 优先）', () => {
    const v = vehicle(groupAt(0, 0, 3.6, 0.75, 6.5), groupAt(0, 0, 2, 1, 9))
    expect(followCameraMinDistance(v)).toBeCloseTo(Math.hypot(1, 4.5) + 1, 6)
  })

  it('以车体位姿原点量半径：模型偏心时取最远一侧', () => {
    const group = new THREE.Group()
    group.position.set(0, 0, 0)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), new THREE.MeshBasicMaterial())
    mesh.position.set(5, 0, 0)
    group.add(mesh)
    group.updateMatrixWorld(true)
    expect(followModelRadius(vehicle(group))).toBeCloseTo(Math.hypot(6, 1), 6)
  })

  it('模型/包围盒不可用时退回低模外廓，绝不回到 20 m', () => {
    expect(followCameraMinDistance(null)).toBeCloseTo(FOLLOW_FALLBACK_RADIUS_M + 1, 6)
    expect(followCameraMinDistance(vehicle(new THREE.Group()))).toBeCloseTo(FOLLOW_FALLBACK_RADIUS_M + 1, 6)
    expect(followCameraMinDistance(null)).toBeLessThan(10)
  })
})
