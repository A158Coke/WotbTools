// Recorder 开/退镜的反射调度 guard（源码级）：Arcade ↔ Sniper 是离散图层切换，
// 不能等 HIGH 档 intervalFrames 的下一次到期帧，否则镜面保留上一帧开镜车体。
// 自动相机过渡完成时同样要补齐最终投影。
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { createRecorderCamera } from './recorderCameraRuntime.ts'
import { BASE_FOV_DEG } from './cameraRig.ts'

vi.mock('../replaySource.js', () => ({
  loadRecorderCameraFromFile: async () => ({
    author_eid: 7, aim: { t: [0], yaw: [0], pitch: [0], ray_x: [0], ray_y: [0], ray_z: [80] },
    mode: { t: [0], raw: [1] }, zoom: { t: [], raw: [] }, bloom: { t: [], raw: [] },
    client_options: { backward_zoom: false },
  }),
}))

const read = (rel: string) => readFileSync(new NodeURL(rel, import.meta.url), 'utf8')

describe('Recorder 开/退镜强制刷新水面反射（源码级）', () => {
  it('离散 scoped 图层切换分支内请求单帧反射刷新', () => {
    const src = read('./recorderCameraRuntime.ts')
    const start = src.indexOf('if (hiddenEid !== scopedHiddenEid)')
    const end = src.indexOf('} else if (scoped && v.glb')
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const branch = src.slice(start, end)
    expect(branch).toMatch(/setScopedLayer\(v, scoped\);/)
    expect(branch).toMatch(/deps\.requestWaterReflectionRefresh\(\);/)
  })
})

it('暂停的相机入场混合及退出 FOV 恢复只在各自完成帧补绘倒影', async () => {
  const camera = new PerspectiveCamera(30, 1.5, 0.5, 4000)
  const controls = { target: new Vector3() }
  const refresh = vi.fn(), invalidate = vi.fn()
  const deps = {
    store: {}, getCamera: () => camera, getControls: () => controls,
    getData: () => ({ meta: { author_eid: 7 } }), getT: () => 0,
    destroyed: () => false, sessionEpoch: () => 1, writeHud: vi.fn(),
    vehicles: { vehicleByEid: () => ({ def: { eid: 7 } }), posAt: (_v: unknown, _t: number, out: Vector3) => out.set(4, 2, 8) },
    armorHighlightPref: () => false, deathAt: () => false, deathTimesOf: () => [],
    terrainHeightForCameraClamp: () => null, invalidate, requestWaterReflectionRefresh: refresh,
  }
  const runtime = createRecorderCamera(deps as never, {
    setCam: vi.fn(), prewarmArmorHighlight: vi.fn(), releaseArmorHighlight: vi.fn(), clearance: 1, hiddenLayer: 2,
  })
  runtime.loadRecorderCamera({ file: {} }, 1)
  await Promise.resolve()
  runtime.enterRecorderView()
  runtime.driveRecorderCamera(0.1)
  expect(refresh).not.toHaveBeenCalled()
  invalidate.mockClear()
  runtime.driveRecorderCamera(0.15)
  expect(runtime.cameraBlend()).toBeNull()
  expect(invalidate).toHaveBeenCalled()
  expect(refresh).toHaveBeenCalledTimes(1)
  runtime.driveRecorderCamera(0.1)
  expect(refresh).toHaveBeenCalledTimes(1)

  camera.fov = 20
  runtime.leaveRecorderView()
  runtime.stepFovRestore(0.1)
  expect(refresh).toHaveBeenCalledTimes(1)
  invalidate.mockClear()
  runtime.stepFovRestore(0.15)
  expect(runtime.fovRestore()).toBeNull()
  expect(camera.fov).toBeCloseTo(BASE_FOV_DEG)
  expect(invalidate).toHaveBeenCalled()
  expect(refresh).toHaveBeenCalledTimes(2)
})
