import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createCameraZoom } from './cameraZoom.ts'
import { createFlyZoomSmoother, createZoomSmoother } from './zoomSmoothing.ts'

function setup(options: { flying: boolean; controlsEnabled?: boolean }) {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 4000)
  camera.position.set(0, 0, 100)
  const controls = {
    enabled: options.controlsEnabled ?? true,
    target: new THREE.Vector3(0, 0, 0),
    minDistance: 1,
    maxDistance: 1000,
  }
  const refresh = vi.fn()
  const invalidate = vi.fn()
  const markManual = vi.fn()
  const deps = {
    getCamera: () => camera,
    getControls: () => controls,
    getRenderer: () => ({}),
    invalidate,
    requestWaterReflectionRefresh: refresh,
  }
  const zoomSmoother = createZoomSmoother()
  const flyZoomSmoother = createFlyZoomSmoother()
  const zoom = createCameraZoom(deps as never, {
    flyLook: { pitch: 0, yaw: 0 },
    flyMode: () => options.flying,
    markManual,
    constrainFreeCameraAltitude: () => false,
    zoomSmoother,
    flyZoomSmoother,
  })
  return { camera, controls, refresh, invalidate, zoom, zoomSmoother, flyZoomSmoother }
}

function drainUntilSettled(
  zoom: { zoomTick(dt: number): void },
  smoother: { active(): boolean },
  refresh: ReturnType<typeof vi.fn>,
  finalRefreshes = 1,
) {
  let ticks = 0
  while (smoother.active()) {
    expect(ticks).toBeLessThan(1000)
    zoom.zoomTick(0.016)
    ticks++
    expect(refresh).toHaveBeenCalledTimes(smoother.active() ? 0 : finalRefreshes)
  }
  return ticks
}

describe('wheel zoom settles water reflection', () => {
  it('orbit：仅预算耗尽且相机变化的最后一帧刷新一次', () => {
    const { camera, refresh, invalidate, zoom, zoomSmoother } = setup({ flying: false })
    zoomSmoother.push(0.5)

    const ticks = drainUntilSettled(zoom, zoomSmoother, refresh)
    expect(ticks).toBeGreaterThan(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledTimes(ticks)
    expect(camera.position.length()).toBeLessThan(100)
    expect(camera.position.length()).toBeGreaterThan(0)

    zoom.zoomTick(0.016)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('fly：最后一帧到达终点时刷新一次，之后不重复', () => {
    const { camera, refresh, zoom, flyZoomSmoother } = setup({ flying: true })
    flyZoomSmoother.pushDisplacement(10)

    const ticks = drainUntilSettled(zoom, flyZoomSmoother, refresh)
    expect(ticks).toBeGreaterThan(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(camera.position.z).toBeLessThan(100)

    zoom.zoomTick(0.016)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('控件的缩放被禁用时预算耗尽也不刷新（没有姿态变化）', () => {
    const { refresh, zoom, zoomSmoother } = setup({ flying: false, controlsEnabled: false })
    zoomSmoother.push(0.5)

    const ticks = drainUntilSettled(zoom, zoomSmoother, refresh, 0)
    expect(ticks).toBeGreaterThan(1)
    expect(refresh).not.toHaveBeenCalled()
  })
})
