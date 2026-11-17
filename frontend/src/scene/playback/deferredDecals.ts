// 投影贴花静态消费（上游 tools/export_map_glb.py 产物 map/<key>/decals.json，2026-11-17
// 上游审计 B9；当前内容仅 plant 有 490 实例）。
//
// 客户端语义（Materials/Shaders/Default/deferred-decal-{fp,vp}.sl + DeferredDecal.material
// + blending.slh，上游已逐行核对）：贴花 = **单位盒投影**——实体 TransformComponent 给出盒的
// 世界位姿（缩放 = 盒尺寸、旋转 = 投影朝向），逐像素由场景深度反投影回盒模型空间
// positionMS ∈ [-0.5, 0.5]³，|x|,|y| 界内才着色，UV = uvOffset + uvScale·(positionMS.xy+0.5)
// （单一 albedo 采样器，即上游解码的图集）。blending = 组件字段（blending.slh 枚举）。
//
// **静态近似（本模块）**：没有深度重建（无 deferred G-buffer），改画**盒中心 xy 平面上的
// 单位贴片**（局部 z=0，按盒矩阵摆到世界）——盒贴着墙面/地面生成，中心面近似贴花所在的
// 表面平面。已知偏差（如实记录，非客户端同构）：
// ① 曲面/跨台阶的贴花不会被表面"折弯"（客户端投影会贴着几何走）；
// ② 中心面可能与表面相交 ⇒ 用 polygonOffset 往视点拉，仍有边缘 z-fighting 可能；
// ③ 盒厚度方向两侧都可见（DoubleSide；客户端 FACE_BACK 只投到正面）。
// blending 三种在内容里出现（上游实测 490 条：1 AlphaBlend×64 / 2 Additive×66 /
// 5 Multiplicative×360），其余枚举值 fail-closed 跳过（宁缺不猜）。
// MULTIPLICATIVE 的片元末变换 `rgb = lerp(1, rgb, a)`（deferred-decal-fp.sl:145-147）在
// 着色器里逐字复刻——alpha=0 区域输出 rgb=1，乘上背景不变。
// 数据面的 flatColor（54 条）在 DeferredDecal.material 无 FLATCOLOR define ⇒ 客户端不采，
// 本模块同样不消费（与客户端口径一致，不是丢数据）。
// ④ fadeDistance / verticalFadeWidth / backSideFade（画质计划 D2）**不消费**：当前全部
//    decal 数据（plant 490 条，客户端 11.10 导出）三项均为 0/0/false，没有非零样本可验证
//    语义；客户端材质（Default/deferred-decal、Deferred/ 同名变体）的 vertex 只读
//    nearFadeDistance/farFadeDistance（auto 材质参数），fragment 以 positionMS.|z| 出界裁切，
//    没有与组件字段的映射证据。vertical fade 还需要深度重建（静态四边形近似没有
//    positionMS.z），按 fail-closed 不猜——等出现非零实例再按客户端 shader 复刻。
import * as THREE from 'three';

/** decals.json 契约（上游 export_deferred_decals 的写出形状）。 */
export interface DecalRecord {
  name?: string | null
  blending: number
  blendingName?: string | null
  fogBehaviour?: number
  layer?: number
  fadeDistance?: number
  verticalFadeWidth?: number
  backSideFade?: boolean
  isShadowReceiver?: boolean
  texture: string
  uvOffset: number[]
  uvScale: number[]
  box: {
    translation: number[]
    scale: number[]
    rotation: number[]
  }
  flatColor?: number[]
  [key: string]: unknown
}

export interface DecalDoc {
  space: string
  version: number
  textures: Record<string, string>
  decals: DecalRecord[]
}

/** blending.slh 枚举 → 渲染参数（客户端 blending.slh 逐字；MULTIPLICATIVE 另有片元 lerp）。 */
export const DECAL_BLEND_PARAMS: Record<string, { transparent: boolean; blending: THREE.Blending; premultLerp: boolean }> = {
  alphaBlend: { transparent: true, blending: THREE.NormalBlending, premultLerp: false },
  additive: { transparent: true, blending: THREE.AdditiveBlending, premultLerp: false },
  multiplicative: { transparent: true, blending: THREE.CustomBlending, premultLerp: true },
}

/**
 * fail-closed 校验一条贴花记录可静态重建（字段齐全 + 数值有限）。
 * 返回 null = 跳过（不猜兜底——上游写出的记录要么完整要么该图无此贴花）。
 */
export function validDecalRecord(rec: DecalRecord): boolean {
  if (!rec || typeof rec !== 'object') return false;
  const box = rec.box;
  if (!box || !Array.isArray(box.translation) || box.translation.length !== 3
      || !Array.isArray(box.scale) || box.scale.length !== 3
      || !Array.isArray(box.rotation) || box.rotation.length !== 4) return false;
  const nums = [...box.translation, ...box.scale, ...box.rotation, ...rec.uvOffset, ...rec.uvScale];
  if (!nums.every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
  if (!Array.isArray(rec.uvOffset) || rec.uvOffset.length !== 2
      || !Array.isArray(rec.uvScale) || rec.uvScale.length !== 2) return false;
  if (typeof rec.blendingName !== 'string' || !(rec.blendingName in DECAL_BLEND_PARAMS)) return false;
  return true;
}

/**
 * 单位贴片四角 → 客户端世界坐标 + 图集 UV（纯函数，测试锚点）。
 *
 * 盒矩阵 = 平移·旋转·缩放（客户端 TransformComponent 语义）；贴片 = 盒局部 xy 平面
 * z=0 的 [-0.5,0.5]² 四边形；UV = uvOffset + uvScale·(ms.xy + 0.5)（客户端 fp:100-101 同式，
 * v 不翻——glTF 纹理 flipY=false，上游图集按"文件原始行序"嵌入，v=0 = 首行）。
 * 顶点顺序 (−,−) (+,−) (+,+) (−,+)，索引 [0,1,2, 0,2,3]（正面 = +z 侧）。
 */
export function decalQuadWorld(rec: DecalRecord): { positions: number[]; uvs: number[]; indices: number[] } {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(rec.box.translation[0], rec.box.translation[1], rec.box.translation[2]),
    new THREE.Quaternion(rec.box.rotation[0], rec.box.rotation[1], rec.box.rotation[2], rec.box.rotation[3]),
    new THREE.Vector3(rec.box.scale[0], rec.box.scale[1], rec.box.scale[2]),
  );
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const [x, y] of corners) {
    const p = new THREE.Vector3(x, y, 0).applyMatrix4(m);
    positions.push(p.x, p.y, p.z);
    uvs.push(rec.uvOffset[0] + rec.uvScale[0] * (x + 0.5),
             rec.uvOffset[1] + rec.uvScale[1] * (y + 0.5));
  }
  return { positions, uvs, indices: [0, 1, 2, 0, 2, 3] };
}

/**
 * decals.json + 图集纹理 → 按 blending 分组合并的贴片组（每 blending 一种材质 = 每图最多
 * 3 个 draw call；490 条逐条建材质/网格会拖垮场景图）。
 *
 * 坐标帧：几何顶点 = **客户端世界系**（与场景 GLB 节点同帧）；调用方把返回的 group 放进
 * 与 mapScenery 同款 qFrame（Ry(π)·Rx(−π/2)）的父级，或直接对 group 施加同款旋转。
 * dispose() 释放本模块创建的 geometry/material；**atlas 纹理归调用方所有**（不 dispose）。
 */
export function buildDecalMeshes(doc: DecalDoc, atlas: THREE.Texture): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = 'deferredDecals';
  const geoms: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const byBlend = new Map<string, { positions: number[]; uvs: number[]; indices: number[]; base: number }>();
  let used = 0;
  for (const rec of doc.decals || []) {
    if (!validDecalRecord(rec)) continue;
    // 图集身份按记录的 texture 键与 doc.textures 的唯一映射核对（上游 fail-closed：解析
    // 不到实体文件的贴花在导出期已被剔除；此处 textures 应只有 1–2 项且都指向包内文件）
    if (!doc.textures || doc.textures[rec.texture] === undefined) continue;
    const bn = rec.blendingName as string;
    let bucket = byBlend.get(bn);
    if (!bucket) {
      bucket = { positions: [], uvs: [], indices: [], base: 0 };
      byBlend.set(bn, bucket);
    }
    const q = decalQuadWorld(rec);
    bucket.base = bucket.positions.length / 3;
    bucket.positions.push(...q.positions);
    bucket.uvs.push(...q.uvs);
    for (const i of q.indices) bucket.indices.push(bucket.base + i);
    used++;
  }
  for (const [bn, b] of byBlend) {
    const params = DECAL_BLEND_PARAMS[bn];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
    geo.setIndex(b.indices);
    // 无面法线：贴片自发光（客户端 StaticDecalRenderLayer 不受光），着色器无需法线
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: atlas } },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          vec4 c = texture2D(map, vUv);
          #if defined(DECAL_PREMULT_LERP)
          // 客户端 MULTIPLICATIVE 片元末（deferred-decal-fp.sl:145-147）：rgb = lerp(1, rgb, a)
          gl_FragColor = vec4(mix(vec3(1.0), c.rgb, c.a), 1.0);
          #else
          gl_FragColor = c;
          #endif
        }`,
      transparent: params.transparent,
      depthWrite: false,          // 客户端 RenderState：blend:true + depthWrite:false
      depthTest: true,
      side: THREE.DoubleSide,     // 客户端 FACE_BACK；贴片两面都可见更稳（近似取舍）
      blending: params.blending,
      ...(params.blending === THREE.CustomBlending ? {
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.DstColorFactor,   // GL: src=dst_color
        blendDst: THREE.ZeroFactor,       // GL: dst=zero
      } : {}),
      defines: params.premultLerp ? { DECAL_PREMULT_LERP: 1 } : {},
      // 中心贴片与墙面可能共面相交：往视点拉一个深度偏移（近似取舍，见模块头注）
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;   // 全图合并成 3 个大包围盒，剔除收益为零、误剔风险为正
    mesh.renderOrder = 1;         // 透明队列内排在水面（默认 0）之后，减少与水面的排序抖动
    mesh.userData.annotationSurface = false;   // 贴花是"效果层"，不是 3D annotation 可绘制表面
    geoms.push(geo);
    mats.push(mat);
    group.add(mesh);
  }
  return {
    group,
    dispose() {
      for (const g of geoms) g.dispose();
      for (const m of mats) m.dispose();
      group.clear();
    },
  };
}
