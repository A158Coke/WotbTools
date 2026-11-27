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
    expect(dir.y).toBeGreaterThan(0.3)
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
    const timer = { begin: vi.fn(() => true), end: vi.fn() }
    refl.update(renderer, scene, cam, timer)
    refl.update(renderer, scene, cam, timer)
    refl.update(renderer, scene, cam, timer)
    expect(renderer.render).toHaveBeenCalledTimes(2)
    expect(timer.begin.mock.calls).toEqual([['reflection'], ['reflection']])
    expect(timer.end).toHaveBeenCalledTimes(2)
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
    expect(t2).not.toBe(t1)
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
    const timer = { begin: vi.fn(() => true), end: vi.fn() }
    expect(() => refl.update(renderer, scene, cam, timer)).toThrow('context lost')
    expect(timer.end).toHaveBeenCalledOnce()
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

describe('createWaterReflection 按需渲染强制刷新', () => {
  it('requestRefresh 让隔帧中的单次 dirty frame 也刷新；关档重置首帧', () => {
    const mesh = waterMesh()
    const scene = sceneWith([mesh])
    const renderer = fakeRenderer()
    const cam = camera(new THREE.Vector3(0, 60, 40), new THREE.Vector3(0, 0, 0))
    const refl = createWaterReflection({
      getWaterMeshes: () => [mesh], getWaterLevel: () => 0, intervalFrames: 2,
    })
    refl.setEnabled(true)
    refl.update(renderer, scene, cam)
    refl.update(renderer, scene, cam)
    expect(renderer.render).toHaveBeenCalledTimes(1)
    refl.requestRefresh()
    refl.update(renderer, scene, cam)
    expect(renderer.render).toHaveBeenCalledTimes(2)
    refl.setEnabled(false)
    refl.setEnabled(true)
    refl.update(renderer, scene, cam)
    expect(renderer.render).toHaveBeenCalledTimes(3)
    refl.dispose()
    refl.update(renderer, scene, cam)
    expect(renderer.render).toHaveBeenCalledTimes(4)
    refl.dispose()
  })

  it('HIGH 最后相机姿态落在跳过帧：Frame 4 收口刷新使用当前镜像相机，消费后恢复隔帧', () => {
    const mesh = waterMesh()
    const scene = sceneWith([mesh])
    const renderer = fakeRenderer()
    const cam = camera(new THREE.Vector3(0, 60, 40), new THREE.Vector3(0, 0, 0))
    const refl = createWaterReflection({
      getWaterMeshes: () => [mesh], getWaterLevel: () => 0, intervalFrames: 2,
    })
    refl.setEnabled(true)
    refl.update(renderer, scene, cam)
    refl.update(renderer, scene, cam)
    refl.update(renderer, scene, cam)
    expect(renderer.render).toHaveBeenCalledTimes(2)
    cam.position.set(12, 70, 30)
    cam.lookAt(new THREE.Vector3(20, 0, 0))
    cam.updateMatrixWorld(true)
    refl.requestRefresh()
    refl.update(renderer, scene, cam)
    expect(renderer.render).toHaveBeenCalledTimes(3)
    const mirrored = renderer.render.mock.calls.at(-1)![1] as THREE.PerspectiveCamera
    expect(mirrored).not.toBe(cam)
    expect(mirrored.position.x).toBeCloseTo(12, 6)
    expect(mirrored.position.y).toBeCloseTo(-70, 6)
    expect(mirrored.position.z).toBeCloseTo(30, 6)
    refl.update(renderer, scene, cam)
    expect(renderer.render).toHaveBeenCalledTimes(4)
    refl.update(renderer, scene, cam)
    expect(renderer.render).toHaveBeenCalledTimes(4)
    refl.dispose()
  })

  it('intervalFrames=1（ULTRA）仍每帧刷新，不受交互收口影响', () => {
    const mesh = waterMesh()
    const scene = sceneWith([mesh])
    const renderer = fakeRenderer()
    const cam = camera(new THREE.Vector3(0, 60, 40), new THREE.Vector3(0, 0, 0))
    const refl = createWaterReflection({
      getWaterMeshes: () => [mesh], getWaterLevel: () => 0, intervalFrames: 1,
    })
    refl.setEnabled(true)
    for (let i = 0; i < 4; i++) refl.update(renderer, scene, cam)
    expect(renderer.render).toHaveBeenCalledTimes(4)
    refl.dispose()
  })
})

describe('createWaterReflection 保守可见性剔除（W3）', () => {
  function horizontalWaterMesh(): THREE.Mesh {
    const mesh = waterMesh()
    mesh.rotation.x = -Math.PI / 2
    mesh.updateMatrixWorld(true)
    return mesh
  }

  it('水面完全不在主相机视锥内：跳过整个镜像 pass（含 timer/RT），可见后恢复', () => {
    const mesh = horizontalWaterMesh()
    const scene = sceneWith([mesh])
    const renderer = fakeRenderer()
    const timer = { begin: vi.fn(() => true), end: vi.fn() }
    const refl = createWaterReflection({ getWaterMeshes: () => [mesh], getWaterLevel: () => 0 })
    refl.setEnabled(true)
    const lookingUp = camera(new THREE.Vector3(0, 60, 40), new THREE.Vector3(0, 500, 40))
    refl.update(renderer, scene, lookingUp, timer)
    expect(renderer.render).not.toHaveBeenCalled()
    expect(timer.begin).not.toHaveBeenCalled()
    const lookingDown = camera(new THREE.Vector3(0, 60, 40), new THREE.Vector3(0, 0, 0))
    refl.update(renderer, scene, lookingDown, timer)
    expect(renderer.render).toHaveBeenCalledTimes(1)
    expect(timer.begin).toHaveBeenCalledOnce()
    refl.dispose()
  })

  it('隔帧档从视锥外重入恰逢非到期帧：可见性转移必须当帧刷新，下一帧恢复隔帧', () => {
    const mesh = horizontalWaterMesh()
    const scene = sceneWith([mesh])
    const renderer = fakeRenderer()
    const refl = createWaterReflection({ getWaterMeshes: () => [mesh], getWaterLevel: () => 0, intervalFrames: 2 })
    refl.setEnabled(true)
    const lookingUp = camera(new THREE.Vector3(0, 60, 40), new THREE.Vector3(0, 500, 40))
    const lookingDown = camera(new THREE.Vector3(0, 60, 40), new THREE.Vector3(0, 0, 0))
    refl.update(renderer, scene, lookingDown)
    refl.update(renderer, scene, lookingDown)
    refl.update(renderer, scene, lookingUp)
    expect(renderer.render).toHaveBeenCalledTimes(1)
    refl.update(renderer, scene, lookingDown)
    expect(renderer.render).toHaveBeenCalledTimes(2)
    refl.update(renderer, scene, lookingDown)
    expect(renderer.render).toHaveBeenCalledTimes(3)
    refl.update(renderer, scene, lookingDown)
    expect(renderer.render).toHaveBeenCalledTimes(3)
    refl.dispose()
  })

  it('被剔除的帧不消耗 requestRefresh：水面重新可见的下一帧仍强制刷新', () => {
    const mesh = horizontalWaterMesh()
    const scene = sceneWith([mesh])
    const renderer = fakeRenderer()
    const refl = createWaterReflection({ getWaterMeshes: () => [mesh], getWaterLevel: () => 0, intervalFrames: 100 })
    refl.setEnabled(true)
    const lookingUp = camera(new THREE.Vector3(0, 60, 40), new THREE.Vector3(0, 500, 40))
    const lookingDown = camera(new THREE.Vector3(0, 60, 40), new THREE.Vector3(0, 0, 0))
    refl.update(renderer, scene, lookingUp)
    expect(renderer.render).not.toHaveBeenCalled()
    refl.requestRefresh()
    refl.update(renderer, scene, lookingUp)
    expect(renderer.render).not.toHaveBeenCalled()
    refl.update(renderer, scene, lookingDown)
    expect(renderer.render).toHaveBeenCalledTimes(1)
    refl.update(renderer, scene, lookingDown)
    expect(renderer.render).toHaveBeenCalledTimes(1)
    refl.dispose()
  })

  it('包围体不确定（几何缺失）时 fail-open，照常绘制', () => {
    const notAMesh = new THREE.Object3D()
    notAMesh.position.set(0, 0, 0)
    const scene = sceneWith([notAMesh])
    const renderer = fakeRenderer()
    const cam = camera(new THREE.Vector3(0, 60, 40), new THREE.Vector3(0, 0, 0))
    const refl = createWaterReflection({ getWaterMeshes: () => [notAMesh], getWaterLevel: () => 0 })
    refl.setEnabled(true)
    refl.update(renderer, scene, cam)
    expect(renderer.render).toHaveBeenCalledTimes(1)
    refl.dispose()
  })

  it('水面在远裁剪面之外：剔除，不重建 RT', () => {
    const mesh = horizontalWaterMesh()
    mesh.position.z = 100000
    mesh.updateMatrixWorld(true)
    const scene = sceneWith([mesh])
    const renderer = fakeRenderer()
    const cam = camera(new THREE.Vector3(0, 60, 0), new THREE.Vector3(0, 0, 0))
    const refl = createWaterReflection({ getWaterMeshes: () => [mesh], getWaterLevel: () => 0 })
    refl.setEnabled(true)
    refl.update(renderer, scene, cam)
    expect(renderer.render).not.toHaveBeenCalled()
    expect(refl.debugTarget()).toBeNull()
    refl.dispose()
  })
})
