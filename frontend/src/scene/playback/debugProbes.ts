// ?debug 诊断探针（#820 行数预算拆分，2026-11-17）：从 playbackScene.js 抽出
// window.__renderInfo/__scene/__renderer/__threeCamera/__camera/__debugView/__rows/
// __forceFrame 的安装逻辑。仅显式 ?debug 时调用，生产构建不挂任何长生命周期引用。
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three'

export interface DebugProbeArgs {
  renderer: WebGLRenderer
  scene: Scene | null
  camera: PerspectiveCamera | null
  controls: { target: { set(x: number, y: number, z: number): void } } | null
  cameraRuntime: { cam?: () => string } | null
}

type DebugWindow = Window & Record<string, unknown>

export function installDebugProbes({ renderer, scene, camera, controls, cameraRuntime }: DebugProbeArgs): void {
  const w = window as unknown as DebugWindow
  // 上一帧的 draw call / 三角形数——用来确认某层是否真的进了渲染
  // （例：草层 60k×9 三角形，存在时应看到 +~54 万）
  w.__renderInfo = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles })
  // 诊断强引用（仅 debug）：水面材质/拾取取证用，生产构建不挂
  w.__scene = scene
  w.__renderer = renderer
  w.__threeCamera = camera
  // 相机探针：位置/模式（判断“看不见”是否只是俯视视角/距离问题）
  w.__camera = () => ({
    pos: camera ? camera.position.toArray() : null,
    mode: cameraRuntime && cameraRuntime.cam ? cameraRuntime.cam() : null,
  })
  // 诊断取帧：把相机放到指定点/朝向并立刻渲一帧，回读中心像素 + 绘制统计。
  // 仅 ?debug；不改变会话状态（调用方用完刷新页面即可复原）。
  w.__debugView = (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => {
    if (!camera || !renderer) return false
    camera.position.set(px, py, pz)
    if (controls) { controls.target.set(tx, ty, tz); camera.lookAt(controls.target as never) }
    else camera.lookAt(tx, ty, tz)
    camera.updateMatrixWorld(true)
    return true
  }
  // 远端闪烁度量：按屏幕行读回像素，降采样成 64 段亮度，便于对两帧做差分。
  w.__rows = (fracs: number[]) => {
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
  w.__forceFrame = () => {
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
