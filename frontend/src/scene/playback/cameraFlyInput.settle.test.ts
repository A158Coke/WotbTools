// @vitest-environment happy-dom
// 自由相机 pointer 交互收口（评审 P2）：HIGH 档反射隔帧时，pointerup / pointercancel /
// 丢失按键后的最后相机姿态必须显式 requestRefresh + invalidate，不能等下一帧 flyTick。
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createCameraFlyInput } from './cameraFlyInput.ts'

function setup() {
  const refresh = vi.fn()
  const invalidate = vi.fn()
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 4000)
  camera.position.set(0, 50, 50)
  camera.lookAt(new THREE.Vector3(0, 0, 0))
  camera.updateMatrixWorld(true)
  const controls = { enabled: false, target: new THREE.Vector3(0, 0, 0) }
  const container = {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  }
  const deps = {
    container,
    debug: false,
    getControls: () => controls,
    getCamera: () => camera,
    getRaycaster: () => new THREE.Raycaster(),
    vehicles: { getVehicles: () => [] },
    annotationScene: { annotationToolActive: () => false },
    onVehicleSelect: vi.fn(),
    invalidate,
    requestWaterReflectionRefresh: refresh,
  }
  const input = createCameraFlyInput(deps as never, {
    cam: () => 'free',
    markManual: () => {},
    constrainFreeCameraAltitude: () => false,
  })
  return { input, refresh, invalidate }
}

function pointer(clientX: number, clientY: number, extra: Record<string, unknown> = {}) {
  return {
    pointerType: 'mouse',
    pointerId: 1,
    button: 0,
    buttons: 1,
    clientX,
    clientY,
    preventDefault() {},
    stopPropagation() {},
    ...extra,
  } as unknown as PointerEvent
}

describe('free camera pointer release settles reflection', () => {
  it('pointer drag release 收口一次：强制反射 + 安排 dirty frame', () => {
    const { input, refresh, invalidate } = setup()
    input.onFlyCaptureDown(pointer(10, 10))
    input.onFlyCaptureMove(pointer(40, 60))
    refresh.mockClear()
    invalidate.mockClear()

    input.onFlyCaptureUp(pointer(40, 60, { buttons: 0 }))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('pointercancel 结束拖拽时同样收口', () => {
    const { input, refresh, invalidate } = setup()
    input.onFlyCaptureDown(pointer(10, 10))
    input.onFlyCaptureMove(pointer(40, 60))
    refresh.mockClear()
    invalidate.mockClear()

    input.onFlyCaptureCancel(pointer(40, 60, { buttons: 0 }))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('捕获丢失 up（move 时已无按键）也收口，避免停在旧反射', () => {
    const { input, refresh, invalidate } = setup()
    input.onFlyCaptureDown(pointer(10, 10))
    input.onFlyCaptureMove(pointer(40, 60))
    refresh.mockClear()
    invalidate.mockClear()

    input.onFlyCaptureMove(pointer(40, 60, { buttons: 0 }))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledTimes(1)
  })
})
