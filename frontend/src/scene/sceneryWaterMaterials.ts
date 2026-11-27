import * as THREE from 'three'
import type { ShaderMaterial, Texture } from 'three'
import type { GltfSceneMaterial } from './sceneryMaterialTypes.js'
import { sunUniforms } from './sceneryLightingMaterials.js'

export interface MapBorderVisual {
  color?: number[]
  height?: number
  minZ?: number
  maxZ?: number
  zFadeWidth?: number
  zOffset?: number
  distanceFadeEnabled?: boolean
  distanceFadeNear?: number
  distanceFadeFar?: number
  distanceNearFarSq?: number[]
  distanceFadeEnabledRo?: boolean
  rect?: number[] | null
}

export function makeMapBorderMaterial(_m: GltfSceneMaterial, v: MapBorderVisual): ShaderMaterial {
  const color = Array.isArray(v.color) && v.color.length >= 3 ? v.color : [1, 0, 0, 1];
  const num = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  const nearSq = Array.isArray(v.distanceNearFarSq) && v.distanceNearFarSq.length === 2
    ? v.distanceNearFarSq : [90000, 160000];
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(color[0], color[1], color[2]) },
      uAlpha: { value: num(color[3], 1.0) },
      uMinZ: { value: num(v.minZ, -100) },
      uMaxZ: { value: num(v.maxZ, 100) },
      uFade: { value: num(v.zFadeWidth, 0) },
      uZOffset: { value: num(v.zOffset, 0) },
      uFadeEnable: { value: (v.distanceFadeEnabledRo || v.distanceFadeEnabled) ? 1 : 0 },
      uNearSq: { value: nearSq[0] },
      uFarSq: { value: nearSq[1] },
      uTime: { value: 0 },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 wp = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        wp = modelMatrix * wp;
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform float uMinZ;
      uniform float uMaxZ;
      uniform float uFade;
      uniform float uZOffset;
      uniform float uFadeEnable;
      uniform float uNearSq;
      uniform float uFarSq;
      uniform float uTime;
      varying vec3 vWorld;
      void main() {
        #include <logdepthbuf_fragment>
        // 场景系 y = 客户端 z（mapScenery 的 qFrame 把客户端 z 旋到 y）
        float z = vWorld.y - uZOffset;
        float a = uAlpha;
        if (uMaxZ > uMinZ && uFade > 0.0) {
          a *= smoothstep(uMinZ - uFade, uMinZ, z);
          a *= 1.0 - smoothstep(uMaxZ, uMaxZ + uFade, z);
        }
        if (uFadeEnable > 0.5) {
          // 客户端 distanceFade 的 near/far 平方阈值相对**相机**；按世界原点算会让
          // 地图四角/边缘在相机靠近时仍被裁掉、而中心区在远处永不淡出。
          vec2 rel = vWorld.xz - cameraPosition.xz;
          float d2 = dot(rel, rel);
          a *= 1.0 - smoothstep(uNearSq, uFarSq, d2);
        }
        if (a <= 0.001) discard;
        // 展示端高亮：作者色向亮红提亮 + 轻微呼吸（不改变几何/位置语义）
        vec3 hi = mix(uColor, vec3(1.0, 0.18, 0.12), 0.55) * 1.15;
        a *= 0.82 + 0.18 * sin(uTime * 2.4);
        gl_FragColor = vec4(hi, min(a, 1.0));
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export interface WaterProps {
  normal0Scale?: number
  normal1Scale?: number
  normal0ShiftPerSecond?: number[]
  normal1ShiftPerSecond?: number[]
  fresnelBias?: number
  fresnelPow?: number
  reflectionTintColor?: number[]
  reflectionDistortion?: number
  distortionFallSquareDist?: number
  inGlossiness?: number
  inSpecularity?: number
  reflectanceColor?: number[]
  [key: string]: unknown
}

export interface WaterCoastField {
  heightTex?: Texture | null
  mapSpan?: number
  near?: number
  far?: number
  depthUlp?: number
  coastFade?: number
}

export interface WroWaterUv {
  texCoordTransform0?: number[] | null
  inputTangent?: number[] | null
}

const EMPTY_REFLECTION_TEX = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
EMPTY_REFLECTION_TEX.needsUpdate = true

export function makeWaterMaterial(m: GltfSceneMaterial, { normalTex, cubeTex, props, coast = null, wro = null }: {
  normalTex?: Texture | null
  cubeTex?: Texture | null
  props?: WaterProps | null
  coast?: WaterCoastField | null
  wro?: WroWaterUv | null
}): ShaderMaterial {
  const map = m.map || null;
  if (map) { map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true; }
  if (normalTex) { normalTex.colorSpace = THREE.NoColorSpace; normalTex.needsUpdate = true; }
  if (cubeTex) { cubeTex.colorSpace = THREE.NoColorSpace; cubeTex.needsUpdate = true; }
  const p = props || {};
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const v2 = (v: unknown, d: number[]): THREE.Vector2 => new THREE.Vector2(...((Array.isArray(v) && v.length === 2 ? v : d) as number[]));
  const waterMat = new THREE.ShaderMaterial({
    uniforms: {
      normalmap: { value: normalTex || map },
      cubemap: { value: cubeTex || map },
      uTime: { value: 0 },
      uN0Scale: { value: num(p.normal0Scale, 1) },
      uN1Scale: { value: num(p.normal1Scale, 1) },
      uShift0: { value: v2(p.normal0ShiftPerSecond, [0, 0]) },
      uShift1: { value: v2(p.normal1ShiftPerSecond, [0, 0]) },
      uFresnelBias: { value: num(p.fresnelBias, 0) },
      uFresnelPow: { value: num(p.fresnelPow, 0) },
      uReflTint: { value: new THREE.Vector3(...((Array.isArray(p.reflectionTintColor) ? p.reflectionTintColor : [1, 1, 1]) as number[])) },
      uReflectionTex: { value: EMPTY_REFLECTION_TEX },
      uReflectionMatrix: { value: new THREE.Matrix4() },
      uUseReflection: { value: 0 },
      uReflectionDistortion: { value: num(p.reflectionDistortion, 0.04) },
      uDistFallSq: { value: num(p.distortionFallSquareDist, 100) },
      uSunDirScene: sunUniforms.uSunDirScene,
      uSunSpecColor: sunUniforms.uSunSpecColor,
      uGlossiness: { value: num(p.inGlossiness, 0.5) },
      uSpecularity: { value: num(p.inSpecularity, 0.5) },
      uReflectanceColor: { value: new THREE.Vector3(...((Array.isArray(p.reflectanceColor) && p.reflectanceColor.length >= 3 ? p.reflectanceColor : [0.5, 0.5, 0.5]) as number[])) },
      uHeightmap: { value: (coast && coast.heightTex) || map || normalTex || null },
      uHasHeightmap: { value: coast && coast.heightTex ? 1 : 0 },
      uMapSpan: { value: coast && typeof coast.mapSpan === 'number' && Number.isFinite(coast.mapSpan) ? coast.mapSpan : 600 },
      uHmTexel: { value: (() => {
        const img = coast?.heightTex?.image as { width?: number } | null | undefined
        return img && typeof img.width === 'number' && img.width > 0 ? 1 / img.width : 0
      })() },
      uNear: { value: coast && typeof coast.near === 'number' && Number.isFinite(coast.near) ? coast.near : 0.5 },
      uFar: { value: coast && typeof coast.far === 'number' && Number.isFinite(coast.far) ? coast.far : 4000 },
      uMinAlpha: { value: 0.32 },
      uCoastFade: { value: coast && typeof coast.coastFade === 'number' && Number.isFinite(coast.coastFade) ? coast.coastFade : 0.35 },
      uDepthUlp: { value: coast && typeof coast.depthUlp === 'number' && Number.isFinite(coast.depthUlp) ? coast.depthUlp : 2 / 16777216 },
      uTct: { value: new THREE.Vector4(...((Array.isArray(wro?.texCoordTransform0) && wro.texCoordTransform0.length === 4 ? wro.texCoordTransform0 : [1, 0, 0, 1]) as number[])) },
      uTangentLocal: { value: new THREE.Vector3(...((Array.isArray(wro?.inputTangent) && wro.inputTangent.length === 3 ? wro.inputTangent : [1, 0, 0]) as number[])) },
    },
    defines: (wro && Array.isArray(wro.texCoordTransform0) && wro.texCoordTransform0.length === 4) ? { USE_WRO_UV: 1 } : {},
    vertexShader: `
      // <common> 必须先于 logdepthbuf_vertex（isPerspectiveMatrix 定义在 common 里）
      #include <common>
      varying vec2 vUv;
      varying vec3 vWorldP;
      varying vec3 vWorldN;
      varying vec4 vClip;   // 镜像相机投影坐标（纹理投影矩阵，含 0.5 bias）
      // 反射矩阵在**所有**水面变体里都要声明：vClip 无条件计算（W1 引入时误放进
      // USE_WRO_UV 分支 ⇒ 非 WRO 水面程序编译失败，uReflectionMatrix undeclared）。
      uniform mat4 uReflectionMatrix;
      #ifdef USE_WRO_UV
      // 客户端 PIXEL_LIT && !REAL_REFLECTION 分支的常量 TBN（water-vp.sl:249-255 同构）：
      // N = (0,0,1) 局部 → 世界，T = inputTangent → 世界，B = cross(N, T)
      varying mat3 vTbnW;
      uniform vec4 uTct;
      uniform vec3 uTangentLocal;
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
        // 反射图坐标 = bias × 镜像相机 VP × 世界坐标（texture2DProj 口径）
        vClip = uReflectionMatrix * wp;
        #ifdef USE_WRO_UV
        // WaterRenderObject：客户端不读网格 UV，UV 由局部位置 × texCoordTransform0 推导
        vUv = vec2(dot(position.xy, uTct.xz), dot(position.xy, uTct.yw));
        vec3 nW = normalize(mat3(im) * vec3(0.0, 0.0, 1.0));
        vec3 tW = normalize(mat3(im) * uTangentLocal);
        vTbnW = mat3(tW, cross(nW, tW), nW);
        #else
        vUv = uv;
        #endif
        vWorldP = wp.xyz;
        vWorldN = normalize(mat3(im) * normal);
      }`,
    fragmentShader: `
      uniform sampler2D normalmap;
      uniform sampler2D cubemap;
      uniform sampler2D uReflectionTex;
      uniform float uUseReflection;
      uniform float uReflectionDistortion;
      uniform float uDistFallSq;
      uniform vec3 uSunDirScene;
      uniform vec3 uSunSpecColor;
      uniform float uGlossiness;
      uniform float uSpecularity;
      uniform vec3 uReflectanceColor;
      uniform float uTime;
      uniform float uN0Scale;
      uniform float uN1Scale;
      uniform vec2 uShift0;
      uniform vec2 uShift1;
      uniform float uFresnelBias;
      uniform float uFresnelPow;
      uniform float uMinAlpha;
      uniform float uCoastFade;
      uniform vec3 uReflTint;
      uniform sampler2D uHeightmap;
      uniform float uHasHeightmap;
      uniform float uMapSpan;
      uniform float uHmTexel;
      uniform float uNear;
      uniform float uFar;
      uniform float uDepthUlp;
      varying vec2 vUv;
      varying vec3 vWorldP;
      varying vec3 vWorldN;
      varying vec4 vClip;
      #ifdef USE_WRO_UV
      varying mat3 vTbnW;
      #endif
      #include <logdepthbuf_pars_fragment>
      vec2 envEquirectUv(vec3 d) {   // 与 B2 同式（内嵌图 flipY=false ⇒ v=0 = 天）
        return vec2(atan(d.z, d.x) * 0.15915494309189535 + 0.5,
                    0.5 - asin(clamp(d.y, -1.0, 1.0)) * 0.3183098861837907);
      }
      // 片元导数建切线基（Christian Schüler 的 cotangent frame）
      mat3 cotangentFrame(vec3 N, vec3 p, vec2 uv) {
        vec3 dp1 = dFdx(p), dp2 = dFdy(p);
        vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
        vec3 dp2perp = cross(dp2, N);
        vec3 dp1perp = cross(N, dp1);
        vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
        vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
        float invmax = inversesqrt(max(dot(T, T), dot(B, B)));
        return mat3(T * invmax, B * invmax, N);
      }
      void main() {
        #include <logdepthbuf_fragment>
        // 两层法线图（层 1 用 45° 旋转 UV），时间位移取小数部分（客户端 frac(shift×t)）
        vec2 uv0 = vUv * uN0Scale + fract(uShift0 * uTime);
        vec2 uv1 = vec2(vUv.x + vUv.y, vUv.y - vUv.x) * uN1Scale + fract(uShift1 * uTime);
        vec3 n0 = texture2D(normalmap, uv0).rgb;
        vec3 n1 = texture2D(normalmap, uv1).rgb;
        #ifdef USE_WRO_UV
        // 客户端常量 TBN（作者切线基决定波浪条纹朝向）；cotangent 导数基只用于 Mesh 类水面
        vec3 N = normalize(vTbnW * normalize(n0 + n1 - vec3(1.0)));   // UDN 相加
        #else
        mat3 tbn = cotangentFrame(normalize(vWorldN), vWorldP, vUv);
        vec3 N = normalize(tbn * normalize(n0 + n1 - vec3(1.0)));   // UDN 相加
        #endif
        // 远处法线压平：法线图平铺频率高，远距离/掠射下 mip 混叠会让菲涅尔与反射
        // 逐帧闪（2026-11-17 用户"较远处移动视角水面闪烁"）。闪烁的真正根因是重复水面
        // 层双混合（已由 waterMerge 去重修复），法线压平只作轻微抗混叠：俯视全景保留
        // ~80% 作者法线，波纹滚动清晰可见；>900m 最多压到 35%。
        float camDist = length(vWorldP - cameraPosition);
        float flatK = 0.35 * smoothstep(300.0, 900.0, camDist);
        N = normalize(mix(N, normalize(vWorldN), flatK));
        vec3 V = normalize(vWorldP - cameraPosition);               // 相机→片元
        float lambertFactor = max(dot(-V, N), 0.0);
        float fresnel = uFresnelBias + (1.0 - uFresnelBias) * pow(1.0 - lambertFactor, uFresnelPow);
        vec3 R = reflect(V, N);
        R.y = abs(R.y);                                             // 防穿透水面
        vec3 refl = texture2D(cubemap, envEquirectUv(R)).rgb * uReflTint;
        // HIGH/ULTRA：动态平面反射（客户端 REAL_REFLECTION 的 MEDIUM→HIGH 升级）。
        // 反射 RT 用镜像相机渲染，水片元按其主相机屏幕坐标采样；N 扰动带距离衰减
        // （客户端 reflectionDistortion / distortionFallSquareDist 同构）。
        if (uUseReflection > 0.5) {
          vec2 suv = vClip.xy / vClip.w;
          float reflFall = 1.0 / (1.0 + camDist * camDist / max(uDistFallSq, 1.0));
          vec2 ruv = suv + N.xz * uReflectionDistortion * reflFall;
          vec3 dyn = texture2D(uReflectionTex, clamp(ruv, vec2(0.001), vec2(0.999))).rgb * uReflTint;
          refl = mix(refl, dyn, 0.92);
          // 太阳高光（客户端 water-fp.sl HIGH/ULTRA 的 SPECULAR 分支）：
          // BlinnPhong(NdotH, glossiness, NdotL×specularity)，Fresnel Schlick( reflectanceColor )
          vec3 L = normalize(-uSunDirScene);              // 指向太阳（uniform 是传播方向）
          float NdotV = max(dot(N, -V), 0.0);
          vec3 F = uReflectanceColor + (1.0 - uReflectanceColor) * pow(1.0 - NdotV, 5.0);
          float NdotL = max(dot(N, L), 0.0);
          vec3 H = normalize(L - V);
          float NdotH = max(dot(N, H), 0.0);
          float glossPower = pow(5000.0, uGlossiness);
          float specTerm = pow(NdotH, glossPower) * (glossPower + 2.0) / 8.0;
          refl += uSunSpecColor * specTerm * (NdotL * uSpecularity * F);
        }
        // 海岸线（客户端 water-fp.sl 的 coastLine，推导见 makeWaterMaterial 注释）：
        // 背后表面（地形）与水面沿视线的相对深度差；岸线带内 → 0 ⇒ 水面贡献消失，
        // 于是岸线处既没有"水面 vs 地形"的硬边，也不受深度抢胜的逐像素翻转影响。
        float coastLine = 1.0;
        if (uHasHeightmap > 0.5) {
          float terrainY = texture2D(uHeightmap, vWorldP.xz / uMapSpan + 0.5 + 0.5 * uHmTexel).r;
          vec3 toCam = vWorldP - cameraPosition;
          float zlen = max(length(toCam), 1e-3);
          float dzWorld = vWorldP.y - terrainY;
          float dzAlong = dzWorld / max(abs(toCam.y) / zlen, 1e-3);   // 高差 → 沿视线差
          float dNdcZ = (2.0 * uFar * uNear / ((uFar - uNear) * zlen * zlen)) * dzAlong;
          float byDepth = clamp(dNdcZ / (2.0 * uDepthUlp), 0.0, 1.0);
          // 世界空间最小淡出带：粗高度场（带限）+ 固定米制过渡，远处不随视距抖动。
          // 取 min 表示"两套判据都允许才显示水"——深水不受影响，岸线由稳定项兜底。
          float byWorld = smoothstep(0.0, uCoastFade, dzWorld);
          coastLine = min(byDepth, byWorld);
        }
        float alpha = max(clamp(fresnel, 0.0, 1.0), uMinAlpha) * coastLine;   // 菲涅尔(含俯视下限) × 海岸线
        gl_FragColor = vec4(refl, clamp(alpha, 0.0, 1.0));
      }`,
    transparent: true,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.DoubleSide,
  });
  waterMat.userData.water = true;
  return waterMat;
}
