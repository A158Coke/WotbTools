import * as THREE from 'three';
import type { BufferGeometry, Mesh, Object3D, ShaderMaterial, Texture } from 'three'
import {
  cachedSceneryMat, makeBillboardMaterial, makeBlendByAngleMaterial, makeBlendLayerMaterial,
  makeDecalMaterial, makeLightmappedMaterial, makeMapBorderMaterial, makeSkyMaterial,
  makeSpeedtreeStaticMaterial, makeWaterMaterial, patchSceneryDetail, SCENERY_LAMBERT_EXPOSURE,
} from './sceneryMaterials.js';
import {
  materialIsWater, isWaterNode, isSkyShell, sceneHasSkyFlags,
} from './sceneryAssemblyRules.js';
import type { GltfSceneMaterial } from './sceneryMaterials.js';

export interface ParsedGltf {
  scene: Object3D
  parser?: {
    json?: { materials?: Array<{ extras?: Record<string, unknown> } | null> | null }
    associations?: Map<object, { materials?: number }>
    getDependency(type: 'texture', index: number): Promise<Texture | null>
  } | null
}

export interface SceneryExtrasMaps {
  maskTexByMatIndex: Map<number, Texture>
  lmTexByMatIndex: Map<number, Texture>
  detailTexByMatIndex: Map<number, Texture>
  envTexByMatIndex: Map<number, [Texture, Texture]>
  waterTexByMatIndex: Map<number, [Texture, Texture]>
  decalTexByMatIndex: Map<number, Texture>
}

export async function resolveSceneryExtras(gltf: ParsedGltf): Promise<SceneryExtrasMaps> {
  const maskTexByMatIndex = new Map<number, Texture>();
  const lmTexByMatIndex = new Map<number, Texture>();
  const detailTexByMatIndex = new Map<number, Texture>();
  const envTexByMatIndex = new Map<number, [Texture, Texture]>();
  const waterTexByMatIndex = new Map<number, [Texture, Texture]>();
  const decalTexByMatIndex = new Map<number, Texture>();
  try {
    const parser = gltf.parser;
    const jsonMats = (parser?.json?.materials) || [];
    for (let i = 0; i < jsonMats.length; i++) {
      const mat = jsonMats[i];
      const ex = (mat && mat.extras) || {};
      const dep = async (index: unknown): Promise<Texture> =>
        (await parser!.getDependency('texture', index as number)) as Texture;
      if (ex.maskTexture !== undefined) {
        maskTexByMatIndex.set(i, await dep(ex.maskTexture));
      }
      if (ex.lightmap !== undefined) {
        lmTexByMatIndex.set(i, await dep(ex.lightmap));
      }
      if (ex.decalTexture !== undefined) {
        decalTexByMatIndex.set(i, await dep(ex.decalTexture));
      }
      const detail = ex.detail as { texture?: number } | undefined;
      if (detail && detail.texture !== undefined) {
        detailTexByMatIndex.set(i, await dep(detail.texture));
      }
      const water = ex.water as { normal?: number; cube?: number } | undefined;
      if (water && typeof water === 'object' && water.normal !== undefined) {
        waterTexByMatIndex.set(i, [
          await dep(water.normal),
          await dep(water.cube),
        ]);
      }
      if (ex.envMask !== undefined && ex.envCube !== undefined) {
        envTexByMatIndex.set(i, [
          await dep(ex.envMask),
          await dep(ex.envCube),
        ]);
      }
    }
  } catch (e) { console.warn('场景 extras 贴图预解析失败（回退原口径）:', e); }
  return { maskTexByMatIndex, lmTexByMatIndex, detailTexByMatIndex, envTexByMatIndex, waterTexByMatIndex, decalTexByMatIndex };
}

export interface SceneryTexResolvers {
  maskTexOf(m: THREE.Material): Texture | null
  lmTexOf(m: THREE.Material): Texture | null
  detailTexOf(m: THREE.Material): Texture | null
  envTexOf(m: THREE.Material): [Texture, Texture] | null
  waterTexOf(m: THREE.Material): [Texture, Texture] | null
  decalTexOf(m: THREE.Material): Texture | null
}

export function makeTexResolvers(gltf: ParsedGltf, maps: SceneryExtrasMaps): SceneryTexResolvers {
  const texOf = <T,>(m: THREE.Material, table: Map<number, T>): T | null => {
    const assoc = gltf.parser && gltf.parser.associations && gltf.parser.associations.get(m);
    const idx = assoc && assoc.materials;
    return idx == null ? null : (table.get(idx) || null);
  };
  return {
    maskTexOf: (m) => texOf(m, maps.maskTexByMatIndex),
    lmTexOf: (m) => texOf(m, maps.lmTexByMatIndex),
    detailTexOf: (m) => texOf(m, maps.detailTexByMatIndex),
    envTexOf: (m) => texOf(m, maps.envTexByMatIndex),
    waterTexOf: (m) => texOf(m, maps.waterTexByMatIndex),
    decalTexOf: (m) => texOf(m, maps.decalTexByMatIndex),
  } as SceneryTexResolvers;
}

export interface WaterSurfaceFootprint {
  h: number
  x0: number
  x1: number
  y0: number
  y1: number
}

export function collectWaterSurfaces(root: Object3D): WaterSurfaceFootprint[] {
  root.updateMatrixWorld(true);
  const waterSurfaces: WaterSurfaceFootprint[] = [];
  root.traverse((node) => {
    const o = node as Mesh
    if (!o.isMesh || !o.material) return;
    if (!materialIsWater(o.material)) return;
    const bb = new THREE.Box3().setFromObject(o);
    if (bb.isEmpty()) return;
    waterSurfaces.push({ h: bb.max.z, x0: bb.min.x, x1: bb.max.x, y0: bb.min.y, y1: bb.max.y });
  });
  return waterSurfaces;
}

export function makeUnderWater(waterSurfaces: readonly WaterSurfaceFootprint[]): (o: Mesh) => boolean {
  return (o) => {
    if (!waterSurfaces.length || !o.geometry) return false;
    const bb = new THREE.Box3().setFromObject(o);
    if (bb.isEmpty()) return false;
    for (const w of waterSurfaces) {
      if (bb.min.x >= w.x0 - 0.5 && bb.max.x <= w.x1 + 0.5
          && bb.min.y >= w.y0 - 0.5 && bb.max.y <= w.y1 + 0.5
          && bb.max.z <= w.h + 0.05) return true;
    }
    return false;
  };
}

/**
 * 逐节点材质分派（与运行时原实现逐字同序）：
 *   water(对象) → blendByAngle → decal → lm(+env+detail) → blendLayer(掩码) → 水下 → convMat
 *
 * @param {object} gltf   已 GLTFLoader 解析的场景（gltf.scene 就地改写材质）
 * @param {object} opts
 *   strictSurfaces  新包判据（scene.extras.surfaceFlags；见 sceneryAssemblyRules）
 *   masks           makeTexResolvers 的返回
 *   groundLayers    运行时的逐图地表分层（贴花 cm/lm）；烘焙传 null ⇒ 贴花回落
 *   waterCoast      运行时海岸线高度场；烘焙传 null（水件已在剔除阶段移出）
 *   debug           诊断钩子开关（运行时 DEBUG）
 *   onMesh          (o, waterMarked) => void，遍历中逐网格回调（运行时走廊掩码取样用；
 *                   必须在实例化合批前调用——本函数即在该阶段）
 * @returns {{ animLayerMats: THREE.Material[], skyMeshes: number }}
 */
const DECAL_SOLID_MIN_HEIGHT = 1.0

function isSolidDecalGeometry(geometry: BufferGeometry | null | undefined): boolean {
  if (!geometry) return false
  if (!geometry.boundingBox && typeof geometry.computeBoundingBox === 'function') {
    geometry.computeBoundingBox()
  }
  const bb = geometry.boundingBox
  if (!bb || bb.max.z - bb.min.z < DECAL_SOLID_MIN_HEIGHT) return false
  const normals = geometry.attributes && geometry.attributes.normal
  if (!normals || normals.count < 3) return false
  let down = 0
  let side = 0
  let total = 0
  for (let i = 0; i < normals.count; i++) {
    const nz = normals.getZ(i)
    if (nz < -0.1) down++
    if (Math.abs(nz) <= 0.3) side++
    total++
  }
  return down / total > 0.02 || side / total > 0.05
}

export interface GroundLayersField {
  texs: { cm?: Texture | null; lm?: Texture | null }
  layers?: { separate_lm?: unknown; flatcolor?: unknown }
}

export interface AssembleSceneryOpts {
  strictSurfaces?: boolean
  masks: SceneryTexResolvers
  groundLayers?: GroundLayersField | null
  waterCoast?: import('./sceneryMaterials.js').WaterCoastField | null
  debug?: boolean
  onMesh?: ((o: Mesh, waterMarked: boolean) => void) | null
  skyFlagsAvailable?: boolean | null
}

export function assembleSceneryMaterials(gltf: ParsedGltf, {
  strictSurfaces = false, masks, groundLayers = null, waterCoast = null, debug = false, onMesh = null,
  skyFlagsAvailable = null,
}: AssembleSceneryOpts): { animLayerMats: ShaderMaterial[]; skyMeshes: number } {
  const { maskTexOf, lmTexOf, detailTexOf, envTexOf, waterTexOf, decalTexOf } = masks;
  const waterSurfaces = collectWaterSurfaces(gltf.scene);
  const underWater = makeUnderWater(waterSurfaces);
  let skyMeshes = 0;
  let waterRenderOrder = 0;
  const skyFlagAvailable = skyFlagsAvailable ?? sceneHasSkyFlags(gltf.scene);
  const isSkyNode = (o: Mesh) => isSkyShell(o.name, o.material, { skyFlagsAvailable: skyFlagAvailable });
  const convMat = (m: GltfSceneMaterial, isCard: boolean) => cachedSceneryMat(
    [isCard ? 'C' : 'M', m.name || '', m.map ? m.map.uuid : '',
     m.color ? [m.color.r, m.color.g, m.color.b].map((v) => v.toFixed(4)).join(',') : '',
     m.alphaMode || '', m.alphaTest ?? 0, !!m.transparent, m.opacity ?? 1,
     !!m.vertexColors,
     (m.userData && m.userData.occMean) || '',
     (m.userData && m.userData.blendLayer) || '',
     (m.userData && m.userData.alphaBlend) || '',
     (() => {
       const d = m.userData && m.userData.detail;
       if (!d) return '';
       const t = detailTexOf(m);
       return 'D|' + (t ? t.uuid : '') + '|' + (Array.isArray(d.scale) ? d.scale.join(',') : '');
     })()].join('|'),
    () => (isCard ? makeBillboardMaterial(m) : (() => {
      const opaqueEnough = (m.opacity ?? 1) >= 0.99;
      if ((m.name || '').startsWith('ST|')) {
        return makeSpeedtreeStaticMaterial(m, opaqueEnough);
      }
      const blendLayer = !!(m.userData && m.userData.blendLayer);
      const softAlpha = !!(m.userData && m.userData.alphaBlend);
      const pseudoOpaque = !!m.transparent && (m.opacity ?? 1) >= 0.99 && !blendLayer && !softAlpha;
      const nm = new THREE.MeshLambertMaterial({
        map: m.map || null,
        color: (m.color ? m.color.clone() : new THREE.Color(0xffffff))
          .multiplyScalar(SCENERY_LAMBERT_EXPOSURE),
        transparent: !!m.transparent && !pseudoOpaque,
        opacity: m.opacity ?? 1,
        side: THREE.DoubleSide,
      });
      if (m.alphaTest > 0) nm.alphaTest = m.alphaTest;
      if (pseudoOpaque) nm.alphaTest = Math.max(nm.alphaTest || 0, 0.33);
      if (m.userData && m.userData.detail) {
        const dtex = detailTexOf(m);
        if (dtex) patchSceneryDetail(nm, dtex, m.userData.detail.scale);
      }
      if (nm.transparent) nm.depthWrite = false;
      return nm;
    })()));
  const markNotDrawable = (mats: THREE.Material | THREE.Material[]): void => {
    const ms = Array.isArray(mats) ? mats : [mats];
    for (const mm of ms) if (mm && mm.userData) mm.userData.annotationSurface = false;
  };
  gltf.scene.traverse((node) => {
    const o = node as Mesh
    if (!o.isMesh || !o.material) return;
    const waterMarked = materialIsWater(o.material);
    if (onMesh) onMesh(o, waterMarked);
    let annotationSurface = !waterMarked && !isWaterNode(o.name, o.material, { strictSurfaces });
    if (!waterMarked && isSkyNode(o)) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => makeSkyMaterial(m as GltfSceneMaterial))
                                             : makeSkyMaterial(o.material as GltfSceneMaterial);
      o.userData.isSky = true;
      markNotDrawable(o.material);
      o.frustumCulled = false;
      skyMeshes++;
      if (debug && typeof window !== 'undefined') window.__skyMeshes = (window.__skyMeshes || 0) + 1;
      return;
    }
    const isCard = !!o.geometry.attributes._corner;
    if (isCard) annotationSurface = false;
    const uw = !!o.geometry && underWater(o);
    if (uw) annotationSurface = false;
    const assignMat = (m: GltfSceneMaterial): THREE.Material => {
      const ud = (m && m.userData) || {}
      if ((o.name || '').startsWith('ST|') || ((m && m.name) || '').startsWith('ST|')) annotationSurface = false;
      if (ud.mapBorder && typeof ud.mapBorder === 'object') {
        annotationSurface = false;
        if (debug && typeof window !== 'undefined') { window.__mapBorderMaterials = (window.__mapBorderMaterials || 0) + 1; }
        return makeMapBorderMaterial(m, ud.mapBorder as Parameters<typeof makeMapBorderMaterial>[1]);
      }
      if (ud.water && typeof ud.water === 'object') {
        const wt = waterTexOf(m);
        if (wt) {
          if (debug && typeof window !== 'undefined') { window.__waterMaterials = (window.__waterMaterials || 0) + 1; }
          if (debug && typeof window !== 'undefined' && window.__waterCoast) window.__waterCoast.materials = (window.__waterCoast.materials || 0) + 1;
          annotationSurface = false;
          o.renderOrder = 10 + waterRenderOrder++;
          return cachedSceneryMat(
            ['W', m.uuid, wt[0].uuid, wt[1].uuid, JSON.stringify(ud.water.props || null),
              JSON.stringify(ud.water.texCoordTransform0 || null), waterCoast ? 'c' : 'n'].join('#'),
            () => makeWaterMaterial(m, {
              normalTex: wt[0], cubeTex: wt[1], props: ud.water.props || {},
              coast: waterCoast, wro: ud.water,
            }));
        }
      }
      if (ud.blendByAngle) {
        annotationSurface = false;
        return makeBlendByAngleMaterial(m, ud.blendByAngle);
      }
      if (ud.decal && groundLayers && o.geometry.attributes.uv1) {
        const ownDecal = decalTexOf(m);
        const cmTex = ownDecal || groundLayers.texs.cm;
        if (cmTex) {
          const GL = groundLayers.layers || {};
          if (!isSolidDecalGeometry(o.geometry)) annotationSurface = false;
          return makeDecalMaterial(m, cmTex, ownDecal ? null : groundLayers.texs.lm, {
            separateLm: (ud.decalSeparateLm !== undefined)
              ? !!ud.decalSeparateLm
              : (!ownDecal && !!GL.separate_lm),
            lmAdjust: ud.decalLmAdjust || null,
            globalTint: !!GL.flatcolor,
          });
        }
      }
      if (ud.lightmap !== undefined && !isWaterNode(o.name, m, { strictSurfaces })
          && !isSkyNode(o) && !underWater(o)) {
        const atlas = lmTexOf(m);
        if (atlas && o.geometry.attributes.uv1) {
          const et = envTexOf(m);
          const props = (m.userData && m.userData.env) || {};
          const dtex = ud.detail ? detailTexOf(m) : null;
          return cachedSceneryMat(['LM', m.uuid, atlas.uuid,
            et ? [et[0].uuid, et[1].uuid, JSON.stringify(props)].join('|') : '',
            dtex ? [dtex.uuid, JSON.stringify(ud.detail.scale || null)].join('|') : ''].join('#'),
            () => makeLightmappedMaterial(m, atlas,
              et ? { maskTex: et[0], cubeTex: et[1], props } : null,
              dtex ? { tex: dtex, scale: ud.detail.scale } : null));
        }
      }
      const maskTex = ud.blendLayer ? maskTexOf(m) : null;
      if (maskTex && o.geometry.attributes.uv1) {
        annotationSurface = false;
        return makeBlendLayerMaterial(m, maskTex);
      }
      if (uw) {
        return cachedSceneryMat(['U', m.name || '', m.map ? m.map.uuid : '',
                                 m.color ? [m.color.r, m.color.g, m.color.b].map((v) => v.toFixed(4)).join(',') : '',
                                 !!m.transparent, m.opacity ?? 1, m.alphaTest ?? 0].join('|'),
          () => {
            if (m.map) { m.map.colorSpace = THREE.NoColorSpace; m.map.needsUpdate = true; }
            const nm = new THREE.MeshBasicMaterial({
              map: m.map || null,
              color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
              transparent: !!m.transparent,
              opacity: m.opacity ?? 1,
              side: THREE.DoubleSide,
            });
            if (m.alphaTest > 0) nm.alphaTest = m.alphaTest;
            return nm;
          });
      }
      return convMat(m, isCard);
    };
    o.material = Array.isArray(o.material) ? o.material.map((m) => assignMat(m as GltfSceneMaterial)) : assignMat(o.material as GltfSceneMaterial);
    if (!annotationSurface) markNotDrawable(o.material);
    if (isWaterNode(o.name, o.material, { strictSurfaces })) {
      if (!o.renderOrder) o.renderOrder = 10 + waterRenderOrder++;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const mm of ms) {
        if (!mm || !mm.transparent) continue;
        mm.depthWrite = true;
        mm.side = THREE.DoubleSide;
        mm.depthTest = true;
        mm.needsUpdate = true;
      }
    }
    if (isCard) {
      if (o.geometry.boundingSphere) o.geometry.boundingSphere.radius += 2;
    }
  });
  const animLayerMats: ShaderMaterial[] = [];
  gltf.scene.traverse((node) => {
    const o = node as Mesh
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const mm of ms) {
      const u = (mm as ShaderMaterial | undefined)?.uniforms
      if (mm && u && u.uTime && !(mm.userData && mm.userData.water)) {
        animLayerMats.push(mm as ShaderMaterial)
      }
    }
  });
  return { animLayerMats, skyMeshes };
}
