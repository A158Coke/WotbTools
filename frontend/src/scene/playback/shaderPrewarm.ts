// 着色器预热（playbackScene.js prewarmShaders 出仓；源码行预算回归 1500）。
// 预热在用材质：把首次编译的数十~数百 ms 从「战斗第一次开火/命中」挪到加载阶段。
// 失败不影响播放（best-effort）。
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three'

export interface ShaderPrewarmDeps {
  getRenderer: () => WebGLRenderer | null
  getScene: () => Scene
  getCamera: () => PerspectiveCamera
  /** 战斗特效批次/条带平时按需隐藏：预热期间临时显示，避免首发开火时才编译。 */
  ensureBattleFx: () => { prewarm(compile: () => void): void }
  /** 穿深着色 RT 预热（ARMOR_HIGHLIGHT 开启且机位为录像者时）。 */
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
