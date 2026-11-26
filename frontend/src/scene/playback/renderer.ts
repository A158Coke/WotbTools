import * as THREE from 'three'
import type { PerspectiveCamera, Scene, Texture, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Clock, Raycaster, HemisphereLight, DirectionalLight } from 'three'
import { createDynRes } from '../dynRes.js'
import { DEFAULT_HEMI_SKY, DEFAULT_HEMI_GROUND, DEFAULT_HEMI_INTENSITY, DEFAULT_SUN_INTENSITY } from '../mapLighting.js'

export type QualityPreset = typeof import('./quality.js').QUALITY_PRESETS['high']

export interface SceneCoreOptions {
  container: HTMLElement
  quality: QualityPreset
  logdepth: boolean
  dynres: boolean
  stencil?: boolean
  debug: boolean
  envTexture?: Texture | null
  envMultiplier?: number
  onResize: () => void
  onPointerDown: (e: PointerEvent) => void
  onPointerUp: (e: PointerEvent) => void
  setFollow?: unknown
}

export interface RendererCaps {
  logdepth: boolean
  dynres: boolean
  stencil: boolean
}

export function createPlaybackSceneRoot(): Scene {
  const scene = new THREE.Scene();
  scene.updateMatrix();
  scene.matrixAutoUpdate = false;
  return scene;
}

export function isSoftwareRasterizer(): boolean {
  let gl: WebGLRenderingContext | null = null
  try {
    const probe = document.createElement('canvas')
    gl = (probe.getContext('webgl2') ?? probe.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return false
    const dbg = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL?: number } | null
    if (!dbg?.UNMASKED_RENDERER_WEBGL) return false
    const renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
    return /swiftshader|llvmpipe|softpipe|software/i.test(renderer)
  } catch {
    return false
  } finally {
    try { gl?.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* 已失效上下文：忽略 */ }
  }
}

export interface SceneCore {
  scene: Scene
  camera: PerspectiveCamera
  renderer: WebGLRenderer
  controls: OrbitControls
  clock: Clock
  raycaster: Raycaster
  hemiLight: HemisphereLight
  sunLight: DirectionalLight
  dynResCtl: ReturnType<typeof createDynRes> | null
  sizeObserver: ResizeObserver | null
  rendererCaps: RendererCaps
}

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.container 视口容器（SPA 壳内 main 区域，非整窗）
 * @param {typeof import('./quality.js').QUALITY_PRESETS.high} opts.quality 画质档（Q）
 * @param {boolean} opts.logdepth 对数深度偏好（LOGDEPTH）
 * @param {boolean} opts.dynres 动态分辨率偏好（DYNRES）
 * @param {boolean} opts.debug 诊断钩子开关（仅显式 ?debug 才挂 window.__*）
 * @param {THREE.Texture|null} [opts.envTexture] 逐图 IBL（资产阶段早于场景创建时补挂）
 * @param {number} [opts.envMultiplier] 逐图 IBL 强度（scene.environmentIntensity）
 * @param {() => void} opts.onResize
 * @param {(e: PointerEvent) => void} opts.onPointerDown
 * @param {(e: PointerEvent) => void} opts.onPointerUp
 * @param {unknown} [opts.setFollow] 诊断钩子（宿主闭包内函数声明，提升后传入）
 */
export function createSceneCore({
  container, quality: Q, logdepth: LOGDEPTH, dynres: DYNRES, stencil: STENCIL = false, debug: DEBUG,
  envTexture = null, envMultiplier = 1,
  onResize, onPointerDown, onPointerUp, setFollow,
}: SceneCoreOptions): SceneCore {
  const scene = createPlaybackSceneRoot();
  scene.background = new THREE.Color(0x11161d);
  if (DEBUG) window.__scene = scene;
  const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.5, 4000);
  camera.position.set(0, 180, 220);
  const softwareGL = isSoftwareRasterizer();
  const renderer = new THREE.WebGLRenderer({
    antialias: Q.antialias && !softwareGL,
    logarithmicDepthBuffer: LOGDEPTH,
    stencil: STENCIL,
    powerPreference: 'high-performance',
  });
  const rendererCaps: RendererCaps = { logdepth: LOGDEPTH, dynres: DYNRES, stencil: STENCIL };
  renderer.setSize(container.clientWidth, container.clientHeight);
  const baseDpr = Math.min(devicePixelRatio, Q.maxDpr);
  renderer.setPixelRatio(baseDpr);
  const dynResCtl = DYNRES && baseDpr > 1
    ? createDynRes({ ceilDpr: baseDpr })
    : null;
  if (DEBUG) window.__renderer = renderer;
  if (DEBUG) window.__camera = camera;
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.02;
  if (DEBUG) window.__controls = controls;
  if (DEBUG) window.__setFollow = setFollow;
  const clock = new THREE.Clock();
  const raycaster = new THREE.Raycaster();
  const hemiLight = new THREE.HemisphereLight(DEFAULT_HEMI_SKY, DEFAULT_HEMI_GROUND, DEFAULT_HEMI_INTENSITY);
  scene.add(hemiLight);
  const sunLight = new THREE.DirectionalLight(0xffffff, DEFAULT_SUN_INTENSITY);
  sunLight.position.set(120, 260, 80);
  scene.add(sunLight);
  scene.add(sunLight.target);
  sunLight.target.position.set(0, 0, 0);
  if (envTexture) {
    scene.environment = envTexture;
    scene.environmentIntensity = envMultiplier;
  }
  addEventListener('resize', onResize);
  let sizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    sizeObserver = new ResizeObserver(onResize);
    sizeObserver.observe(container);
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  return { scene, camera, renderer, controls, clock, raycaster, hemiLight, sunLight, dynResCtl, sizeObserver, rendererCaps };
}
