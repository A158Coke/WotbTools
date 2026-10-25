// 地面 pass SSOT：地形数据读取 + 地形几何装配 + 分层地表材质 + 水面"海岸线"资源——
// 3D 运行时（playbackScene）与俯视烘焙（scripts/bake-ground-overhead.mjs）共用同一份。
//
// 2026-10-14 抽层（用户裁示"直接完全照搬 3D 回放的代码接入渲染"）：此前烘焙**不渲染地面**，
// 底图来自客户端自带地图图（pack 的 ground.webp），与 3D 档的实时分层渲染
// （`cm × lm × tile/mask/heightblend`，见 groundShaderMaterial）差异显著——夜图/带 lm 图上
// 直接可见（faust"地面太亮"的来源即此：客户端图是亮的、分层渲染是夜色的 cm×lm）。
// 收编后两侧的地面像素级同源：几何（terrainMesh.buildAdaptiveTerrain + groundMapUv 装配）、
// 材质（分层着色 / 回退整图）、海岸线资源（makeWaterCoast）都只此一份。
//
// 宿主差异只留 I/O 与相机（有意保留，两侧各有平台约束）：
//   · 贴图/数据抓取方式（assetProvider.fetch vs 页面 fetch）、进度/stale 复查；
//   · 相机：运行为透视自由相机 + 视距 LOD；烘焙为固定正交俯拍（纹理契约见
//     tools/composite_overhead.py 头部；正交直下时地表着色是 (x,z) 的函数，
//     细分级不影响成像，故烘焙传 refineMask=null）。
import * as THREE from 'three';
import {
  buildAdaptiveTerrain, buildRefineMask, groundMapUv, decodeTerrainField,
  pairedTerrainBinUrl, terrainBinMatchesMeta, terrainBoundsOk, terrainFieldMetaValid,
} from './terrainMesh.js';

/** 分层地表纹理键集（客户端 `height_blend` 决定是否带 hmap 对）。 */
export function groundLayerKeys(L) {
  return L.height_blend
    ? ['cm', 'lm', 'tile0', 'tile1', 'mask0', 'mask1', 'hmap0', 'hmap1']
    : ['cm', 'lm', 'tile0', 'tile1', 'mask0', 'mask1'];
}

/** 分层贴图上传契约：tile/hmap 用 Repeat 平铺原生分辨率采样；全部开各向异性。
 *  ⚠️ cm/lm/mask **不得**设 colorSpace——客户端 legacy DXT 原样采样口径（C3 守卫）；
 *  flipY 沿用 TextureLoader 缺省（两边同式，这是像素级契约的一部分）。 */
export function setupGroundTextures(texs, anisotropy) {
  for (const k of ['tile0', 'tile1', 'hmap0', 'hmap1']) if (texs[k]) {
    texs[k].wrapS = texs[k].wrapT = THREE.RepeatWrapping;
    texs[k].anisotropy = anisotropy;
  }
  for (const k of ['cm', 'lm', 'mask0', 'mask1']) if (texs[k]) {
    texs[k].anisotropy = anisotropy;
  }
}

/**
 * 地形数据读取：`terrain.json` sidecar + 配对 `terrain.u16.bin` → 米制高度场。
 * 与原运行时逻辑逐行同式：
 *   · span 自愈——sidecar 曾误写垂直高差（zmax−zmin），按自带 worldBounds 取 max(dx,dy)；
 *   · json/bin 必须同一次发布——bin 以 terrainBinSha256 作缓存键取、解码前核对字节
 *     （PR #615 review P2，见 terrainMesh.js `pairedTerrainBinUrl`）。
 * @returns {{ field: Float32Array|null, meta: object, metaStatus: number|null, binStatus: number|null }}
 *   缺数据/校验不过 ⇒ field=null（调用方回落）。metaStatus/binStatus = 两次请求的 HTTP 状态（未发出 = null），
 *   供需要严格配对的调用方（俯视烘焙 fail-closed）按事实判定。
 *   **runtime 口径**：只有 meta 完整（size/terrainLayout/zmin/zmax/span）且 worldBounds 居中时
 *   才解码；terrain.json 缺失/缺字段绝不按缺省 size/layout/zmax 猜（旧行为会让 layout 2 的 bin
 *   按 layout 1 平移一列、高度按 100 m 缩放）。bin 仍会请求，以便烘焙侧区分“双 404”和
 *   “json 缺但 bin 在”两种事实。
 */
export async function loadTerrain({ binUrl, metaUrl, fetchFn, stale = () => false }) {
  const meta = {};
  let metaStatus = null, binStatus = null;
  const out = (field) => ({ field, meta, metaStatus, binStatus });
  if (!binUrl || !metaUrl) return out(null);
  const m = await fetchFn(metaUrl);
  metaStatus = m.status;
  if (stale()) return out(null);
  if (m.ok) {
    Object.assign(meta, await m.json());
    if (stale()) return out(null);
    const wb = meta.worldBounds;
    if (Array.isArray(wb?.min) && Array.isArray(wb?.max)) {
      const dx = wb.max[0] - wb.min[0];
      const dy = wb.max[1] - wb.min[1];
      if (dx > 0 || dy > 0) meta.span = Math.max(dx, dy);
    }
  }
  const b = await fetchFn(pairedTerrainBinUrl(binUrl, meta));
  binStatus = b.status;
  if (stale()) return out(null);
  if (b.ok) {
    const tbuf = await b.arrayBuffer();
    if (stale()) return out(null);
    if (!terrainFieldMetaValid(meta)) {
      console.warn('地形元数据缺失/不完整（size/terrainLayout/zmin/zmax），拒绝按缺省值解码（回退 2D）');
      return out(null);
    }
    if (!Number.isFinite(Number(meta.span)) || Number(meta.span) <= 0) {
      console.warn('地形元数据缺 span（回退 2D）');
      return out(null);
    }
    if (!terrainBoundsOk(meta)) {
      console.warn('地形 worldBounds 不是居中正方形（当前消费口径不支持），回退 2D:', meta.worldBounds);
      return out(null);
    }
    if (await terrainBinMatchesMeta(tbuf, meta)) return out(decodeTerrainField(tbuf, meta));
    console.warn('地形 bin 与 terrain.json 不是同一次发布（sha256 不符，回退）');
  }
  return out(null);
}

/** 地形几何装配（客户端同构自适应细分；算法与 UV 契约在 terrainMesh.js）。几何直接建在场景系。 */
export function buildGroundGeometry({
  field, n, span, cam, fovY, aspect = 16 / 9, hFovDeg = null, refineMask = null, cx = 0, cz = 0,
}) {
  const { positions, indices, sizeAt, vertexIndexAt, morphRaw, quads, overBudget } = buildAdaptiveTerrain({
    field, n, span, cam, fovY, aspect, hFovDeg, refineMask,
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // 底图 UV：回退档（无分层）把 `ground.webp` 直接摊在地形上——分层着色的 UV 在
  // 片元由世界坐标反推，但回退材质吃几何 `uv`，缺了整张图退化成单 texel 常量（2026-10-10 review P1）
  g.setAttribute('uv', new THREE.BufferAttribute(groundMapUv(positions, span, cx, cz), 2));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.userData.terrainBuild = { positions, sizeAt, vertexIndexAt, morphRaw, quads, overBudget, n, span };
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** 地面材质：分层地表优先（客户端 tilemask-fp.sl 实时合成，见 groundShaderMaterial）；
 *  缺失时回退整图底图（MeshBasicMaterial，toneMapped=false 保持烘焙色彩逐像素对齐客户端）。 */
export function makeGroundMaterial({ layers = null, texs = null, size, cx = 0, cz = 0, mapTexture = null }) {
  if (layers && texs) return groundShaderMaterial(layers, texs, size, cx, cz);
  const mat = new THREE.MeshBasicMaterial({ map: mapTexture });
  mat.toneMapped = false;
  return mat;
}

/** 水面"海岸线"（客户端 water-fp.sl 的 coastLine，见 makeWaterMaterial）共享资源：
 *  真值高度场做成可线性滤波的浮点纹理 + near/far/深度位深（淡出阈值的量纲）。
 *  `depthBits` 由调用方按各自上下文实测（运行时/烘焙同一个探测法）。 */
export function makeWaterCoast({ field, n, span, near, far, depthBits = 24 }) {
  const htex = new THREE.DataTexture(field, n, n, THREE.RedFormat, THREE.FloatType);
  htex.minFilter = THREE.LinearFilter;
  htex.magFilter = THREE.LinearFilter;
  htex.wrapS = THREE.ClampToEdgeWrapping;
  htex.wrapT = THREE.ClampToEdgeWrapping;
  htex.colorSpace = THREE.NoColorSpace;      // 数据纹理（C3 口径：不加 sRGB 解码）
  htex.needsUpdate = true;
  return {
    heightTex: htex, mapSpan: span,
    near, far,
    depthUlp: 2 / Math.pow(2, depthBits),
  };
}

/** 贴地薄构件走廊掩码（运行时与俯视烘焙**共用同一份**）。
 *
 *  动因（2026-10-10 用户"铁轨被盖"）：粗 LOD 补片按双线性/弦线插值，插值面在切槽/路堑处
 *  会**高于**真实地表 ⇒ 贴地薄构件（轨道/路缘/贴地薄板）被地形盖住；运行时靠本掩码把这些
 *  走廊 texel 强制到最细层。⚠️ 正交俯视下同样成立——细分级不影响"着色是 (x,z) 的函数"，
 *  但**遮挡**取决于插值高度 ⇒ 俯视烘焙必须同比细化（2026-10-14 用户报"轨道被下方地形
 *  遮挡"，烘焙侧此前未接入本机制）。
 *
 *  类判据（**统一适用于每个网格**，不做逐件统计判定）：① 世界 AABB 高 ≤ 2.5 m（薄板/缓坡板）；
 *  ② AABB 底面贴地形真值（足迹内 9 个采样点里至少 1 个 |Δ| ≤ 1.0 m）；③ 排除水面/水下片
 *  （任一材质带 extras.water）。命中件再按三角形沿三条边以 ≤1 texel 间距采足迹点（世界系）。
 *
 *  ⚠️ 前置条件：调用前 mesh 必须已置于**场景系**世界矩阵下（运行时=mapScenery 之下，烘焙=
 *  qFrame group 之下），且必须在"实例化合批"之前（合批会换掉逐节点 Mesh）。
 *  @returns {{ mask: Uint8Array, candidates: number, texels: number } | null}
 */
export function buildCorridorRefineMask({ meshes, field, n, span, marginTexels = 2 }) {
  if (!meshes || !meshes.length || !field) return null;
  const texelM = span / n;
  const truthAt = (x, z) => {
    const i = Math.round((z / span + 0.5) * n), j = Math.round((x / span + 0.5) * n);
    if (i < 0 || j < 0 || i >= n || j >= n) return null;
    return field[i * n + j];
  };
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const candidates = [];
  for (const { o, water } of meshes) {
    if (water) continue;
    box.setFromObject(o);
    if (box.isEmpty() || box.max.y - box.min.y > 2.5) continue;
    let hug = false;
    for (let fx = 0; fx <= 1 && !hug; fx += 0.5) {
      for (let fz = 0; fz <= 1; fz += 0.5) {
        const t = truthAt(box.min.x + (box.max.x - box.min.x) * fx, box.min.z + (box.max.z - box.min.z) * fz);
        if (t !== null && Math.abs(box.min.y - t) <= 1.0) { hug = true; break; }
      }
    }
    if (hug) candidates.push(o);
  }
  const pts = [];
  for (const mesh of candidates) {
    const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
    if (!pos) continue;
    const idx = mesh.geometry.index;
    const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
    for (let t = 0; t < triCount; t++) {
      const kk = [idx ? idx.getX(t * 3) : t * 3, idx ? idx.getX(t * 3 + 1) : t * 3 + 1, idx ? idx.getX(t * 3 + 2) : t * 3 + 2];
      const P = kk.map((k) => new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).applyMatrix4(mesh.matrixWorld));
      for (let e = 0; e < 3; e++) {
        const from = P[e], to = P[(e + 1) % 3];
        const steps = Math.max(1, Math.ceil(from.distanceTo(to) / texelM));
        for (let s = 0; s < steps; s++) { v.lerpVectors(from, to, s / steps); pts.push(v.x, v.z); }
      }
      v.copy(P[0]).add(P[1]).add(P[2]).multiplyScalar(1 / 3);
      pts.push(v.x, v.z);
    }
  }
  if (!pts.length) return null;
  const mask = buildRefineMask(pts, n, span, marginTexels);
  let texels = 0;
  for (let k = 0; k < mask.length; k++) texels += mask[k];
  return { mask, candidates: candidates.length, texels };
}

// 客户端 Landscape/tilemask-fp.sl 非 PBR 路径的实时合成材质（离线着色器解码
// 逐分支核对）：GLOBAL_TINT（globalFlatColor×2 + lightmap 通道 brightness/
// contrast/gamma 调整）、SCALED_TILES（每通道各自 tileScale）、HEIGHT_BLEND
// （tilemaskWeight×(mask×2−1) + hMap×scale + offset，softness 归一加权）。
// UV 在片元由世界坐标反推（colormap 原始空间，分层贴图行序未翻转：
// u = 0.5−X/s、v = 0.5−Z/s）；tile/height 用 Repeat 平铺原生分辨率采样，
// 清晰度等同客户端。伽马空间直出（客户端着色器同为 sRGB 纹理直采直写）。
export function groundShaderMaterial(L, texs, size, cx, cz) {
  return new THREE.ShaderMaterial({
    defines: {
      GLOBAL_TINT: !!L.flatcolor,
      SEPARATE_LM: !!L.separate_lm,
      SCALED_TILES: !!L.scaled_tiles,
      HEIGHT_BLEND: !!L.height_blend,
    },
    uniforms: {
      uCM: { value: texs.cm }, uLM: { value: texs.lm },
      uTile0: { value: texs.tile0 }, uTile1: { value: texs.tile1 },
      uMask0: { value: texs.mask0 }, uMask1: { value: texs.mask1 },
      uHMap0: { value: texs.hmap0 || texs.tile0 },
      uHMap1: { value: texs.hmap1 || texs.tile1 },
      uSize: { value: size }, uCenter: { value: new THREE.Vector2(cx, cz) },
      uTiling: { value: new THREE.Vector2(L.tiling[0], L.tiling[1]) },
      uTileScale: { value: new THREE.Vector4(L.tile_scale[0], L.tile_scale[1],
                                             L.tile_scale[2], L.tile_scale[3]) },
      uTC: { value: L.tile_colors.map((c) => new THREE.Vector3(c[0], c[1], c[2])) },
      uFlatColor: { value: new THREE.Vector3(L.flat_color[0], L.flat_color[1], L.flat_color[2]) },
      uLmAdjust: { value: new THREE.Vector3(L.lm_adjust[0], L.lm_adjust[1], L.lm_adjust[2]) },
      uTmWeight: { value: L.tilemask_weight },
      uHbScale: { value: new THREE.Vector4(L.hb_scale[0], L.hb_scale[1],
                                           L.hb_scale[2], L.hb_scale[3]) },
      uHbOffset: { value: new THREE.Vector4(L.hb_offset[0], L.hb_offset[1],
                                            L.hb_offset[2], L.hb_offset[3]) },
      uHbSoft: { value: new THREE.Vector4(L.hb_softness[0], L.hb_softness[1],
                                          L.hb_softness[2], L.hb_softness[3]) },
    },
    vertexShader: `
      // <common> 必须先于 logdepthbuf_vertex：后者调用的 isPerspectiveMatrix 定义
      // 在 common 里，漏 include 会让整个材质 GLSL 编译失败（地形/叶卡整片消失）
      #include <common>
      varying vec2 vXZ;
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vXZ = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D uCM;
      uniform sampler2D uLM;
      uniform sampler2D uTile0;
      uniform sampler2D uTile1;
      uniform sampler2D uMask0;
      uniform sampler2D uMask1;
      uniform sampler2D uHMap0;
      uniform sampler2D uHMap1;
      uniform float uSize;
      uniform vec2 uCenter;
      uniform vec2 uTiling;
      uniform vec4 uTileScale;
      uniform vec3 uTC[4];
      uniform vec3 uFlatColor;
      uniform vec3 uLmAdjust;
      uniform float uTmWeight;
      uniform vec4 uHbScale;
      uniform vec4 uHbOffset;
      // ⚠️ 必须是 vec4（与 uHbScale/uHbOffset 及 JS 侧的 Vector4 一致、按通道软度）：
      // 曾误写成 float ⇒ three 按声明类型上传（值却是 Vector4 ⇒ NaN）⇒ 高度分层混合权重
      // 全废、地面取错层色（2026-10-10 用户"米德尔堡地面贴图颜色不对"；受影响 = 开
      // HEIGHT_BLEND 的 9 张图：desert_train/erlenberg/holland/idle/lagoon/plant/pliego/rift/rudniki）。
      // 着色器门禁抓不到这类滑落：vec4 − float 是合法 GLSL（标量广播）⇒ 编译通过，错在类型口径。
      uniform vec4 uHbSoft;
      varying vec2 vXZ;
      #include <logdepthbuf_pars_fragment>

      void main() {
        #include <logdepthbuf_fragment>
        vec2 tc = vec2(0.5 - (vXZ.x - uCenter.x) / uSize,
                       0.5 - (vXZ.y - uCenter.y) / uSize);
        vec3 colorAlbedo = texture2D(uCM, tc).rgb;
        float lmA = texture2D(uLM, tc).r;
        #ifdef GLOBAL_TINT
        colorAlbedo *= uFlatColor * 2.0;
        #ifdef SEPARATE_LM
        lmA = pow(lmA, uLmAdjust.b);
        lmA = (lmA - 0.5) * uLmAdjust.g + 0.5;
        lmA += uLmAdjust.r;
        #endif
        #endif
        #ifdef SEPARATE_LM
        vec3 shadowColor = colorAlbedo * lmA;
        #else
        vec3 shadowColor = colorAlbedo;
        #endif

        vec4 mask = vec4(texture2D(uMask0, tc).rgb, texture2D(uMask1, tc).r);
        vec2 tuv = tc * uTiling;
        #ifdef SCALED_TILES
        vec4 tileColor = vec4(
          texture2D(uTile0, tuv * uTileScale.x).r,
          texture2D(uTile0, tuv * uTileScale.y).g,
          texture2D(uTile0, tuv * uTileScale.z).b,
          texture2D(uTile1, tuv * uTileScale.w).r);
        #else
        vec4 tileColor = vec4(texture2D(uTile0, tuv).rgb, texture2D(uTile1, tuv).r);
        #endif

        #ifdef HEIGHT_BLEND
        #ifdef SCALED_TILES
        vec4 hMap = vec4(
          texture2D(uHMap0, tuv * uTileScale.x).r,
          texture2D(uHMap0, tuv * uTileScale.y).g,
          texture2D(uHMap0, tuv * uTileScale.z).b,
          texture2D(uHMap1, tuv * uTileScale.w).r);
        #else
        vec4 hMap = vec4(texture2D(uHMap0, tuv).rgb, texture2D(uHMap1, tuv).r);
        #endif
        vec4 mask2 = clamp(uTmWeight * (mask * 2.0 - 1.0)
                           + hMap * uHbScale + uHbOffset, 0.0, 1.0);
        float mx = max(max(mask2.x, mask2.y), max(mask2.z, mask2.w));
        vec4 hb = max(mask2 - (vec4(mx) - uHbSoft), vec4(0.001));
        vec3 detail = (tileColor.r * uTC[0] * hb.x + tileColor.g * uTC[1] * hb.y +
                       tileColor.b * uTC[2] * hb.z + tileColor.a * uTC[3] * hb.w) /
                      (hb.x + hb.y + hb.z + hb.w);
        #else
        vec3 detail = tileColor.r * mask.r * uTC[0] + tileColor.g * mask.g * uTC[1] +
                      tileColor.b * mask.b * uTC[2] + tileColor.a * mask.a * uTC[3];
        #endif

        gl_FragColor = vec4(detail * shadowColor * 2.0, 1.0);
      }`,
  });
}
