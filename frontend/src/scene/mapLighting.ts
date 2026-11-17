// 逐图光照（客户端 DirectionalLightComponent → map/<key>/lighting.json）：
// **3D 运行时与俯视烘焙共用同一份**。
//
// 2026-10-14 抽层动因（第二处"未同步"）：俯视烘焙（scripts/bake-ground-overhead.mjs）此前
// 自持一套"固定日光常量"（白 3.0 + 半球 2.4 + ACES 1.15，运行时逐图光照落地前的旧基线），
// 未随运行时 2026-10-10 的逐图光照 + "保色相、归亮度"曝光归一同步 ⇒ faust（夜间图，
// sun.color=(0.40,0.50,0.70)、intensity 8.0 ⇒ 运行时 expo=0.375）在底图里比 3D 档亮约 3 倍
// 且色温偏白（用户报障"地面太亮、与 3D 俯视差异很大"）。
// 本模块只放**光照应用**（默认常量 + 应用/复位），运行时与烘焙各自持有 renderer/lights 句柄。
import * as THREE from 'three';
import type { DirectionalLight, HemisphereLight, PointLight, Scene, WebGLRenderer } from 'three';
import { sunUniforms } from './sceneryMaterials.js';

/** lighting.json 的消费字段（其余字段由资产面持有；全部可选——缺省走兜底灯光）。 */
export interface MapLightingData {
  sun?: {
    direction_scene?: number[] | null
    color?: number[] | null
    intensity?: number | null
    ambient?: number[] | null
  } | null
  ibl?: Record<string, number> | null
  /** LightComponent 动态光源（上游 2026-11-17 审计 A5；字段原样直传，坐标 = 客户端世界系） */
  dynamicLights?: DynamicLightRecord[] | null
}

/** lighting.json dynamicLights[] 的记录（上游 tools/export_map_lighting.py 原样直传）。 */
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

/**
 * 动态光源预算：按 亮度×作用半径 降序取前 `max` 个（并列按文件序稳定）。
 * 纯函数。这是**性能预算**不是语义判据——iceworld 71 / faust 61 盏全上会让场景里每个
 * Lambert/Standard 材质按 71 灯编译（移动端编译时间与片元成本都不可接受）；有界子集让
 * 任意图的灯光开销有上界。选取规则对全部地图统一（同一条规则、确定序）。
 */
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

/** 客户端世界系 → 回放场景系（qFrame 同式： (x,y,z) → (−x, z, y)；与上游 game_to_scene 一致）。 */
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
  /** IBL 倍率（晚到环境贴图的调用方需继续持有该值） */
  envMultiplier: number
  /** 是否走了太阳归一 */
  normalized: boolean
}

// 兜底灯光（读不到 lighting.json 时用，= 上游硬编码时代的两盏灯，保证无数据也不变样）
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
  // IBL 倍率（逐图 0.8–4.0）：authored 值先取，太阳块内按 expo 归一（见下）
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
    sunLight.target.position.set(0, 0, 0);   // 平行光只方向有意义；距离仅作位置标量
    sunLight.target.updateMatrixWorld();
    if (Array.isArray(sunColor) && sunColor.every(Number.isFinite)) {
      sunLight.color.setRGB(sunColor[0], sunColor[1], sunColor[2]);
    }
    if (typeof sunIntensity === 'number' && Number.isFinite(sunIntensity)) sunLight.intensity = sunIntensity;
    // 亮度归一（2026-10-10 用户裁示"保色相、归亮度"）：客户端 intensity（36 图 3–14）配它的
    // 自动曝光；我们的渲染器没有自动曝光（如实记录的缺口），照搬强度会让走 three 内建管线的
    // 材质过曝 2–5× ⇒ 这里按该图太阳强度把整图曝光归一到已调好的基准（DEFAULT_SUN_INTENSITY）。
    // ⚠️ 归一必须覆盖**全部三个光照通道**（2026-10-11 补全，mountain 报障"坦克非常暗"）：
    // hemi 与 IBL 基准同样除以 expo（三通道输出端净值与基线图逐项相同；基线图逐像素不变）。
    if (typeof sunIntensity === 'number' && Number.isFinite(sunIntensity) && sunIntensity > 0) {
      const expo = THREE.MathUtils.clamp(DEFAULT_SUN_INTENSITY / sunIntensity, 0.05, 4.0);
      renderer.toneMappingExposure = expo;
      hemiLight.intensity = DEFAULT_HEMI_INTENSITY / expo;
      envMultiplier = (typeof envAuthored === 'number' && Number.isFinite(envAuthored) ? envAuthored : 1) / expo;
      if (scene) scene.environmentIntensity = envMultiplier;   // env 贴图若已挂，即时生效
      normalized = true;
      if (debug && typeof window !== 'undefined') window.__mapExposure = expo;
    }
    // 环境反射的高光项要 lightColor0（= color × intensity）与传播方向：写入共享 uniform
    sunUniforms.uSunDirScene.value.set(d[0] / n, d[1] / n, d[2] / n);
    if (Array.isArray(sunColor) && typeof sunIntensity === 'number' && Number.isFinite(sunIntensity)) {
      sunUniforms.uSunColor.value.set(sunColor[0] * sunIntensity,
                                      sunColor[1] * sunIntensity,
                                      sunColor[2] * sunIntensity);
      // 高光通道按查看器曝光归一（intensity×expo = DEFAULT）：自定义 shader 不走
      // renderer.toneMappingExposure，直接用 raw lightColor0 会过曝 2–5×。
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
  // 动态光源：在太阳分支**外**施加（该图没有可用太阳方向时同样要上灯；
  // expo 未走归一 = 1，见 resetMapLighting 的基线口径）
  if (scene) applyDynamicLights(scene, L?.dynamicLights, normalized ? (renderer.toneMappingExposure || 1) : 1);
  // IBL 倍率：未走太阳归一（该图没有可用的太阳方向块）——authored 值原样生效
  // （expo=1 的基线口径，与 resetMapLighting 一致）。**不可无条件覆盖**：
  // 太阳块已把三通道一起归一，这里再赋 authored 会把 IBL 打回未归一值。
  return { envMultiplier, normalized };
}

// 动态光源亮度近似：客户端给 intensity(≈1) + radius(15–20m) + falloffExponent(≈1–1.5)
// ——"半径内接近恒亮、边缘窗式截止"的点光池。three 内建点光只有物理 1/d^decay 衰减，无法
// 表达该剖面；取 decay=1（最近似线性）并把亮度按半径线性放大，使光池中部亮度落在
// "可见但不过曝"档（常量待与客户端画面的 A/B 定版——上游 lighting.json 的 type 语义
// 同样未定版，见 map-render-align-audit.md A5：本实现按**无方向点光**消费，不臆造朝向）。
const LIGHT_INTENSITY_PER_RADIUS = 0.35;

/**
 * 把 lighting.json 的 dynamicLights 施加到场景（PointLight，无方向语义——见上注）。
 * 旧灯光先摘除（切图/重入安全）；灯光登记在 `scene.userData.__dynamicLights`，由
 * `resetDynamicLights` 复位。亮度按当前曝光归一 expo 同步缩放（与 hemi/IBL 同通道口径，
 * 见 applyMapLighting 的"保色相、归亮度"）。
 */
export function applyDynamicLights(scene: Scene, records: DynamicLightRecord[] | null | undefined, expo: number): PointLight[] {
  resetDynamicLights(scene);
  if (!scene.userData) scene.userData = {};   // 测试桩 scene 可能没有 userData
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
  // **固定池 + 逐帧近邻换池**：光源数量恒定 ⇒ three 不重编译着色器；池内 16 盏按相机
  // 距离逐帧重绑到最近的 16 条数据（142 盏灯因此都能在靠近时"亮起来"，不是只挑全局最亮
  // 的 16 盏常驻）。池的初始成员 = 全局预算选取（无相机时的确定序）。
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

/**
 * 逐帧近邻换池（playbackScene 每帧调用）：池内 16 盏重绑到离相机最近的 16 条光源。
 * 相机不动时按距离稳定排序；相机移动时相邻灯位更替（灯数恒定、无编译抖动）。
 * 无光源数据/无池 → no-op。
 */
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

/** 摘除并释放 applyDynamicLights 登记的灯光（幂等；切图/复位共用）。
 *  对无 add/userData 的测试桩 scene 安全（无登记 = 无操作）。 */
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

/** 复位到兜底灯光（无 lighting.json / 切图时先复位），并复位共享太阳 uniform 与曝光。 */
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
