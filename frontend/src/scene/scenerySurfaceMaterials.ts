import * as THREE from 'three'
import type { MeshLambertMaterial, MeshStandardMaterial, ShaderMaterial, Texture } from 'three'
import type { GltfSceneMaterial } from './sceneryMaterialTypes.js'

export function makeBlendByAngleMaterial(m: GltfSceneMaterial, props: { bounds?: number[]; power?: number; inversion?: number } | null | undefined): ShaderMaterial {
  const map = m.map || null;
  if (map) { map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true; }
  const p = props || {};
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const b = Array.isArray(p.bounds) && p.bounds.length === 2 ? p.bounds : [0, 1];
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      uTint: { value: m.color ? m.color.clone() : new THREE.Color(0xffffff) },
      uBounds: { value: new THREE.Vector2(b[0], b[1]) },
      uPower: { value: num(p.power, 1) },
      uInversion: { value: num(p.inversion, 0) },
    },
    vertexShader: `
      // <common> 必须先于 logdepthbuf_vertex（isPerspectiveMatrix 定义在 common 里）
      #include <common>
      varying vec2 vUv;
      varying vec3 vWorldP;
      varying vec3 vWorldN;
      #include <logdepthbuf_pars_vertex>
      void main() {
        #ifdef USE_INSTANCING
        mat4 im = modelMatrix * instanceMatrix;
        #else
        mat4 im = modelMatrix;
        #endif
        vec4 wp = im * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
        vUv = uv;
        vWorldP = wp.xyz;
        vWorldN = normalize(mat3(im) * normal);
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 uTint;
      uniform vec2 uBounds;
      uniform float uPower;
      uniform float uInversion;
      varying vec2 vUv;
      varying vec3 vWorldP;
      varying vec3 vWorldN;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec4 c = texture2D(map, vUv) * vec4(uTint, 1.0);
        vec3 N = normalize(vWorldN);
        vec3 V = normalize(vWorldP - cameraPosition);   // 相机→片元（客户端 wsView 同向）
        float VdotN = abs(dot(V, N));                   // V、N 已归一 ⇒ |cos∠|
        VdotN = mix(VdotN, 1.0 - VdotN, uInversion);
        float ang = clamp((VdotN - uBounds.x) / max(uBounds.y - uBounds.x, 1e-6), 0.0, 1.0);
        gl_FragColor = vec4(c.rgb, c.a * pow(ang, uPower));
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

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
  const prevKey = sm.customProgramCacheKey;
  sm.customProgramCacheKey = () => {
    const base = (typeof prevKey === 'function') ? prevKey.call(sm) : '';
    return base + '|tank-noambient';
  };
  sm.needsUpdate = true;
  return m;
}
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

