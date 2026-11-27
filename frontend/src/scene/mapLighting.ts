import * as THREE from 'three';
import type { DirectionalLight, HemisphereLight, PointLight, Scene, WebGLRenderer } from 'three';
import { sunUniforms } from './sceneryMaterials.js';

export interface MapLightingData {
  sun?: {
    direction_scene?: number[] | null
    color?: number[] | null
    intensity?: number | null
    ambient?: number[] | null
  } | null
  ibl?: Record<string, number> | null
  dynamicLights?: DynamicLightRecord[] | null
}

export interface DynamicLightRecord {
  name?: string | null
  type?: number | null
  flags?: number | null
  intensity?: number | null
  radius?: number | null
  falloffExponent?: number | null
  color?: number[] | null
  ambient?: number[] | null
  position?: number[] | null
  rotation?: number[] | null
  [key: string]: unknown
}

export const MAX_DYNAMIC_LIGHTS = 16;

export function selectDynamicLights(records: DynamicLightRecord[] | null | undefined, max: number = MAX_DYNAMIC_LIGHTS): DynamicLightRecord[] {
  const usable = (records || []).filter((r) => {
    if (!r || !Array.isArray(r.position) || r.position.length !== 3
        || !r.position.every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
    if (!Array.isArray(r.color) || r.color.length < 3 || !r.color.slice(0, 3).every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
    return typeof r.radius === 'number' && Number.isFinite(r.radius) && r.radius > 0
        && typeof r.intensity === 'number' && Number.isFinite(r.intensity) && r.intensity > 0;
  });
  return usable
    .map((r, i) => ({ r, key: (r.intensity as number) * (r.radius as number), i }))
    .sort((a, b) => (b.key - a.key) || (a.i - b.i))
    .slice(0, max)
    .map((e) => e.r);
}

export function lightPositionScene(p: number[]): [number, number, number] {
  return [-p[0], p[2], p[1]];
}

export interface ApplyMapLightingArgs {
  renderer: WebGLRenderer
  scene?: Scene | null
  sunLight?: DirectionalLight | null
  hemiLight?: HemisphereLight | null
  lighting?: MapLightingData | null
  debug?: boolean
}

export interface ApplyMapLightingResult {
  envMultiplier: number
  normalized: boolean
}

export const DEFAULT_HEMI_SKY = 0xbfd4e8;
export const DEFAULT_HEMI_GROUND = 0x2a2f36;
export const DEFAULT_HEMI_INTENSITY = 2.4;
export const DEFAULT_SUN_INTENSITY = 3.0;

/**
 * 应用该图真实太阳（方向/色/强度）+ 环境色（sun.ambient → 半球光）+ 曝光归一。
 *
 * 方向语义：客户端给的是**传播**方向（源→地面，场景系）；three 的方向光从 position 射向
 * target，故 position = −direction。强度按客户端公式直用：客户端
 * `diffuse = lightColor*intensity*NdotL/π`，three 物理光单位（r165+）同式。
 *
 * 亮度归一（2026-10-10 用户裁示"保色相、归亮度"）：客户端那套 intensity（36 图 3–14）
 * 是配**它的自动曝光**用的（客户端发布版无 filmic 曲线；屏幕级自动曝光无静态值可抄）；
 * 本函数按该图太阳强度把整图曝光归一到已调好的基准（DEFAULT_SUN_INTENSITY）——
 * 等价于用固定曝光模拟客户端的自动曝光。归一必须覆盖**全部三个通道**
 * （2026-10-11 mountain 报障）：expo 在输出端乘一切材质，hemi 与 IBL 基准同样除以 expo，
 * 三通道净值与基线图逐项同档。
 *
 * @returns IBL 倍率（晚到环境贴图的调用方需继续持有该值），以及是否走了太阳归一。
 */
export function applyMapLighting({ renderer, scene, sunLight, hemiLight, lighting, debug = false }: ApplyMapLightingArgs): ApplyMapLightingResult {
  const L = lighting;
  const sun = L && L.sun;
  if (!sunLight || !hemiLight) return { envMultiplier: 1, normalized: false };
  const envAuthored = L?.ibl?.['ibl.environmentMultiplier'];
  let envMultiplier = typeof envAuthored === 'number' && Number.isFinite(envAuthored) ? envAuthored : 1;
  let normalized = false;
  const d = sun && sun.direction_scene;
  if (sun && Array.isArray(d) && d.length === 3 && d.every(Number.isFinite)) {
    const sunColor = sun.color;
    const sunIntensity = sun.intensity;
    const sunAmbient = sun.ambient;
    const n = Math.hypot(d[0], d[1], d[2]) || 1;
    sunLight.position.set(-d[0] / n, -d[1] / n, -d[2] / n).multiplyScalar(1000);
    sunLight.target.position.set(0, 0, 0);
    sunLight.target.updateMatrixWorld();
    if (Array.isArray(sunColor) && sunColor.every(Number.isFinite)) {
      sunLight.color.setRGB(sunColor[0], sunColor[1], sunColor[2]);
    }
    if (typeof sunIntensity === 'number' && Number.isFinite(sunIntensity)) sunLight.intensity = sunIntensity;
    if (typeof sunIntensity === 'number' && Number.isFinite(sunIntensity) && sunIntensity > 0) {
      const expo = THREE.MathUtils.clamp(DEFAULT_SUN_INTENSITY / sunIntensity, 0.05, 4.0);
      renderer.toneMappingExposure = expo;
      hemiLight.intensity = DEFAULT_HEMI_INTENSITY / expo;
      envMultiplier = (typeof envAuthored === 'number' && Number.isFinite(envAuthored) ? envAuthored : 1) / expo;
      if (scene) scene.environmentIntensity = envMultiplier;
      normalized = true;
      if (debug && typeof window !== 'undefined') window.__mapExposure = expo;
    }
    sunUniforms.uSunDirScene.value.set(d[0] / n, d[1] / n, d[2] / n);
    if (Array.isArray(sunColor) && typeof sunIntensity === 'number' && Number.isFinite(sunIntensity)) {
      sunUniforms.uSunColor.value.set(sunColor[0] * sunIntensity,
                                      sunColor[1] * sunIntensity,
                                      sunColor[2] * sunIntensity);
      sunUniforms.uSunSpecColor.value.set(sunColor[0] * DEFAULT_SUN_INTENSITY,
                                          sunColor[1] * DEFAULT_SUN_INTENSITY,
                                          sunColor[2] * DEFAULT_SUN_INTENSITY);
    }
    if (Array.isArray(sunAmbient) && sunAmbient.every(Number.isFinite)) {
      hemiLight.color.setRGB(sunAmbient[0], sunAmbient[1], sunAmbient[2]);
    }
    if (debug && typeof window !== 'undefined') {
      window.__mapLighting = { direction: d.slice(), color: sunColor, intensity: sunIntensity, ambient: sunAmbient };
    }
  }
  if (scene) applyDynamicLights(scene, L?.dynamicLights, normalized ? (renderer.toneMappingExposure || 1) : 1);
  return { envMultiplier, normalized };
}

const LIGHT_INTENSITY_PER_RADIUS = 0.35;

export function applyDynamicLights(scene: Scene, records: DynamicLightRecord[] | null | undefined, expo: number): PointLight[] {
  resetDynamicLights(scene);
  if (!scene.userData) scene.userData = {};
  const usable = (records || []).filter((r) => {
    if (!r || !Array.isArray(r.position) || r.position.length !== 3) return false;
    return r.position.every((v) => typeof v === 'number' && Number.isFinite(v))
      && Array.isArray(r.color) && r.color.length >= 3
      && r.color.slice(0, 3).every((v) => typeof v === 'number' && Number.isFinite(v))
      && typeof r.intensity === 'number' && Number.isFinite(r.intensity) && r.intensity > 0
      && typeof r.radius === 'number' && Number.isFinite(r.radius) && r.radius > 0;
  });
  if (!usable.length) return [];
  const inv = Number.isFinite(expo) && expo > 0 ? 1 / expo : 1;
  const poolSize = Math.min(MAX_DYNAMIC_LIGHTS, usable.length);
  const picked = selectDynamicLights(usable);
  const lights: PointLight[] = [];
  for (let i = 0; i < poolSize; i++) {
    const r = picked[i] || usable[i];
    const light = new THREE.PointLight(0xffffff, 0, 1, 1);
    light.name = 'dynLightPool';
    light.userData.source = r;
    scene.add(light);
    lights.push(light);
  }
  scene.userData.__dynamicLights = lights;
  scene.userData.__dynamicLightSource = usable;
  scene.userData.__dynamicLightExpo = inv;
  for (let i = 0; i < lights.length; i++) bindDynamicLight(lights[i], picked[i] || usable[i], inv);
  return lights;
}

function bindDynamicLight(light: PointLight, r: DynamicLightRecord, inv: number): void {
  const c = r.color as number[];
  light.color.setRGB(Math.max(0, c[0]), Math.max(0, c[1]), Math.max(0, c[2]));
  light.intensity = (r.intensity as number) * (r.radius as number) * LIGHT_INTENSITY_PER_RADIUS * inv;
  light.distance = r.radius as number;
  const [x, y, z] = lightPositionScene(r.position as number[]);
  light.position.set(x, y, z);
  light.userData.source = r;
}

export function updateDynamicLights(scene: Scene, cameraPosition: { x: number; y: number; z: number } | null | undefined): void {
  const pool = scene.userData?.__dynamicLights as PointLight[] | undefined;
  const src = scene.userData?.__dynamicLightSource as DynamicLightRecord[] | undefined;
  if (!Array.isArray(pool) || !pool.length || !Array.isArray(src) || !src.length || !cameraPosition) return;
  const inv = (scene.userData?.__dynamicLightExpo as number) || 1;
  const cx = cameraPosition.x
  const cy = cameraPosition.y
  const cz = cameraPosition.z
  const scored = src.map((r, i) => {
    const [x, y, z] = lightPositionScene(r.position as number[]);
    const dx = x - cx, dy = y - cy, dz = z - cz;
    return { r, d2: dx * dx + dy * dy + dz * dz, i };
  }).sort((a, b) => (a.d2 - b.d2) || (a.i - b.i));
  for (let i = 0; i < pool.length; i++) {
    const pick = scored[i];
    if (!pick) { pool[i].intensity = 0; continue; }
    if ((pool[i].userData.source as DynamicLightRecord | undefined) === pick.r) continue;
    bindDynamicLight(pool[i], pick.r, inv);
  }
}

export function resetDynamicLights(scene: Scene): void {
  const prev = scene.userData?.__dynamicLights as PointLight[] | undefined;
  if (Array.isArray(prev) && typeof scene.remove === 'function') {
    for (const l of prev) scene.remove(l);
    if (scene.userData) {
      delete scene.userData.__dynamicLights;
      delete scene.userData.__dynamicLightSource;
      delete scene.userData.__dynamicLightExpo;
    }
  }
}

export function resetMapLighting({ renderer, scene, sunLight, hemiLight, debug = false }: Omit<ApplyMapLightingArgs, 'lighting'>): number {
  if (scene) resetDynamicLights(scene);
  if (hemiLight) {
    hemiLight.color.setHex(DEFAULT_HEMI_SKY);
    hemiLight.groundColor.setHex(DEFAULT_HEMI_GROUND);
    hemiLight.intensity = DEFAULT_HEMI_INTENSITY;
  }
  if (sunLight) {
    sunLight.color.setHex(0xffffff);
    sunLight.intensity = DEFAULT_SUN_INTENSITY;
    sunLight.position.set(120, 260, 80);
  }
  if (renderer) renderer.toneMappingExposure = 1.0;
  if (scene) scene.environmentIntensity = 1.0;
  sunUniforms.uSunDirScene.value.set(0, -1, 0);
  sunUniforms.uSunColor.value.set(1, 1, 1);
  sunUniforms.uSunSpecColor.value.set(1, 1, 1);
  if (debug && typeof window !== 'undefined') delete window.__mapLighting;
  return 1;
}
