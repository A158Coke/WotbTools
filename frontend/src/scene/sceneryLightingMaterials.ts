import * as THREE from 'three'
import type { ShaderMaterial, Texture } from 'three'
import type { GltfSceneMaterial } from './sceneryMaterialTypes.js'
export const sunUniforms: {
  uSunDirScene: { value: THREE.Vector3 }
  uSunColor: { value: THREE.Vector3 }
  uSunSpecColor: { value: THREE.Vector3 }
} = {
  uSunDirScene: { value: new THREE.Vector3(0, -1, 0) },
  uSunColor: { value: new THREE.Vector3(1, 1, 1) },
  uSunSpecColor: { value: new THREE.Vector3(1, 1, 1) },
};

export interface EnvReflectionProps {
  reflectionSpecParamGloss?: number
  reflectionMetalFresnelReflectance?: number[]
  reflectionSpecular?: number
  reflectionBrightenEnvMap?: number
  reflectionLerpEnvMap?: number
  reflectionAddDiffuse?: number
  reflectionMaskMultiplier?: number
  reflectionMultLightmap?: number
  cubemapIntensity?: number[]
  [key: string]: unknown
}

export interface EnvReflectionInput {
  maskTex: Texture
  cubeTex: Texture
  props: EnvReflectionProps
}

export interface DetailLayerInput {
  tex: Texture
  scale?: ArrayLike<number> | null
}

export function makeLightmappedMaterial(m: GltfSceneMaterial, atlasTex: Texture | null | undefined, env: EnvReflectionInput | null, detail: DetailLayerInput | null): ShaderMaterial {
  const map = m.map || null;
  if (map) { map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true; }
  if (atlasTex) { atlasTex.colorSpace = THREE.NoColorSpace; atlasTex.needsUpdate = true; }
  if (detail && detail.tex) { detail.tex.colorSpace = THREE.NoColorSpace; detail.tex.needsUpdate = true; }
  const softAlpha = !!(m.userData && m.userData.alphaBlend);
  const cut = softAlpha ? 0 : ((m.alphaTest > 0 || (m.transparent && (m.opacity ?? 1) >= 0.99))
    ? Math.max(m.alphaTest || 0, 0.33) : 0);
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const vec3Of = (v: unknown, d: number[]): THREE.Vector3 =>
    new THREE.Vector3(...((Array.isArray(v) && v.length === 3 ? v : d) as number[]));
  return new THREE.ShaderMaterial({
    uniforms: Object.assign(
      env ? {
        ...sunUniforms,
        envMask: { value: env.maskTex },
        envCube: { value: env.cubeTex },
        uEnvOn: { value: 1 },
        uEnvGloss: { value: num(env.props.reflectionSpecParamGloss, 0.45) },
        uEnvFresnel: { value: vec3Of(env.props.reflectionMetalFresnelReflectance, [0.5, 0.55, 0.3]) },
        uEnvSpecular: { value: num(env.props.reflectionSpecular, 1.0) },
        uEnvBrighten: { value: num(env.props.reflectionBrightenEnvMap, 2.8) },
        uEnvLerp: { value: num(env.props.reflectionLerpEnvMap, 0.5) },
        uEnvAddDiffuse: { value: num(env.props.reflectionAddDiffuse, 0.0) },
        uEnvMaskMul: { value: num(env.props.reflectionMaskMultiplier, 100.0) },
        uEnvMultLM: { value: num(env.props.reflectionMultLightmap, 2.0) },
        uEnvCubeIntensity: { value: vec3Of(env.props.cubemapIntensity, [1, 1, 1]) },
      } : {},
      detail && detail.tex ? {
        uDetailTex: { value: detail.tex },
        uDetailScale: { value: new THREE.Vector2(
          num(detail.scale?.[0], 1),
          num(detail.scale?.[1], 1)) },
      } : {},
      {
        map: { value: map },
        lightmap: { value: atlasTex || map },
        uTint: { value: m.color ? m.color.clone() : new THREE.Color(0xffffff) },
        uAlphaCut: { value: cut },
        uOpacity: { value: m.opacity ?? 1 },
      }),
    vertexShader: `
      attribute vec2 uv1;    // 光照图 UV（客户端 texcoord1）
      attribute vec4 aLm;    // 逐实例 [sx, sy, ox, oy]（InstancedBufferAttribute）
      // <common> 必须先于 logdepthbuf_vertex（isPerspectiveMatrix 定义在 common 里）
      #include <common>
      varying vec2 vUv;
      varying vec2 vLmUv;
      varying vec3 vWorldN;
      varying vec3 vWorldP;
#ifdef MATERIAL_DETAIL
      uniform vec2 uDetailScale;
      varying vec2 vDetailUv;
#endif
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
        // 世界位置/法线（环境反射的反射向量用世界系，客户端 materials-vp.sl:274-276 同式）：
        // ⚠️ 声明了 varying 就必须真的赋值——只写不声明/只声明不写都会让整材质编译失败，
        // 页面上只表现为"物体不渲染"。守卫测试锁这两条（scene/sceneryMaterials.*.test.js）。
        vWorldP = wp.xyz;
        vWorldN = normalize(mat3(im) * normal);
        vUv = uv;
#ifdef MATERIAL_DETAIL
        vDetailUv = uv * uDetailScale;   // 客户端 varDetailTexCoord = uv0 × detailTileCoordScale
#endif
        // 客户端 varTexCoord1 = uvScale*texcoord1 + uvOffset；非合批（无 aLm）时退回原始
        // UV1——调用方保证只在带 aLm 的批次上使用本材质（否则会采到图集错误区域）
        #ifdef USE_INSTANCING
        vLmUv = uv1 * aLm.xy + aLm.zw;
        #else
        vLmUv = uv1;
        #endif
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform sampler2D lightmap;
      uniform vec3 uTint;
      uniform float uAlphaCut;
      uniform float uOpacity;
#ifdef ENV_REFLECTION
      uniform sampler2D envMask;
      uniform sampler2D envCube;
      uniform float uEnvOn;
      uniform float uEnvGloss;
      uniform vec3 uEnvFresnel;
      uniform float uEnvSpecular;
      uniform float uEnvBrighten;
      uniform float uEnvLerp;
      uniform float uEnvAddDiffuse;
      uniform float uEnvMaskMul;
      uniform float uEnvMultLM;
      uniform vec3 uEnvCubeIntensity;
      uniform vec3 uSunDirScene;   // 阳光传播方向（场景系）
      uniform vec3 uSunColor;      // 客户端 lightColor0 = color × intensity
      // 等距柱状采样：内嵌图**不翻**（本仓生成图）、glTF flipY=false ⇒ v=0 = 文件首行 = 天
      vec2 envEquirectUv(vec3 d) {
        return vec2(atan(d.z, d.x) * 0.15915494309189535 + 0.5,
                    0.5 - asin(clamp(d.y, -1.0, 1.0)) * 0.3183098861837907);
      }
#endif
#ifdef MATERIAL_DETAIL
      uniform sampler2D uDetailTex;
      varying vec2 vDetailUv;
#endif
      varying vec2 vUv;
      varying vec2 vLmUv;
      varying vec3 vWorldN;
      varying vec3 vWorldP;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec4 c = texture2D(map, vUv);
        if (uAlphaCut > 0.0 && c.a < uAlphaCut) discard;   // 镂空语义（MASK/伪透明）
        vec3 lm = texture2D(lightmap, vLmUv).rgb;
        vec3 color = c.rgb * uTint * lm * 2.0;
#ifdef ENV_REFLECTION
        if (uEnvOn > 0.5) {
          // 客户端 materials-fp.sl:320-338 的环境反射块（逐项对应）
          float envMaskValue = texture2D(envMask, vUv).a;
          float maskScaled = min(envMaskValue * uEnvMaskMul, 1.0);
          vec3 N = normalize(vWorldN);
          vec3 V = normalize(vWorldP - cameraPosition);        // 相机→片元（客户端 wsView 同向）
          vec3 R = reflect(V, N);
          float NdotV = max(dot(N, -V), 0.0);
          vec3 F = uEnvFresnel + (1.0 - uEnvFresnel) * pow(1.0 - NdotV, 5.0);  // FresnelShlickVec3
          vec3 envMult = F * (uEnvBrighten / 3.0);             // 客户端 (fx+fy+fz)*0.33*brighten
          vec3 L = normalize(-uSunDirScene);                   // 指向光源
          vec3 H = normalize(L - V);
          float NdotL = max(dot(N, L), 0.0);
          float NdotH = max(dot(N, H), 0.0);
          float glossPower = pow(5000.0, uEnvGloss * envMaskValue);   // lighting.slh BlinnPhong
          float specTerm = pow(NdotH, glossPower) * (glossPower + 2.0) / 8.0;
          // 客户端 varSpecularColor.xyz = NdotL × reflectionSpecular × fresnel × (1.0/LdotH*LdotH)
          // ——末因子字面为 1（疑客户端笔误），按字面省去
          vec3 specular = specTerm * uSunColor * (NdotL * uEnvSpecular * F);
          vec3 lightenLM = clamp(lm * uEnvMultLM, 0.0, 1.0);   // MATERIAL_LIGHTMAP && VIEW_DIFFUSE
          vec3 refl = texture2D(envCube, envEquirectUv(R)).rgb * uEnvCubeIntensity
                    * envMult * lightenLM * maskScaled;
          color = mix(color, color * uEnvAddDiffuse + refl, min(envMaskValue * uEnvLerp, 1.0))
                + specular * maskScaled;
        }
#endif
#ifdef MATERIAL_DETAIL
        // 客户端 DRAW PHASE 末尾（materials-fp.sl:347-349）：color *= detail × 2.0
        color *= texture2D(uDetailTex, vDetailUv).rgb * 2.0;
#endif
#ifdef ALPHA_BLEND
        gl_FragColor = vec4(color, c.a * uOpacity);
#else
        gl_FragColor = vec4(color, 1.0);
#endif
      }`,
    defines: Object.assign(env ? { ENV_REFLECTION: 1 } : {},
                           detail && detail.tex ? { MATERIAL_DETAIL: 1 } : {},
                           softAlpha ? { ALPHA_BLEND: 1 } : {}),
    side: THREE.DoubleSide,
    transparent: softAlpha,
    depthWrite: !softAlpha,
  });
}

export interface DecalMaterialOpts {
  separateLm?: unknown
  lmAdjust?: number[] | null
  globalTint?: boolean
}

export function makeDecalMaterial(m: GltfSceneMaterial, cmTex: Texture | null | undefined, lmTex: Texture | null | undefined, opts: DecalMaterialOpts = {}): ShaderMaterial {
  const map = m.map || null;
  if (map) { map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true; }
  if (cmTex) { cmTex.colorSpace = THREE.NoColorSpace; cmTex.needsUpdate = true; }
  if (lmTex) { lmTex.colorSpace = THREE.NoColorSpace; lmTex.needsUpdate = true; }
  const softAlpha = !!(m.userData && m.userData.alphaBlend);
  const cut = softAlpha ? 0 : ((m.alphaTest > 0 || (m.transparent && (m.opacity ?? 1) >= 0.99))
    ? Math.max(m.alphaTest || 0, 0.33) : 0);
  const adj = Array.isArray(opts.lmAdjust) && opts.lmAdjust.length === 3 ? opts.lmAdjust : null;
  const useAdj = !!(adj && opts.globalTint);
  const uniforms: Record<string, THREE.IUniform> = {
    map: { value: map },
    colormap: { value: cmTex || map },
    colormapLm: { value: lmTex || cmTex || map },
    uTint: { value: m.color ? m.color.clone() : new THREE.Color(0xffffff) },
    uAlphaCut: { value: cut },
    uOpacity: { value: m.opacity ?? 1 },
  }
  if (useAdj) uniforms.uLmAdjust = { value: new THREE.Vector3(adj[0], adj[1], adj[2]) }
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      attribute vec2 uv1;    // 贴花 UV（客户端 texcoord1，colormap 空间）
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
        vec4 wp = im * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
        vUv = uv;
        vUv1 = uv1;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform sampler2D colormap;
      uniform sampler2D colormapLm;
      uniform vec3 uTint;
      uniform float uAlphaCut;
      uniform float uOpacity;
#ifdef DECAL_LM_ADJUST
      uniform vec3 uLmAdjust;   // materialLightmapAdjustment = [brightness, contrast, gamma]
#endif
      varying vec2 vUv;
      varying vec2 vUv1;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec4 base = texture2D(map, vUv);
        if (uAlphaCut > 0.0 && base.a < uAlphaCut) discard;   // 镂空语义（MASK/伪透明）
        vec3 decalRgb = texture2D(colormap, vUv1).rgb;
#ifdef DECAL_LM_ADJUST
        decalRgb = pow(decalRgb, vec3(uLmAdjust.z));
        decalRgb = (decalRgb - 0.5) * uLmAdjust.y + 0.5;
        decalRgb += uLmAdjust.x;
#endif
        vec3 shadowColor = decalRgb;
#ifdef DECAL_SEPARATE_LM
        shadowColor *= texture2D(colormapLm, vUv1).r;   // colormap 的 alpha 通道（本包 = lm.webp 的 R）
#endif
#ifdef ALPHA_BLEND
        gl_FragColor = vec4(base.rgb * uTint * shadowColor * 2.0, base.a * uOpacity);
#else
        gl_FragColor = vec4(base.rgb * uTint * shadowColor * 2.0, 1.0);
#endif
      }`,
    defines: Object.assign({},
                           lmTex && opts.separateLm ? { DECAL_SEPARATE_LM: 1 } : {},
                           useAdj ? { DECAL_LM_ADJUST: 1 } : {},
                           softAlpha ? { ALPHA_BLEND: 1 } : {}),
    side: THREE.DoubleSide,
    transparent: softAlpha,
    depthWrite: !softAlpha,
  });
}
