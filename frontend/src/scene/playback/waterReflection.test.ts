// 水面动态反射镜像相机单测（纯函数）：水平镜面 y=level 的位置/朝向/裁剪面。
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createWaterReflection, mirrorCameraForPlane } from './waterReflection.js'
import { QUALITY_PRESETS } from './quality.js'

function camera(pos: THREE.Vector3, target: THREE.Vector3): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 4000)
  c.position.copy(pos)
  c.up.set(0, 1, 0)
  c.lookAt(target)
  c.updateMatrixWorld(true)
  return c
}

describe('mirrorCameraForPlane', () => {
  it('相机在水面上方：位置沿 y 镜像、朝向反射、投影带斜裁剪', () => {
    const cam = camera(new THREE.Vector3(10, 50, 20), new THREE.Vector3(30, 0, 25))
    const out = new THREE.PerspectiveCamera()
    expect(mirrorCameraForPlane(cam, 14.5, out)).toBe(true)
    expect(out.position.x).toBeCloseTo(10, 6)
    expect(out.position.y).toBeCloseTo(2 * 14.5 - 50, 6)
    expect(out.position.z).toBeCloseTo(20, 6)
    const dir = new THREE.Vector3()
    out.getWorldDirection(dir)
    expect(dir.y).toBeGreaterThan(0.3)      // 主相机俯视 ⇒ 镜像相机仰视
    // 斜裁剪：投影矩阵被改写（不等于原相机的普通投影）
    expect(out.projectionMatrix.elements[14]).not.toBeCloseTo(cam.projectionMatrix.elements[14], 8)
  })

  it('相机在水面以下 / 与水面重合：不产生反射', () => {
    const out = new THREE.PerspectiveCamera()
    expect(mirrorCameraForPlane(camera(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, 0, 0)), 14.5, out)).toBe(false)
    expect(mirrorCameraForPlane(camera(new THREE.Vector3(0, 14.5, 0), new THREE.Vector3(0, 0, 0)), 14.5, out)).toBe(false)
  })

  it('正俯视也产生有效反射（up 取相机实际基，不与反射 forward 共线）', () => {
    const out = new THREE.PerspectiveCamera()
    const cam = camera(new THREE.Vector3(0, 595, 0.6), new THREE.Vector3(0, 0, 0))
    expect(mirrorCameraForPlane(cam, 14.5, out)).toBe(true)
    expect(Number.isFinite(out.quaternion.x)).toBe(true)
    expect(Number.isFinite(out.projectionMatrix.elements[14])).toBe(true)
  })

  it('画质门禁：仅高清/极致启用动态反射', () => {
    expect(QUALITY_PRESETS.low.waterReflection).toBe(false)
    expect(QUALITY_PRESETS.mid.waterReflection).toBe(false)
    expect(QUALITY_PRESETS.high.waterReflection).toBe(true)
    expect(QUALITY_PRESETS.ultra.waterReflection).toBe(true)
  })
})

// 伪渲染器：只观察反射 pass 的调用次数与 RT 尺寸（不建真实 GL 上下文）。
function fakeRenderer(width = 800, height = 600) {
  const render = vi.fn()
  const setRenderTarget = vi.fn()
  return {
    render,
    setRenderTarget,
    getRenderTarget: () => null,
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(width, height),
  } as unknown as THREE.WebGLRenderer & { render: ReturnType<typeof vi.fn> }
}

function waterMesh() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uReflectionTex: { value: null },
      uReflectionMatrix: { value: new THREE.Matrix4() },
      uUseReflection: { value: 0 },
    },
  })
  return new THREE.Mesh(new THREE.PlaneGeometry(10, 10), mat)
}

function sceneWith(meshes: THREE.Object3D[]) {
  const scene = new THREE.Scene()
  for (const m of meshes) scene.add(m)
  return scene
}

describe('createWaterReflection 画质档', () => {
  it('隔帧更新：intervalFrames=2 时只在第 1/3/5… 帧渲染反射', () => {
    const mesh = waterMesh()
    const scene = sceneWith([mesh])
    const renderer = fakeRenderer()
    const cam = camera(new THREE.Vector3(0, 60, 40), new THREE.Vector3(0, 0, 0))
    const refl = createWaterReflection({
      getWaterMeshes: () => [mesh],
      getWaterLevel: () => 0,
      intervalFrames: 2,
    })
    refl.setEnabled(true)
    refl.update(renderer, scene, cam)
    refl.update(renderer, scene, cam)
    refl.update(renderer, scene, cam)
    expect(renderer.render).toHaveBeenCalledTimes(2)
    refl.dispose()
    expect((mesh.material as THREE.ShaderMaterial).uniforms.uUseReflection.value).toBe(0)
  })

  it('RT 比例来自画质档：scale=0.25 建 1/4 尺寸，configure 可运行时改档', () => {
    const mesh = waterMesh()
    const scene = sceneWith([mesh])
    const renderer = fakeRenderer()
    const cam = camera(new THREE.Vector3(0, 60, 40), new THREE.Vector3(0, 0, 0))
    const refl = createWaterReflection({
      getWaterMeshes: () => [mesh],
      getWaterLevel: () => 0,
      scale: 0.25,
      intervalFrames: 1,
    })
    refl.setEnabled(true)
    refl.update(renderer, scene, cam)
    const t1 = refl.debugTarget()
    expect(t1).toBeTruthy()
    expect(t1!.width).toBe(200)
    expect(t1!.height).toBe(150)

    refl.configure({ scale: 0.5 })
    refl.update(renderer, scene, cam)
    const t2 = refl.debugTarget()
    expect(t2).not.toBe(t1)          // 比例变化 ⇒ 惰性重建
    expect(t2!.width).toBe(400)
    expect(t2!.height).toBe(300)
    refl.dispose()
  })
})

describe('createWaterReflection 覆盖层剔除（W3）', () => {
  it('反射 pass 期间隐藏草/特效/标注根，渲染后恢复', () => {
    const mesh = waterMesh()
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    const scene = sceneWith([mesh, root])
    const renderer = fakeRenderer()
    let seenDuringRender: boolean | null = null
    ;(renderer.render as ReturnType<typeof vi.fn>).mockImplementation(() => {
      seenDuringRender = root.visible
    })
    const cam = camera(new THREE.Vector3(0, 60, 40), new THREE.Vector3(0, 0, 0))
    const refl = createWaterReflection({
      getWaterMeshes: () => [mesh],
      getWaterLevel: () => 0,
      getExcludedRoots: () => [root, null],
    })
    refl.setEnabled(true)
    refl.update(renderer, scene, cam)
    expect(seenDuringRender).toBe(false)
    expect(root.visible).toBe(true)
    refl.dispose()
  })

  it('反射渲染抛错时也恢复覆盖层与水面可见性', () => {
    const mesh = waterMesh()
    const root = new THREE.Group()
    const scene = sceneWith([mesh, root])
    const renderer = fakeRenderer()
    ;(renderer.render as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('context lost')
    })
    const cam = camera(new THREE.Vector3(0, 60, 40), new THREE.Vector3(0, 0, 0))
    const refl = createWaterReflection({
      getWaterMeshes: () => [mesh],
      getWaterLevel: () => 0,
      getExcludedRoots: () => [root],
    })
    refl.setEnabled(true)
    expect(() => refl.update(renderer, scene, cam)).toThrow('context lost')
    expect(root.visible).toBe(true)
    expect(mesh.visible).toBe(true)
    refl.dispose()
  })
})

describe('createWaterReflection 关档释放', () => {
  it('setEnabled(false) 释放 RT 与材质引用；再开档按当前比例重建', () => {
    const mesh = waterMesh()
    const scene = sceneWith([mesh])
    const renderer = fakeRenderer()
    const cam = camera(new THREE.Vector3(0, 60, 40), new THREE.Vector3(0, 0, 0))
    const refl = createWaterReflection({
      getWaterMeshes: () => [mesh],
      getWaterLevel: () => 0,
      scale: 0.25,
    })
    const uniforms = (mesh.material as THREE.ShaderMaterial).uniforms
    refl.setEnabled(true)
    refl.update(renderer, scene, cam)
    expect(refl.debugTarget()).toBeTruthy()
    refl.setEnabled(false)
    expect(refl.debugTarget()).toBeNull()
    expect(uniforms.uUseReflection.value).toBe(0)
    expect(uniforms.uReflectionTex.value).toBeNull()
    refl.setEnabled(true)
    refl.update(renderer, scene, cam)
    expect(refl.debugTarget()!.width).toBe(200)
    expect(uniforms.uUseReflection.value).toBe(1)
    refl.dispose()
  })
})
