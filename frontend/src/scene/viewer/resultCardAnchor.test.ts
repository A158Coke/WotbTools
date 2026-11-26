import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { projectCardAnchor } from './resultCardAnchor.ts'

function cameraAt(x: number, y: number, z: number, look = new THREE.Vector3(0, 0, 0)) {
  const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 1000)
  camera.position.set(x, y, z)
  camera.lookAt(look)
  camera.updateMatrixWorld(true)
  return camera
}

describe('projectCardAnchor', () => {
  it('正对命中点：投影到画布中心', () => {
    const projected = projectCardAnchor(new THREE.Vector3(0, 0, 0), cameraAt(0, 0, 10), 800, 600)
    expect(projected).not.toBeNull()
    expect(projected!.inFront).toBe(true)
    expect(projected!.x).toBeCloseTo(400, 5)
    expect(projected!.y).toBeCloseTo(300, 5)
  })

  it('相机绕目标旋转后，同一世界命中点的屏幕投影改变（不是固定锚点）', () => {
    const anchor = new THREE.Vector3(2, 0, 0)
    const front = projectCardAnchor(anchor, cameraAt(0, 0, 10), 800, 600)!
    const side = projectCardAnchor(anchor, cameraAt(10, 0, 0), 800, 600)!
    expect(front.inFront).toBe(true)
    expect(side.inFront).toBe(true)
    expect(front.x).toBeGreaterThan(400)
    expect(side.x).toBeCloseTo(400, 5)
    expect(side.x).not.toBeCloseTo(front.x, 1)
  })

  it('垂直偏移：屏幕上方向与 y 轴相反（NDC y 向上）', () => {
    const above = projectCardAnchor(new THREE.Vector3(0, 2, 0), cameraAt(0, 0, 10), 800, 600)!
    const below = projectCardAnchor(new THREE.Vector3(0, -2, 0), cameraAt(0, 0, 10), 800, 600)!
    expect(above.y).toBeLessThan(300)
    expect(below.y).toBeGreaterThan(300)
  })

  it('相机后方的命中点标记为不可解释（inFront=false），不伪造屏幕位置', () => {
    const behind = projectCardAnchor(new THREE.Vector3(0, 0, 20), cameraAt(0, 0, 10), 800, 600)!
    expect(behind.inFront).toBe(false)
  })

  it('视口外但在相机前方：仍返回坐标交给卡片钳制（不隐藏）', () => {
    const outside = projectCardAnchor(new THREE.Vector3(100, 0, 0), cameraAt(0, 0, 10), 800, 600)!
    expect(outside.inFront).toBe(true)
    expect(outside.x).toBeGreaterThan(800)
  })

  it('非法输入 fail-closed：零尺寸视口 / 非有限坐标返回 null', () => {
    const camera = cameraAt(0, 0, 10)
    expect(projectCardAnchor(new THREE.Vector3(0, 0, 0), camera, 0, 600)).toBeNull()
    expect(projectCardAnchor(new THREE.Vector3(0, 0, 0), camera, 800, 0)).toBeNull()
    expect(projectCardAnchor(new THREE.Vector3(Number.NaN, 0, 0), camera, 800, 600)).toBeNull()
  })
})
