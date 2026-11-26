import { describe, expect, it } from 'vitest'
import { createAnnotationGesture } from './annotationGesture.ts'
import { createAnnotationLayer } from './annotationLayer.ts'

function pointer(type, pointerId) {
  const event = new Event(type)
  Object.assign(event, { pointerId, pointerType: 'touch', button: 0, clientX: 10, clientY: 10 })
  return event
}

describe('annotation touch pointer lifecycle', () => {
  it('temporary visibility changes cancel strokes without resetting pointer state', () => {
    let cancelled = 0
    let reset = 0
    const layer = createAnnotationLayer({
      getScene: () => null,
      invalidate() {},
      debug: false,
      perfEnabled: () => false,
      annotationSurfaceHeightAt: () => 0,
      stats: { committedBuilds: 0, draftBuilds: 0, eraseCallbacks: 0, terrainRebuilds: 0,
        lastBuildMs: 0, lastPickMs: 0, committedVertices: 0, draftVertices: 0 },
      cancelGesture: () => { cancelled++ },
      resetPointerState: () => { reset++ },
      debugProbe: () => ({}),
    })

    layer.setAnnotationsVisible(false)
    layer.setAnnotationsVisible(true)
    expect(cancelled).toBe(1)
    expect(reset).toBe(0)

    layer.clearSessionProjection()
    expect(cancelled).toBe(2)
    expect(reset).toBe(1)
  })

  it('temporary hide keeps held pointers suppressed until every finger is released', () => {
    const container = new EventTarget()
    let visible = true
    const layer = {
      setDraft() {}, rebuildDraft() {}, setRingPositions() {}, hasRing: () => false,
      ensure: () => true,
    }
    const picker = {
      semanticPoint: (point) => point,
      annotationSemanticWidth: (width) => width,
      sceneFromSemantic: (point) => point,
    }
    const gesture = createAnnotationGesture({
      container,
      invalidate() {},
      interaction: () => ({ enabled: true, tool: 'pen', color: '#fff', width: 3, eraserWidth: 16 }),
      toolActive: () => true,
      pick: () => ({ semantic: { x: 1, y: 1 } }),
      visible: () => visible,
      getControls: () => null,
      annotationSurfaceHeightAt: () => 0,
      layer,
      picker,
      stats: { eraseCallbacks: 0 },
    })
    gesture.attachListeners()

    container.dispatchEvent(pointer('pointerdown', 1))
    expect(gesture.hasGesture()).toBe(true)
    container.dispatchEvent(pointer('pointerdown', 2))
    expect(gesture.hasGesture()).toBe(false)

    visible = false
    gesture.cancelAnnotationGesture()
    visible = true
    container.dispatchEvent(pointer('pointerup', 2))
    container.dispatchEvent(pointer('pointerdown', 3))
    expect(gesture.hasGesture()).toBe(false)

    container.dispatchEvent(pointer('pointerup', 1))
    container.dispatchEvent(pointer('pointerup', 3))
    container.dispatchEvent(pointer('pointerdown', 4))
    expect(gesture.hasGesture()).toBe(true)
    gesture.detach()
  })
})
