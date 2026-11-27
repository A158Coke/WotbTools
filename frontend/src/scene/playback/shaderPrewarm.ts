import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three'

export interface ShaderPrewarmDeps {
  getRenderer: () => WebGLRenderer | null
  getScene: () => Scene
  getCamera: () => PerspectiveCamera
  ensureBattleFx: () => { prewarm(compile: () => void): void }
  ensureArmorHighlight: () => { prewarm(camera: PerspectiveCamera): void }
  armorHighlightPref: () => boolean
}

export function createShaderPrewarm(deps: ShaderPrewarmDeps): () => void {
  return () => {
    try {
      const renderer = deps.getRenderer();
      const camera = deps.getCamera();
      camera.updateMatrixWorld();
      deps.ensureBattleFx().prewarm(() => {
        renderer?.compile(deps.getScene(), camera);
      });
      if (deps.armorHighlightPref() && renderer && typeof renderer.compile === 'function') {
        deps.ensureArmorHighlight().prewarm(camera);
      }
    } catch (e) { console.warn('着色器预热失败（忽略）:', e); }
  }
}
