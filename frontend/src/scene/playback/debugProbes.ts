import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three'

export interface DebugProbeArgs {
  renderer: WebGLRenderer
  scene: Scene | null
  camera: PerspectiveCamera | null
  controls: { target: { set(x: number, y: number, z: number): void } } | null
  cameraRuntime: { cam?: () => string } | null
}

export function installDebugProbes({ renderer, scene, camera, controls, cameraRuntime }: DebugProbeArgs): void {
  window.__renderInfo = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles })
  window.__scene = scene
  window.__renderer = renderer
  window.__threeCamera = camera
  window.__camera = camera
  window.__cameraInfo = () => ({
    pos: camera ? camera.position.toArray() : null,
    mode: cameraRuntime && cameraRuntime.cam ? cameraRuntime.cam() : null,
  })
  window.__debugView = (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => {
    if (!camera || !renderer) return false
    camera.position.set(px, py, pz)
    if (controls) controls.target.set(tx, ty, tz)
    camera.lookAt(tx, ty, tz)
    camera.updateMatrixWorld(true)
    return true
  }
  window.__rows = (fracs: number[]) => {
    if (!renderer) return null
    const gl = renderer.getContext()
    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    const out: number[][] = []
    for (const f of fracs) {
      const y = Math.min(height - 1, Math.max(0, Math.round(f * (height - 1))))
      const buf = new Uint8Array(width * 4)
      gl.readPixels(0, y, width, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      const lum = new Array(64).fill(0)
      const per = Math.max(1, Math.floor(width / 64))
      for (let i = 0; i < width; i++) {
        const o = i * 4
        lum[Math.min(63, Math.floor(i / per))] += (buf[o] * 0.299 + buf[o + 1] * 0.587 + buf[o + 2] * 0.114) / per
      }
      out.push(lum.map((v) => Math.round(v)))
    }
    return out
  }
  window.__forceFrame = () => {
    if (!renderer || !scene || !camera) return null
    renderer.render(scene, camera)
    const gl = renderer.getContext()
    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    const px = new Uint8Array(4)
    gl.readPixels((width / 2) | 0, (height / 2) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    return {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      pixel: Array.from(px),
      size: [width, height],
    }
  }
}
