import * as THREE from 'three'
import type { Mesh, Object3D, ShaderMaterial, Texture } from 'three'
import type { GltfSceneMaterial } from './sceneryMaterialTypes.js'
import { duckProps } from './sceneryMaterialTypes.js'
export type { GltfSceneMaterial } from './sceneryMaterialTypes.js'
export * from './sceneryLightingMaterials.js'
export * from './sceneryWaterMaterials.js'
export * from './scenerySurfaceMaterials.js'

const sceneryMatCache = new Map<string, THREE.Material>();

export const foliageClip: { value: number } = { value: 0 }


export function cachedSceneryMat<T extends THREE.Material>(key: string, factory: () => T): T {
  const cached = sceneryMatCache.get(key);
  if (cached) return cached as T;
  const m = factory();
  sceneryMatCache.set(key, m);
  return m;
}

export function clearSceneryMatCache(): void {
  sceneryMatCache.clear();
}

const CARD_ALPHA_CUT = 0.33;
export const SCENERY_LAMBERT_EXPOSURE = 0.75;
export const isWaterName = (n: string | null | undefined): boolean => /water|sea|lake|river|fountain/i.test(n || '');

export function makeBillboardMaterial(m: GltfSceneMaterial): ShaderMaterial {
  const occRaw = m.userData && Number(m.userData.occMean);
  const newPack = occRaw === 1;
  const occMean = newPack ? 1 : (Number.isFinite(occRaw) && occRaw > 0 ? occRaw : 0.8);
  const c0 = m.color;
  const factorOk = c0 && [c0.r, c0.g, c0.b].every((v) => Number.isFinite(v) && v > 0);
  const shTint = factorOk
    ? new THREE.Vector3(c0.r, c0.g, c0.b)
    : (newPack ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(1.77, 1.77, 1.77));
  if (m.map) { m.map.colorSpace = THREE.NoColorSpace; m.map.needsUpdate = true; }
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: m.map || null },
      uSH: { value: shTint },
      uOccMean: { value: occMean },
      uProdClamp: { value: newPack ? 2.0 : 1.35 },
      uAlphaCut: { value: CARD_ALPHA_CUT },
      uFoliageClip: foliageClip,
    },
    vertexShader: `
      attribute vec4 _corner;
      attribute vec4 color;
      // <common> 必须先于 logdepthbuf_vertex（isPerspectiveMatrix 定义在 common 里）
      #include <common>
      varying vec2 vUv;
      varying float vOcc;
      varying float vViewDist;
      #include <logdepthbuf_pars_vertex>
      void main() {
        // 实例化合批：USE_INSTANCING 下 instanceMatrix 由 WebGLProgram 自动声明
        //（ShaderMaterial 同样生效），叶卡批次与 Lambert 批次走同一套实例矩阵。
        // 角点扩张的世界尺度取 model×instance 合成矩阵首列模长（原为纯 model）。
        #ifdef USE_INSTANCING
        mat4 im = modelMatrix * instanceMatrix;
        #else
        mat4 im = modelMatrix;
        #endif
        vec4 wp = im * vec4(position, 1.0);
        vec3 vp = (viewMatrix * wp).xyz;
        float ws = length(vec3(im[0][0], im[1][0], im[2][0]));
        vp += _corner.xyz * ws;
        vViewDist = length(vp);
        gl_Position = projectionMatrix * vec4(vp, 1.0);
        #include <logdepthbuf_vertex>
        vUv = uv;
        vOcc = color.r;
      }`,
    transparent: false,
    depthWrite: true,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 uSH;
      uniform float uOccMean;
      uniform float uProdClamp;
      uniform float uAlphaCut;
      uniform float uFoliageClip;
      varying vec2 vUv;
      varying float vOcc;
      varying float vViewDist;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        if (vViewDist < uFoliageClip) discard;
        vec4 c = texture2D(map, vUv);
        if (c.a < uAlphaCut) discard;
        float occ = min(vOcc / max(uOccMean, 0.001), 1.25);
        gl_FragColor = vec4(c.rgb * min(occ * uSH, vec3(uProdClamp)), c.a);
      }`,
    side: THREE.DoubleSide,
  });
}

export function makeSpeedtreeStaticMaterial(m: GltfSceneMaterial, opaqueEnough: boolean): ShaderMaterial {
  if (m.map) { m.map.colorSpace = THREE.NoColorSpace; m.map.needsUpdate = true; }
  const softAlpha = !!(m.userData && m.userData.alphaBlend);
  const blend = !opaqueEnough || softAlpha;
  const c0 = m.color;
  const factorOk = c0 && [c0.r, c0.g, c0.b].every((v) => Number.isFinite(v) && v > 0);
  const sh = factorOk ? new THREE.Vector3(c0.r, c0.g, c0.b) : new THREE.Vector3(1, 1, 1);
  const hasVC = !!m.vertexColors;
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: m.map || null },
      uSH: { value: sh },
      uAlphaCut: { value: blend ? 0.05 : 0.33 },
      uOpacity: { value: m.opacity ?? 1 },
      uFoliageClip: foliageClip,
    },
    vertexShader: `
      ${hasVC ? 'attribute vec4 color;' : ''}
      // <common> 必须先于 logdepthbuf_vertex（isPerspectiveMatrix 定义在 common 里）
      #include <common>
      varying vec2 vUv;
      varying float vOcc;
      varying float vViewDist;
      #include <logdepthbuf_pars_vertex>
      void main() {
        // 实例化合批（perf 分支）：ST| 静态几何按 (geometry, material) 合并为
        // InstancedMesh——手写 shader 必须显式乘 instanceMatrix（WebGLProgram 在
        // USE_INSTANCING 下自动声明该 attribute，ShaderMaterial 同样生效），否则
        // 整批实例全部叠画在场景原点（= 树干集体消失）。非实例化路径（上游/无合批
        // 的检出）走 #else，行为逐字节不变。
        #ifdef USE_INSTANCING
        mat4 im = modelViewMatrix * instanceMatrix;
        #else
        mat4 im = modelViewMatrix;
        #endif
        vec4 viewPosition = im * vec4(position, 1.0);
        vViewDist = length(viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
        #include <logdepthbuf_vertex>
        vUv = uv;
        vOcc = ${hasVC ? 'color.r' : '1.0'};
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 uSH;
      uniform float uAlphaCut;
      uniform float uOpacity;
      uniform float uFoliageClip;
      varying vec2 vUv;
      varying float vOcc;
      varying float vViewDist;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        if (vViewDist < uFoliageClip) discard;
        vec4 c = texture2D(map, vUv);
        if (c.a < uAlphaCut) discard;
        gl_FragColor = vec4(c.rgb * (vOcc * uSH), c.a * uOpacity);
      }`,
    side: THREE.DoubleSide,
    transparent: blend,
    depthWrite: !blend,
  });
}

export function makeSkyMaterial(m: GltfSceneMaterial): ShaderMaterial {
  if (m.map) { m.map.colorSpace = THREE.NoColorSpace; m.map.needsUpdate = true; }
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: m.map || null } },
    vertexShader: `
      // <common> 必须先于 logdepthbuf_vertex（isPerspectiveMatrix 定义在 common 里）
      #include <common>
      varying vec2 vUv;
      void main() {
        // 实例化分支与叶卡/ST| 同约定：手写 shader 只乘 modelMatrix 而不带 USE_INSTANCING
        // 时，一旦被 InstancedMesh 消费整批实例会叠画在原点。天穹当前恒被排除在合批外
        //（playbackScene 的 /sky/i 过滤），但 w=0 让 instanceMatrix 的平移天然失效、
        // 只留旋转——即合批也语义正确，故直接按同一约定写，不留特例。
        #ifdef USE_INSTANCING
        mat4 im = modelMatrix * instanceMatrix;
        #else
        mat4 im = modelMatrix;
        #endif
        // w=0：丢弃平移、保留旋转/缩放（含父级 qFrame 的场景系旋转），
        // 与客户端 worldViewProjMatrix 的线性部分一致
        vec4 p = projectionMatrix * viewMatrix * im * vec4(position, 0.0);
        // 深度钉远平面（客户端 position.w -= 0.0001 的等效）
        gl_Position = vec4(p.xy, p.w, p.w);
        vUv = uv;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0);
      }`,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
  });
}

export function applyMaterialTextureAnisotropy(root: Object3D, anisotropy: number): number {
  const seen = new Set<string>();
  root.traverse((node) => {
    const o = node as Mesh
    const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of ms) {
      if (!m) continue;
      const texs: Texture[] = [];
      const props = duckProps(m)
      for (const k in props) { const v = props[k]; if (v && v.isTexture) texs.push(v as Texture); }
      const uniforms = (m as { uniforms?: Record<string, { value?: unknown }> }).uniforms;
      if (uniforms) {
        for (const k in uniforms) {
          const v = uniforms[k] && uniforms[k].value as { isTexture?: unknown } | undefined;
          if (v && v.isTexture) texs.push(v as Texture);
        }
      }
      for (const t of texs) {
        if (seen.has(t.uuid)) continue;
        seen.add(t.uuid);
        t.anisotropy = anisotropy;
        t.needsUpdate = true;
      }
    }
  });
  return seen.size;
}

export function makeBlendLayerMaterial(m: GltfSceneMaterial, maskTex: Texture | null | undefined): ShaderMaterial {
  const map = m.map || null;
  if (map) { map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true; }
  if (maskTex) { maskTex.colorSpace = THREE.NoColorSpace; maskTex.needsUpdate = true; }
  const ud = m.userData || {};
  const anim = Array.isArray(ud.tex0ShiftPerSecond) ? ud.tex0ShiftPerSecond : [0, 0];
  const stat = Array.isArray(ud.texture0Shift) ? ud.texture0Shift : [0, 0];
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      mask: { value: maskTex || map },
      uTint: { value: m.color ? m.color.clone() : new THREE.Color(0xffffff) },
      uShiftRate: { value: new THREE.Vector2(anim[0] || 0, anim[1] || 0) },
      uShiftStatic: { value: new THREE.Vector2(stat[0] || 0, stat[1] || 0) },
      uTime: { value: 0 },          // 回放秒数，由 playbackScene 每帧写
    },
    vertexShader: `
      attribute vec2 uv1;   // GLTFLoader 的第二套 UV（TEXCOORD_1）——掩码采样用
      // <common> 必须先于 logdepthbuf_vertex（isPerspectiveMatrix 定义在 common 里）
      #include <common>
      varying vec2 vUv;
      varying vec2 vUv1;
      #include <logdepthbuf_pars_vertex>
      void main() {
        #ifdef USE_INSTANCING
        mat4 im = modelMatrix * instanceMatrix;
        #else
        mat4 im = modelMatrix;
        #endif
        gl_Position = projectionMatrix * viewMatrix * im * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
        vUv = uv;
        vUv1 = uv1;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform sampler2D mask;
      uniform vec3 uTint;
      uniform vec2 uShiftRate;
      uniform vec2 uShiftStatic;
      uniform float uTime;
      varying vec2 vUv;
      varying vec2 vUv1;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        // 客户端 frac(速率 × 时间)：取小数部分（纹理 REPEAT 环绕，避免时间变大掉精度）
        vec2 tc = vUv + uShiftStatic + fract(uShiftRate * uTime);
        vec4 c = texture2D(map, tc);
        float a = texture2D(mask, vUv1).a;
        gl_FragColor = vec4(c.rgb * uTint, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}


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
