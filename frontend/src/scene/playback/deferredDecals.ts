import * as THREE from 'three';

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

export const DECAL_BLEND_PARAMS: Record<string, { transparent: boolean; blending: THREE.Blending; premultLerp: boolean }> = {
  alphaBlend: { transparent: true, blending: THREE.NormalBlending, premultLerp: false },
  additive: { transparent: true, blending: THREE.AdditiveBlending, premultLerp: false },
  multiplicative: { transparent: true, blending: THREE.CustomBlending, premultLerp: true },
}

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

export function buildDecalMeshes(doc: DecalDoc, atlas: THREE.Texture): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = 'deferredDecals';
  const geoms: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const byBlend = new Map<string, { positions: number[]; uvs: number[]; indices: number[]; base: number }>();
  let used = 0;
  for (const rec of doc.decals || []) {
    if (!validDecalRecord(rec)) continue;
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
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: params.blending,
      ...(params.blending === THREE.CustomBlending ? {
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.DstColorFactor,
        blendDst: THREE.ZeroFactor,       // GL: dst=zero
      } : {}),
      defines: params.premultLerp ? { DECAL_PREMULT_LERP: 1 } : {},
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.userData.annotationSurface = false;
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
