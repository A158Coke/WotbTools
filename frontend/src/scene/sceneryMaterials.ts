/**
 * 场景 GLB 材质管线 SSOT：playbackScene（3D 运行时）与 bake-ground-overhead.mjs
 * （俯视烘焙页）共用同一份材质实现——俯视烘焙的观感基准就是 3D 档画面，材质
 * 重实现路线已两次偏离（灰块/采样翻车），故提取为单源模块。
 *
 * 从 playbackScene.js 原样平移（2026-10-07，逐字未改）；守卫测试
 * sceneryMaterials.*.test.js 锁定行为，改这里必须同步过测。
 */
import * as THREE from 'three'
import type { Mesh, MeshStandardMaterial, Object3D, ShaderMaterial, Texture } from 'three'

/**
 * GLTFLoader 解析出的场景材质（extras 由 assignExtrasToUserData 平铺进 userData）。
 * 同 name+map 的 MASK 与 OPAQUE 只靠 alphaTest/transparent 区分（GLTFLoader 不暴露 alphaMode）。
 */
export type GltfSceneMaterial = MeshStandardMaterial & { alphaMode?: string }

// 场景材质实例缓存（键 = 材质身份指纹，见 playbackScene 的 convMat）。
// 生命周期：3D 侧 teardown 时 clearSceneryMatCache()（勿复用已 dispose 实例）；
// 烘焙页为一次性进程，无需清理。
const sceneryMatCache = new Map<string, THREE.Material>();

/**
 * 植被视野穿透：相机这个半径（米）内的叶片不绘制，0 = 关闭。所有植被材质共享同一个
 * uniform 对象，切换不用遍历场景；只在 fragment 里比一次距离，不增加 draw call。
 */
export const foliageClip: { value: number } = { value: 0 }

/** 材质 → 可枚举属性视图（鸭子扫描边界；three 材质子类的自有属性逐类各异）。 */
export function duckProps(src: unknown): Record<string, { isTexture?: unknown } | undefined> {
  return src as Record<string, { isTexture?: unknown } | undefined>
}

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

// 叶卡 alpha 裁切阈值。客户端 AlphaBlend 软边缘 + 0.05 低阈值会让近透明像素仍写
// 深度（叶片互相遮挡 → 破洞/闪烁）；提到 MASK 量级消除，并保留软边缘。
const CARD_ALPHA_CUT = 0.33;
// 场景 Lambert 材质的曝光修整（只作用于 convMat 建出的场景材质；代理车/GLB 车模不受影响）。
// 这套光照是按坦克 GLB 调的，场景降级到 Lambert 后朝上面过曝；系数 <1 压回过曝而不动光照。
export const SCENERY_LAMBERT_EXPOSURE = 0.75;
// 水体判定（GLB mesh/材质名启发式：seaplane/water/fountain/lake/river）
export const isWaterName = (n: string | null | undefined): boolean => /water|sea|lake|river|fountain/i.test(n || '');

export function makeBillboardMaterial(m: GltfSceneMaterial): ShaderMaterial {
  // GLB 的 material.extras 由 GLTFLoader 的 assignExtrasToUserData 用 Object.assign
  // 平铺进 userData（不是嵌在 userData.extras 下）——写成 userData.extras.occMean 会
  // 恒取到 undefined，退化成 0.8 固定值，使各材质"按自身贴图均值归一化遮挡"的标定失效。
  const occRaw = m.userData && Number(m.userData.occMean);
  // occMean=1.0 哨兵（导出器 2026-10-07 口径）：净倍率 = vOcc × SH 字面 RGB、
  // 乘积钳 2.0——与客户端 speedtree-materials-fp 同式（albedo × varVertexColor
  // × SH(L0)）。occMean 为其它值 = 旧包：保留「均值归一化 + 1.35 钳」旧方程。
  // 旧方程在深色叶贴图上把 ×1.575 压平成 ×1.35 并抹掉叶簇内 AO 对比（发灰发平，
  // erlenberg 实测报障）；高亮雪地贴图被 tone mapping 掩盖 (+9%) 故长期未显形。
  const newPack = occRaw === 1;
  const occMean = newPack ? 1 : (Number.isFinite(occRaw) && occRaw > 0 ? occRaw : 0.8);
  // 每实体的 SH(L0) 染色：导出器写进 baseColorFactor（RGB 三通道字面值——
  // √π 灰 1.7725，或 karelia (0.37,0.50,0.50) 冷调黄昏等真实每树环境）。
  const c0 = m.color;
  const factorOk = c0 && [c0.r, c0.g, c0.b].every((v) => Number.isFinite(v) && v > 0);
  const shTint = factorOk
    ? new THREE.Vector3(c0.r, c0.g, c0.b)
    : (newPack ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(1.77, 1.77, 1.77));
  // 客户端着色器为伽马空间直采直写：关闭 sRGB 纹理解码（自定义着色器无输出
  // 重编码，sRGB 采样得到的线性值直出会整体发黑）
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
    // 用 discard 裁切走不透明管线（transparent=false）：叶卡之间排序无关，
    // 消除互遮挡闪烁（此前 transparent=true + depthWrite=true 二者冲突），
    // 同时省掉透明通道的排序开销
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

// ST| 静态几何（gen2 刚体固定叶/树枝、gen1 树干）：与叶卡同族客户端材质
// speedtree-materials-fp = albedo × varVertexColor × SH(L0)，伽马空间直采直写
// （无光照、无 tone map、无输出重编码）、无 _corner 展开。此前用 MeshBasicMaterial
// 承载：sRGB 解码→线性乘→sRGB 编码的往返把 SH 实际压成 SH^(1/2.2)，与 billboard
// 叶（直通）差约 28% → 同树叶片双色（2026-10-07 erlenberg 实测报障）。
// toneMapped=false 只去掉出屏曲线与曝光、去不掉 sRGB 输出编码，故必须走自定义 ShaderMaterial
// 与叶卡同方程。vOcc = COLOR_0.r（gen2 刚体叶片带该属性；无属性的正则树干 = 1）。
export function makeSpeedtreeStaticMaterial(m: GltfSceneMaterial, opaqueEnough: boolean): ShaderMaterial {
  if (m.map) { m.map.colorSpace = THREE.NoColorSpace; m.map.needsUpdate = true; }
  // extras.alphaBlend（新包 BLEND 语义）优先于「不透明度≈1 → 裁切」的旧包启发式：
  // 软混合效果片必须留在透明管线，不能削成硬边。
  const softAlpha = !!(m.userData && m.userData.alphaBlend);
  const blend = !opaqueEnough || softAlpha;
  const c0 = m.color;
  const factorOk = c0 && [c0.r, c0.g, c0.b].every((v) => Number.isFinite(v) && v > 0);
  const sh = factorOk ? new THREE.Vector3(c0.r, c0.g, c0.b) : new THREE.Vector3(1, 1, 1);
  const hasVC = !!m.vertexColors;   // GLTFLoader 对带 COLOR_0 的几何自动置位
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


/** 场景 GLB 贴图各向异性：按画质档给材质链上**全部**纹理设一次（同贴图跨材质共享，
 *  以 uuid 去重）。地面早就按 `Q.anisotropy` 设了（layers），场景侧此前漏设 →
 *  掠射角下建筑/道路贴图发糊、随镜头闪烁（客户端有各向异性档位）。
 *  覆盖材质直接属性（map 等）与 ShaderMaterial.uniforms（叶卡/ST|/天穹的贴图在那里）。
 *  返回设置的纹理数（DEBUG 用）。 */
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

// —— 以下材质工厂/补丁自本文件出仓（#LOC 拆分，实现原样平移）：
//   地形类（光照图/混合层/贴花 + 逐图太阳）→ sceneryTerrainMaterials.ts
//   环境类（天空/地图边界/水面/软混合片）→ sceneryEnvMaterials.ts
//   补丁与卸载（坦克环境光/细节层/disposeSceneGroup）→ sceneryMaterialPatches.ts
// 既有消费方（playbackScene / sceneryAssembly / mapLighting / mapAssets / 烘焙脚本 /
// shader-check 页 / 各单测）仍从本入口导入，出口签名不变。
export {
  makeBlendLayerMaterial, makeLightmappedMaterial, makeDecalMaterial,
  sunUniforms,
} from './sceneryTerrainMaterials.js'
export type {
  DecalMaterialOpts, EnvReflectionProps, EnvReflectionInput, DetailLayerInput,
} from './sceneryTerrainMaterials.js'
export {
  makeSkyMaterial, makeMapBorderMaterial,
  makeWaterMaterial, makeBlendByAngleMaterial,
} from './sceneryEnvMaterials.js'
export type {
  MapBorderVisual, WaterProps, WaterCoastField, WroWaterUv,
} from './sceneryEnvMaterials.js'
export {
  TANK_ENV_INTENSITY, patchTankMaterial, patchSceneryDetail, disposeSceneGroup,
} from './sceneryMaterialPatches.js'
