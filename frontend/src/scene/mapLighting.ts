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
import { sunUniforms } from './sceneryMaterials.js';

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
 * @returns {{envMultiplier: number, normalized: boolean}} IBL 倍率（晚到环境贴图的调用方
 *   需继续持有该值），以及是否走了太阳归一。
 */
export function applyMapLighting({ renderer, scene, sunLight, hemiLight, lighting, debug = false }) {
  const L = lighting;
  const sun = L && L.sun;
  if (!sunLight || !hemiLight) return { envMultiplier: 1, normalized: false };
  // IBL 倍率（逐图 0.8–4.0）：authored 值先取，太阳块内按 expo 归一（见下）
  const envAuthored = L && L.ibl && L.ibl['ibl.environmentMultiplier'];
  let envMultiplier = Number.isFinite(envAuthored) ? envAuthored : 1;
  let normalized = false;
  const d = sun && sun.direction_scene;
  if (Array.isArray(d) && d.length === 3 && d.every(Number.isFinite)) {
    const n = Math.hypot(d[0], d[1], d[2]) || 1;
    sunLight.position.set(-d[0] / n, -d[1] / n, -d[2] / n).multiplyScalar(1000);
    sunLight.target.position.set(0, 0, 0);   // 平行光只方向有意义；距离仅作位置标量
    sunLight.target.updateMatrixWorld();
    if (Array.isArray(sun.color) && sun.color.every(Number.isFinite)) {
      sunLight.color.setRGB(sun.color[0], sun.color[1], sun.color[2]);
    }
    if (Number.isFinite(sun.intensity)) sunLight.intensity = sun.intensity;
    // 亮度归一（2026-10-10 用户裁示"保色相、归亮度"）：客户端 intensity（36 图 3–14）配它的
    // 自动曝光；我们的渲染器没有自动曝光（如实记录的缺口），照搬强度会让走 three 内建管线的
    // 材质过曝 2–5× ⇒ 这里按该图太阳强度把整图曝光归一到已调好的基准（DEFAULT_SUN_INTENSITY）。
    // ⚠️ 归一必须覆盖**全部三个光照通道**（2026-10-11 补全，mountain 报障"坦克非常暗"）：
    // hemi 与 IBL 基准同样除以 expo（三通道输出端净值与基线图逐项相同；基线图逐像素不变）。
    if (Number.isFinite(sun.intensity) && sun.intensity > 0) {
      const expo = THREE.MathUtils.clamp(DEFAULT_SUN_INTENSITY / sun.intensity, 0.05, 4.0);
      renderer.toneMappingExposure = expo;
      hemiLight.intensity = DEFAULT_HEMI_INTENSITY / expo;
      envMultiplier = (Number.isFinite(envAuthored) ? envAuthored : 1) / expo;
      if (scene) scene.environmentIntensity = envMultiplier;   // env 贴图若已挂，即时生效
      normalized = true;
      if (debug && typeof window !== 'undefined') window.__mapExposure = expo;
    }
    // 环境反射的高光项要 lightColor0（= color × intensity）与传播方向：写入共享 uniform
    sunUniforms.uSunDirScene.value.set(d[0] / n, d[1] / n, d[2] / n);
    if (Array.isArray(sun.color) && Number.isFinite(sun.intensity)) {
      sunUniforms.uSunColor.value.set(sun.color[0] * sun.intensity,
                                      sun.color[1] * sun.intensity,
                                      sun.color[2] * sun.intensity);
    }
    if (Array.isArray(sun.ambient) && sun.ambient.every(Number.isFinite)) {
      hemiLight.color.setRGB(sun.ambient[0], sun.ambient[1], sun.ambient[2]);
    }
    if (debug && typeof window !== 'undefined') {
      window.__mapLighting = { direction: d.slice(), color: sun.color, intensity: sun.intensity, ambient: sun.ambient };
    }
  }
  // IBL 倍率：未走太阳归一（该图没有可用的太阳方向块）——authored 值原样生效
  // （expo=1 的基线口径，与 resetMapLighting 一致）。**不可无条件覆盖**：
  // 太阳块已把三通道一起归一，这里再赋 authored 会把 IBL 打回未归一值。
  return { envMultiplier, normalized };
}

/** 复位到兜底灯光（无 lighting.json / 切图时先复位），并复位共享太阳 uniform 与曝光。 */
export function resetMapLighting({ renderer, scene, sunLight, hemiLight, debug = false }) {
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
  if (debug && typeof window !== 'undefined') delete window.__mapLighting;
  return 1;
}
