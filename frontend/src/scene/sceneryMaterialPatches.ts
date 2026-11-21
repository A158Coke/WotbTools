// 材质补丁与场景卸载（自 sceneryMaterials.ts 原样平移）：坦克环境光隔离补丁、
// 细节层注入补丁与 disposeSceneGroup（几何/材质/纹理统一释放）。
import * as THREE from 'three'
import type { Mesh, MeshLambertMaterial, MeshStandardMaterial, Object3D, Texture } from 'three'
import { clearSceneryMatCache, duckProps } from './sceneryMaterials.js'

// ---- 坦克环境光隔离（对齐客户端 ULTRA 档的 PBR 口径；2026-10-09）----
// 客户端坦克材质走 `BlinnPhongAllQualities` 模板（.sc2 实测引用）：ULTRA→`PBR.material`、
// 其余档→BlinnPhong。ULTRA 档的片元光照（`pbr-lighting.slh`）里**环境项只有两张 IBL 立方图**：
//     diffuseIBL  = texCUBElod(diffuseIrradianceMap, N, 0) × diffuseColor
//     specularIBL = texCUBElod(specularReflectionMap, R, lod) × EnvBRDFApprox(F0, roughness, NdotV)
//     diffuseDirect = lightColor × intensity × NdotL × diffuseColor / π      （与 three 同式）
// **没有"半球/ambColor"这一层**（ambColor 只喂非 ULTRA 档的 BlinnPhong 路径）。
// 我们给整个场景挂了一盏 HemisphereLight（兜底强度 2.4、颜色＝逐图 `sun.ambient`）来承载
// Lambert 回退材质的"环境色"，坦克也照单全收 ⇒ 坦克环境 = 半球(≈0.69×albedo) + IBL(≈0.37–0.64)
// ≈ 1.06–1.33×albedo，而客户端只有 IBL 一项（实测逐图有效漫反射辐照 0.46–0.81）⇒ 整体偏亮/发白。
// 修法：只给**坦克的 PBR 材质**把 three 的"环境/半球 irradiance"累加项清零——three 的
// `lights_fragment_begin` 里 `irradiance` 只含 ambient/hemi/lightProbe/lightmap，而 IBL 在
// **`lights_fragment_end`** 才 `irradiance += iblIrradiance`（三 r165+ 逐行核对），故在 begin
// 之后清零只去掉重复环境项、完整保留 IBL；直接光（太阳）也照旧。
// `TANK_ENV_INTENSITY` 是后续可调旋钮（1 = 沿用逐图 `environmentMultiplier` 的 IBL 总量；
// 实测客户端立方图另带 `environmentGamma/Multiplier`（引擎侧作用），若仍偏差可在此标定）。
export const TANK_ENV_INTENSITY = 1;
export function patchTankMaterial(m: THREE.Material | null | undefined): THREE.Material | null | undefined {
  if (!m) return m;
  const sm = m as MeshStandardMaterial
  if (!sm.isMeshStandardMaterial) return m;
  if (sm.userData && sm.userData.__tankAmbientFixed) return m;
  if (sm.userData) sm.userData.__tankAmbientFixed = true;
  if (Number.isFinite(TANK_ENV_INTENSITY)) sm.envMapIntensity = TANK_ENV_INTENSITY;
  const prev = sm.onBeforeCompile;
  sm.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === 'function') prev.call(sm, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_begin>',
      '#include <lights_fragment_begin>\n\tirradiance = vec3( 0.0 );   // 坦克：环境项只留 IBL（客户端 ULTRA 口径）',
    );
  };
  // 程序缓存键必须带标记：否则会复用"未打补丁"的同参数程序（three 按 key 缓存）
  const prevKey = sm.customProgramCacheKey;
  sm.customProgramCacheKey = () => {
    const base = (typeof prevKey === 'function') ? prevKey.call(sm) : '';
    return base + '|tank-noambient';
  };
  sm.needsUpdate = true;
  return m;
}
/** 细节层补丁（B1，非光照图批次专用）：给 three 内建 Lambert 材质注入
 *  `diffuseColor.rgb *= texture2D(uDetailTex, uv0 × scale).rgb * 2.0`。
 *
 *  用于**没有光照图**但客户端开了 `MATERIAL_DETAIL` 的实例（实测 453 里有 55 个：
 *  neptune 27 / plant 12 / idle 8 …）——它们走 convMat 的 Lambert 降级路径，没有
 *  自定义着色器可改，只能 onBeforeCompile 注入。位置选在 `<map_fragment>` 之后
 *  （= albedo 已采、开始光照之前）：客户端该分支是 `color = albedo; color *= detail×2`
 *  的**纯相乘**，注入在光照前保持"detail 调制 albedo"的语义（我们的 Lambert 本身
 *  已是该类的降级偏差——客户端这一类是 unlit）。
 *  ⚠️ 纹理/scale 逐材质不同，调用方（convMat 的缓存键）必须把 detail 身份计进键，
 *  否则同图不同 detail 的材质会串用；program 缓存键同样带标记（与坦克补丁同法）。 */
export function patchSceneryDetail(m: MeshLambertMaterial | null | undefined, detailTex: Texture | null | undefined, scale?: ArrayLike<number> | null): MeshLambertMaterial | null | undefined {
  if (!m || !detailTex) return m;
  if (m.userData && m.userData.__sceneryDetail) return m;
  if (m.userData) m.userData.__sceneryDetail = true;
  detailTex.colorSpace = THREE.NoColorSpace;
  detailTex.needsUpdate = true;
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const sx = num(scale?.[0], 1);
  const sy = num(scale?.[1], 1);
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === 'function') prev.call(m, shader, renderer);
    shader.uniforms.uDetailTex = { value: detailTex };
    shader.uniforms.uDetailScale = { value: new THREE.Vector2(sx, sy) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uDetailScale;\nvarying vec2 vDetailUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDetailUv = uv * uDetailScale;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetailTex;\nvarying vec2 vDetailUv;')
      .replace('#include <map_fragment>',
               '#include <map_fragment>\ndiffuseColor.rgb *= texture2D(uDetailTex, vDetailUv).rgb * 2.0;');
  };
  const prevKey = m.customProgramCacheKey;
  m.customProgramCacheKey = () => {
    const base = (typeof prevKey === 'function') ? prevKey.call(m) : '';
    return base + '|scenery-detail';
  };
  m.needsUpdate = true;
  return m;
}

/** 释放一组场景对象：几何 + 材质（去重）+ 材质**直接属性与 uniforms** 里的纹理。
 *  供烘焙页在 --all 批处理中逐图卸载——SpeedTree/叶卡的贴图在
 *  ShaderMaterial.uniforms.map.value，只枚举直接属性会漏掉（评审实测
 *  material dispose=1、texture dispose=0，显存随图数累积）。顺手清空
 *  材质实例缓存：缓存若保留已 dispose 的材质，下一张图会拿到失效实例。 */
export function disposeSceneGroup(g: Object3D): { materials: number; textures: number } {
  const mats = new Set<THREE.Material>(), texs = new Set<Texture>()
  g.traverse((node) => {
    const o = node as Mesh
    if (o.geometry) o.geometry.dispose()
    const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])
    for (const m of ms) {
      if (!m) continue
      mats.add(m)
      const props = duckProps(m)
      for (const k in props) { const v = props[k]; if (v && v.isTexture) texs.add(v as Texture) }
      const uniforms = (m as { uniforms?: Record<string, { value?: unknown }> }).uniforms
      if (uniforms) {
        for (const k in uniforms) {
          const v = uniforms[k] && uniforms[k].value as { isTexture?: unknown } | undefined
          if (v && v.isTexture) texs.add(v as Texture)
        }
      }
    }
  })
  for (const t of texs) t.dispose()
  for (const m of mats) m.dispose()
  clearSceneryMatCache()
  return { materials: mats.size, textures: texs.size }
}
