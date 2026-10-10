/**
 * 场景 GLB 材质管线 SSOT：playbackScene（3D 运行时）与 bake-ground-overhead.mjs
 * （俯视烘焙页）共用同一份材质实现——俯视烘焙的观感基准就是 3D 档画面，材质
 * 重实现路线已两次偏离（灰块/采样翻车），故提取为单源模块。
 *
 * 从 playbackScene.js 原样平移（2026-10-07，逐字未改）；守卫测试
 * sceneryMaterials.test.js 锁定行为，改这里必须同步过测。
 */
import * as THREE from 'three'

// 场景材质实例缓存（键 = 材质身份指纹，见 playbackScene 的 convMat）。
// 生命周期：3D 侧 teardown 时 clearSceneryMatCache()（勿复用已 dispose 实例）；
// 烘焙页为一次性进程，无需清理。
const sceneryMatCache = new Map();

export function cachedSceneryMat(key, factory) {
  let m = sceneryMatCache.get(key);
  if (!m) { m = factory(); sceneryMatCache.set(key, m); }
  return m;
}

export function clearSceneryMatCache() {
  sceneryMatCache.clear();
}

// 叶卡 alpha 裁切阈值。客户端 AlphaBlend 软边缘 + 0.05 低阈值会让近透明像素仍写
// 深度（叶片互相遮挡 → 破洞/闪烁）；提到 MASK 量级消除，并保留软边缘。
const CARD_ALPHA_CUT = 0.33;
// 场景 Lambert 材质的曝光修整（只作用于 convMat 建出的场景材质；代理车/GLB 车模不受影响）。
// 这套光照是按坦克 GLB 调的，场景降级到 Lambert 后朝上面过曝；系数 <1 压回过曝而不动光照。
export const SCENERY_LAMBERT_EXPOSURE = 0.75;
// 水体判定（GLB mesh/材质名启发式：seaplane/water/fountain/lake/river）
export const isWaterName = (n) => /water|sea|lake|river|fountain/i.test(n || '');

export function makeBillboardMaterial(m) {
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
    },
    vertexShader: `
      attribute vec4 _corner;
      attribute vec4 color;
      // <common> 必须先于 logdepthbuf_vertex（isPerspectiveMatrix 定义在 common 里）
      #include <common>
      varying vec2 vUv;
      varying float vOcc;
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
      varying vec2 vUv;
      varying float vOcc;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
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
export function makeSpeedtreeStaticMaterial(m, opaqueEnough) {
  if (m.map) { m.map.colorSpace = THREE.NoColorSpace; m.map.needsUpdate = true; }
  const c0 = m.color;
  const factorOk = c0 && [c0.r, c0.g, c0.b].every((v) => Number.isFinite(v) && v > 0);
  const sh = factorOk ? new THREE.Vector3(c0.r, c0.g, c0.b) : new THREE.Vector3(1, 1, 1);
  const hasVC = !!m.vertexColors;   // GLTFLoader 对带 COLOR_0 的几何自动置位
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: m.map || null },
      uSH: { value: sh },
      uAlphaCut: { value: opaqueEnough ? 0.33 : 0.05 },
    },
    vertexShader: `
      ${hasVC ? 'attribute vec4 color;' : ''}
      // <common> 必须先于 logdepthbuf_vertex（isPerspectiveMatrix 定义在 common 里）
      #include <common>
      varying vec2 vUv;
      varying float vOcc;
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
        gl_Position = projectionMatrix * im * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
        vUv = uv;
        vOcc = ${hasVC ? 'color.r' : '1.0'};
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform vec3 uSH;
      uniform float uAlphaCut;
      varying vec2 vUv;
      varying float vOcc;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec4 c = texture2D(map, vUv);
        if (c.a < uAlphaCut) discard;
        gl_FragColor = vec4(c.rgb * (vOcc * uSH), c.a);
      }`,
    side: THREE.DoubleSide,
    transparent: !opaqueEnough,
    depthWrite: opaqueEnough,
  });
}

// 天空穹（客户端 `Skyobject.material` → `skyobject-materials-vp/fp.sl`）：**不是普通网格**，
// 而是一条"无限远"路径，此前整节点隐藏（背景纯色 0x11161d）——与客户端的差距就是
// "抬头没有天"。逐条对齐：
//   - 客户端顶点 `mul(float4(position.xyz, 0.0), worldViewProjMatrix)`：**w=0 丢弃平移**，
//     网格坐标本身就是**方向**而不是位置。实测多数图天穹网格半径只有 ~10 m（himmelsdorf
//     ±9.9、karelia/mountain ±9.9、iceworld ±10），当普通几何渲染就是地图中心一个十米小球；
//     holland/forgecity 等图是 ±1000 m 大球。方向乘 view 后得到 skybox 式结果——**天穹随便
//     多大都铺满无限远**，这也是同一份代码能兼容两种网格尺度的原因。
//   - `position.w -= 0.0001` 把深度推到最后（客户端等效"永远的背景"）。
//   - 着色器无任何光照项（unlit albedo；FLOWMAP 时 lerp 两帧云），flags `VERTEX_FOG: 0`
//     （不参与雾）、RenderState `cullMode: NONE`（双面）、不参与 shadow/depth-prepass。
// 复刻要点：`gl_Position = vec4(p.xy, p.w, p.w)`（z/w = 1 = 远平面：对任何已绘几何深度
// 测试失败、对清屏色 LEQUAL 通过）；**不写深度**（省掉 gl_FragDepth 与 logdepthbuf 代码块：
// 1.0 在对数深度域同样表示远平面，测试语义不变）；纹理 NoColorSpace 直通——与叶卡/ST| 同
// 口径（客户端无输出重编码，我们写 raw 值到 sRGB 画布即色彩等价）。
// ⚠️ 云的 flowmap 动画（客户端 flowAnimSpeed/flowAnimOffset + flowmap 贴图）尚未随包
// （导出器只导 albedo）——当前是**静态天空**，待导出器补两个属性 + flowmap 槽后再接。
export function makeSkyMaterial(m) {
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

/** 场景 GLB 贴图各向异性：按画质档给材质链上**全部**纹理设一次（同贴图跨材质共享，
 *  以 uuid 去重）。地面早就按 `Q.anisotropy` 设了（layers），场景侧此前漏设 →
 *  掠射角下建筑/道路贴图发糊、随镜头闪烁（客户端有各向异性档位）。
 *  覆盖材质直接属性（map 等）与 ShaderMaterial.uniforms（叶卡/ST|/天穹的贴图在那里）。
 *  返回设置的纹理数（DEBUG 用）。 */
export function applyMaterialTextureAnisotropy(root, anisotropy) {
  const seen = new Set();
  root.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of ms) {
      if (!m) continue;
      const texs = [];
      for (const k in m) { const v = m[k]; if (v && v.isTexture) texs.push(v); }
      if (m.uniforms) {
        for (const k in m.uniforms) {
          const v = m.uniforms[k] && m.uniforms[k].value;
          if (v && v.isTexture) texs.push(v);
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

// 动画混合层（客户端 `TEXTURE0_ANIMATION_SHIFT` + `alphamask`：烟雾/瀑布/浪）：
// 客户端 `materials-vp.sl` 只对 albedo 的 texcoord0 加位移
//   `uv0 += texture0Shift + frac(tex0ShiftPerSecond * globalTime)`
// 而掩码走 `varTexCoord1 = texcoord1`（**不动**，`materials-fp.sl: A *= FP_A8(tex2D(alphamask, uv1))`）
// ⇒ 观感 = **轮廓固定（掩码）＋内部纹理滚动（albedo）**。
// 因此导出器把掩码单独成贴图（`extras.maskTexture` + 网格 TEXCOORD_1），本材质双采样器复刻：
//   color = albedo(uv0 + 位移) × tint   ；alpha = mask(uv1)
// ⚠️ 位移用**回放时钟**（pause 即停、seek 后相位确定、截图可复现），不用墙钟。
export function makeBlendLayerMaterial(m, maskTex) {
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
    transparent: true,       // 客户端 AlphaBlend 预设：软混合（轮廓由掩码给出）
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** 逐图太阳（供环境反射的高光项）：playbackScene.applyMapLighting 每次换图更新。
 *  uSunDirScene = 阳光**传播**方向（场景系，单位向量）；uSunColor = 客户端 color × intensity。 */
export const sunUniforms = {
  uSunDirScene: { value: new THREE.Vector3(0, -1, 0) },
  uSunColor: { value: new THREE.Vector3(1, 1, 1) },
};

// 烘焙光照图（客户端 `materials-fp.sl` 的 MATERIAL_LIGHTMAP 静态路径）：
//   `color = albedo(texCoord0) × lightmap(texCoord1) × 2.0`
//   `varTexCoord1 = uvScale * texcoord1 + uvOffset`（**逐材质实例**的变换）；
//   `× 2` 来自 VIEW_ALBEDO 分支（`common.slh` 兜底同时置 VIEW_DIFFUSE/VIEW_ALBEDO=1）。
//   着色器里没有任何光照项——静态场景在客户端就是**不受光**的烘焙结果（太阳/环境色只
//   作用于 Textured / lit / SpeedTree / 坦克），故本材质也不吃场景灯光。
// 数据：导出器把**图集贴图**挂材质（`extras.lightmap`）、**逐实例 UV 变换**挂节点
//（`extras.lm = [sx, sy, ox, oy]`）→ `sceneryInstancing` 汇成实例属性 `aLm`。
// 口径：伽马直采直写（与叶卡/ST|/混合层同口径；线性口径待 C3 的 sRGB 项一并定，见上游
// `docs/map-render-align-audit.md`）。
// 细节层（客户端 `MATERIAL_DETAIL`；B1）：`varDetailTexCoord = uv0 × detailTileCoordScale`、
// DRAW PHASE 末尾 `color *= detailTextureColor.rgb * 2.0`（在光照图/环境反射**之后**——
// 与拼花砖 TILED_DECAL_MASK 同段，本材质尚无拼花砖，故紧跟环境反射）。detail 贴图是
// 平铺的砖缝/岩面细节，×2 把均值 ~0.5 的贴图拉回 1.0 附近（客户端同式）。实测 36 图
// 453 实例 / 10 图（forgecity 121、rift 103、skit 63、fort 50、holland 39、lumber 28…）。
export function makeLightmappedMaterial(m, atlasTex, env, detail) {
  const map = m.map || null;
  if (map) { map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true; }
  if (atlasTex) { atlasTex.colorSpace = THREE.NoColorSpace; atlasTex.needsUpdate = true; }
  if (detail && detail.tex) { detail.tex.colorSpace = THREE.NoColorSpace; detail.tex.needsUpdate = true; }
  const cut = (m.alphaTest > 0 || (m.transparent && (m.opacity ?? 1) >= 0.99))
    ? Math.max(m.alphaTest || 0, 0.33) : 0;
  return new THREE.ShaderMaterial({
    uniforms: Object.assign(
      env ? {
        // 环境反射的高光项要逐图太阳（uSunDirScene/uSunColor，见下方 ENV_REFLECTION 分支）
        ...sunUniforms,
        // 环境反射（客户端 ENVIRONMENT_MAPPING）：遮罩(UV0) × 菲涅尔 × 天空立方图（等距柱状）
        envMask: { value: env.maskTex },
        envCube: { value: env.cubeTex },
        uEnvOn: { value: 1 },
        uEnvGloss: { value: env.props.reflectionSpecParamGloss ?? 0.45 },
        uEnvFresnel: { value: new THREE.Vector3(...(env.props.reflectionMetalFresnelReflectance || [0.5, 0.55, 0.3])) },
        uEnvSpecular: { value: env.props.reflectionSpecular ?? 1.0 },
        uEnvBrighten: { value: env.props.reflectionBrightenEnvMap ?? 2.8 },
        uEnvLerp: { value: env.props.reflectionLerpEnvMap ?? 0.5 },
        uEnvAddDiffuse: { value: env.props.reflectionAddDiffuse ?? 0.0 },
        uEnvMaskMul: { value: env.props.reflectionMaskMultiplier ?? 100.0 },
        uEnvMultLM: { value: env.props.reflectionMultLightmap ?? 2.0 },
        uEnvCubeIntensity: { value: new THREE.Vector3(...(env.props.cubemapIntensity || [1, 1, 1])) },
      } : {},
      detail && detail.tex ? {
        uDetailTex: { value: detail.tex },
        uDetailScale: { value: new THREE.Vector2(
          Number.isFinite(detail.scale?.[0]) ? detail.scale[0] : 1,
          Number.isFinite(detail.scale?.[1]) ? detail.scale[1] : 1) },
      } : {},
      {
        map: { value: map },
        lightmap: { value: atlasTex || map },
        uTint: { value: m.color ? m.color.clone() : new THREE.Color(0xffffff) },
        uAlphaCut: { value: cut },
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
        // 页面上只表现为"物体不渲染"。守卫测试锁这两条（scene/sceneryMaterials.test.js）。
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
        gl_FragColor = vec4(color, 1.0);
      }`,
    defines: Object.assign(env ? { ENV_REFLECTION: 1 } : {},
                           detail && detail.tex ? { MATERIAL_DETAIL: 1 } : {}),
    side: THREE.DoubleSide,
    transparent: false,
  });
}

// 贴花（客户端 `MATERIAL_DECAL`，材质文件 `Decal.material`；
// `materials-vp.sl:473-483` + `materials-fp.sl:183/447-493/539-607` 逐分支核对）：
//   · 顶点期 `varTexCoord1 = texcoord1`（**无 uvScale/uvOffset**）⇒ 片元用**原始 UV1** 采 decal 槽；
//   · decal 槽 = **地图 colormap**（`landscape/<map>_colormap.tex`）——客户端注释原文
//     "objects colored with landscape" 即此；
//   · `decalTextureFetch = tex2D(decal, varTexCoord1)`；GLOBAL_TINT 时按
//     `materialLightmapAdjustment` 做 `pow(gamma) → (x−0.5)·contrast+0.5 → +brightness`；
//   · `LANDSCAPE_SEPARATE_LIGHTMAP_CHANNEL`（= 地表 `separate_lm`）⇒ `shadowColor *= .a`
//     （colormap 的 alpha 通道；本包把它拆成 `ground/lm.webp` 的 R 通道）；
//   · DRAW PHASE `color = albedo(UV0) × shadowColor × 2.0` —— **全程无光照项 ⇒ 不受光**。
// 若落到受光材质（Lambert）会比客户端亮一档（2026-10-10 用户"铁轨贴图看起来太亮"报障：
// forgecity `env_fs_rails_00X` / `env_fs_border_*`，fxName = `Decal.material`）。
// 数据：导出器把 `extras.decal = true` 挂材质、并**随导 TEXCOORD_1**（同 albedo 的 UV0 管线，
// 无需翻转——实测铁轨顶点 UV1 与地面着色器的世界→UV 公式同空间：样例 (0.4219, 0.2775) vs
// 公式 (0.422, 0.2767)）。
export function makeDecalMaterial(m, cmTex, lmTex, opts = {}) {
  const map = m.map || null;
  if (map) { map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true; }
  if (cmTex) { cmTex.colorSpace = THREE.NoColorSpace; cmTex.needsUpdate = true; }
  if (lmTex) { lmTex.colorSpace = THREE.NoColorSpace; lmTex.needsUpdate = true; }
  const cut = (m.alphaTest > 0 || (m.transparent && (m.opacity ?? 1) >= 0.99))
    ? Math.max(m.alphaTest || 0, 0.33) : 0;
  const adj = Array.isArray(opts.lmAdjust) && opts.lmAdjust.length === 3 ? opts.lmAdjust : null;
  const useAdj = !!(adj && opts.globalTint);
  return new THREE.ShaderMaterial({
    uniforms: Object.assign(
      { map: { value: map },
        colormap: { value: cmTex || map },
        colormapLm: { value: lmTex || cmTex || map },
        uTint: { value: m.color ? m.color.clone() : new THREE.Color(0xffffff) },
        uAlphaCut: { value: cut } },
      useAdj ? { uLmAdjust: { value: new THREE.Vector3(adj[0], adj[1], adj[2]) } } : {},
    ),
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
        gl_FragColor = vec4(base.rgb * uTint * shadowColor * 2.0, 1.0);
      }`,
    defines: Object.assign({},
                           lmTex && opts.separateLm ? { DECAL_SEPARATE_LM: 1 } : {},
                           useAdj ? { DECAL_LM_ADJUST: 1 } : {}),
    side: THREE.DoubleSide,
    transparent: false,
  });
}

// 水面（客户端 `water-fp.sl` 的 **!REAL_REFLECTION 分支** = MEDIUM 档，材质文件
// `WaterPerPixelCubemapAlphablend.material`：WaterRenderLayer + blend、alpha = 菲涅尔）：
//   uv0 = uv × normal0Scale + frac(normal0ShiftPerSecond × t)
//   uv1 = (uv.x+uv.y, uv.y−uv.x) × normal1Scale + frac(normal1ShiftPerSecond × t)   ← 45° 旋转层
//   normal = normalize(n0 + n1 − 1)                       // UDN 相加（客户端同式）
//   fresnel = FresnelShlickCustom(dot(−V, normal), fresnelBias, fresnelPow)
//   R = reflect(V, normal); R.z=|R.z|（切线空间）⇔ 世界系 R.y=|R.y|（防穿透水面）
//   outColor = (texCUBE(cubemap, R) × reflectionTintColor, alpha = fresnel)
// 切线基在片元用**导数**建（cotangent frame）——我们不发 TANGENT 属性，水面是水平面，够用。
// 朝向：cubemap 已转等距柱状（内嵌图 flipY=false ⇒ v=0 = 首行 = 天，同 B2 环境反射）。
// 档位沿革（2026-10-09）：曾按用户选择改采 LOW 档（`!PIXEL_LIT`：不透明、无法线 ⇒ 反射是
// 平面镜、零波浪扰动），实看被判"不好"后按用户裁示**回到 MEDIUM**。已知固有观感（非 bug）：
// ① 反射取**预烘探针**而非当帧场景（客户端 HIGH/ULTRA 的屏幕空间反射才照得出建筑）；
// ② 探针亮度偏高的高度带在俯视角下读作"亮面"（2026-10-09 报障即此）——要压可调
// `uReflTint`/探针强度这一项，要"照出建筑"得上镜像平面反射（均未做，见 docs/index.md F1）。
/** 水面材质（客户端 `water-fp.sl` 的 MEDIUM 档 `!REAL_REFLECTION` 分支：双层滚动法线 + UDN +
 *  菲涅尔 alpha + 逐图 cubemap×色调）。
 *
 *  **海岸线** `coastLine`（客户端 `water-fp.sl` 的 `RETRIEVE_FRAG_DEPTH_AVAILABLE` 分支同构）：
 *    客户端：`adjustedDifference = 2·|ndcZ_片元 − ndcZ_背后表面| / ndcZ_片元`，saturate 即 coastLine，
 *    随后 `fresnel *= coastLine`（背后表面取自深度预通道 `dynamicDepthPrepass`）——它掩盖的是
 *    **深度差小到缓冲分不开**的那条岸线带（`ndcZ` 的空间口径由客户端运行时 `ndcToZMapping` 注入，
 *    绝对值不可移植）。我们没有深度预通道，改用**本渲染器自己的深度分辨率**做同一件事：
 *      `dNdcZ = |∂ndcZ/∂z|·Δz_沿视线`（`∂ndcZ/∂z = 2·f·n/((f−n)·z²)`，Δz_沿视线 = 高差/|视线.y|）
 *      `coastLine = saturate(dNdcZ / (2·uDepthUlp))`，`uDepthUlp = 2/2^depthBits`（缓冲 1 ulp 的 NDC 值）
 *    ⇒ **淡出带 = 该视距下深度抢胜带（2 ulp）**：岸线带内反射 → 0（水面在那里与地形分不开，
 *    让位给地形/冰面 ⇒ 无硬边、无逐像素翻转），**深水（远大于精度）任何角度都满反射**（含俯视）。
 *    ⚠️ 曾用 `2·(水面高−地形高)/(相机高−水面高)`（由客户端等式反推）：相机越高分母越大 ⇒
 *    **俯视时深水也被压成透明**（2026-10-10 用户"从上往下看水面基本都是透明的，只有视角接近
 *    水面才反射"）——该口径已废，勿回退。地形高取**渲染用**高度场（含让位掩码）；缺则 fail-open。
 *    `coast = { heightTex, mapSpan, near, far, depthUlp }`。 */
export function makeWaterMaterial(m, { normalTex, cubeTex, props, coast = null }) {
  const map = m.map || null;
  if (map) { map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true; }
  if (normalTex) { normalTex.colorSpace = THREE.NoColorSpace; normalTex.needsUpdate = true; }
  if (cubeTex) { cubeTex.colorSpace = THREE.NoColorSpace; cubeTex.needsUpdate = true; }
  const p = props || {};
  const v2 = (v, d) => new THREE.Vector2(...(Array.isArray(v) && v.length === 2 ? v : d));
  return new THREE.ShaderMaterial({
    uniforms: {
      normalmap: { value: normalTex || map },
      cubemap: { value: cubeTex || map },
      uTime: { value: 0 },                     // 回放秒数（playbackScene 每帧写）
      uN0Scale: { value: Number.isFinite(p.normal0Scale) ? p.normal0Scale : 1 },
      uN1Scale: { value: Number.isFinite(p.normal1Scale) ? p.normal1Scale : 1 },
      uShift0: { value: v2(p.normal0ShiftPerSecond, [0, 0]) },
      uShift1: { value: v2(p.normal1ShiftPerSecond, [0, 0]) },
      uFresnelBias: { value: Number.isFinite(p.fresnelBias) ? p.fresnelBias : 0 },
      uFresnelPow: { value: Number.isFinite(p.fresnelPow) ? p.fresnelPow : 0 },
      uReflTint: { value: new THREE.Vector3(...(Array.isArray(p.reflectionTintColor) ? p.reflectionTintColor : [1, 1, 1])) },
      // 海岸线用：渲染用高度场（R = 世界高度，米）。sampler 不能判空/取分量 ⇒ 用浮点开关 +
      // 兜底绑定一张在用贴图（缺高度场时分支不采样）。
      uHeightmap: { value: (coast && coast.heightTex) || map || normalTex || null },
      uHasHeightmap: { value: coast && coast.heightTex ? 1 : 0 },
      uMapSpan: { value: coast && Number.isFinite(coast.mapSpan) ? coast.mapSpan : 600 },
      uNear: { value: coast && Number.isFinite(coast.near) ? coast.near : 0.5 },
      uFar: { value: coast && Number.isFinite(coast.far) ? coast.far : 4000 },
      // 深度缓冲 1 ulp 的 NDC 值（= 2/2^depthBits，由 renderer 上下文实测传入；缺省 24bit）
      uDepthUlp: { value: coast && Number.isFinite(coast.depthUlp) ? coast.depthUlp : 2 / 16777216 },
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
      uniform sampler2D normalmap;
      uniform sampler2D cubemap;
      uniform float uTime;
      uniform float uN0Scale;
      uniform float uN1Scale;
      uniform vec2 uShift0;
      uniform vec2 uShift1;
      uniform float uFresnelBias;
      uniform float uFresnelPow;
      uniform vec3 uReflTint;
      uniform sampler2D uHeightmap;
      uniform float uHasHeightmap;
      uniform float uMapSpan;
      uniform float uNear;
      uniform float uFar;
      uniform float uDepthUlp;
      varying vec2 vUv;
      varying vec3 vWorldP;
      varying vec3 vWorldN;
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
        mat3 tbn = cotangentFrame(normalize(vWorldN), vWorldP, vUv);
        vec3 N = normalize(tbn * normalize(n0 + n1 - vec3(1.0)));   // UDN 相加
        vec3 V = normalize(vWorldP - cameraPosition);               // 相机→片元
        float lambertFactor = max(dot(-V, N), 0.0);
        float fresnel = uFresnelBias + (1.0 - uFresnelBias) * pow(1.0 - lambertFactor, uFresnelPow);
        vec3 R = reflect(V, N);
        R.y = abs(R.y);                                             // 防穿透水面
        vec3 refl = texture2D(cubemap, envEquirectUv(R)).rgb * uReflTint;
        // 海岸线（客户端 water-fp.sl 的 coastLine，推导见 makeWaterMaterial 注释）：
        // 背后表面（地形）与水面沿视线的相对深度差；岸线带内 → 0 ⇒ 水面贡献消失，
        // 于是岸线处既没有"水面 vs 地形"的硬边，也不受深度抢胜的逐像素翻转影响。
        float coastLine = 1.0;
        if (uHasHeightmap > 0.5) {
          float terrainY = texture2D(uHeightmap, vWorldP.xz / uMapSpan + 0.5).r;
          vec3 toCam = vWorldP - cameraPosition;
          float zlen = max(length(toCam), 1e-3);
          float dzAlong = (vWorldP.y - terrainY) / max(abs(toCam.y) / zlen, 1e-3);   // 高差 → 沿视线差
          float dNdcZ = (2.0 * uFar * uNear / ((uFar - uNear) * zlen * zlen)) * dzAlong;
          coastLine = clamp(dNdcZ / (2.0 * uDepthUlp), 0.0, 1.0);
        }
        gl_FragColor = vec4(refl, clamp(fresnel, 0.0, 1.0) * coastLine);   // alpha = 菲涅尔 × 海岸线
      }`,
    transparent: true,
    depthWrite: true,   // 实测（erlenberg）水面必须写深度：极简大三角面不写深度会与地形逐像素交替闪
    side: THREE.DoubleSide,
  });
}

// 视角淡出软混合效果片（客户端 `Textured.material` 的 **`AlphaBlend` 预设** + flags
// `BLEND_BY_ANGLE`）——光束片/光柱片（`rays.sc2` 类）。客户端语义（材质文件 + 着色器逐字）：
//   材质：Layers [TransclucentRenderLayer]、blend: true、**depthWrite: false**
//   片元末（materials-fp.sl:378-384）：
//     VdotN = |dot(视线, 法线)| / (|视线|·|法线|)          // 视线的"正对程度"
//     VdotN = lerp(VdotN, 1 − VdotN, angleBlendInversion)
//     alpha *= pow(saturate((VdotN − bounds.x) / (bounds.y − bounds.x)), angleBlendPower)
// 为什么必须软混合：这类贴图是"白 RGB + 图案全在 alpha"（medvedkovo `rays.tex` 实测 A 均值 14、
// 仅 5% 像素高于 0.33）——按裁切（alphaTest 0.33）渲染会裁掉 95% 内容、剩下硬边暖白块
// （2026-10-09 用户"贴图像解码错误"报障）；且缺视角因子时俯视会一直全亮，而客户端会淡掉。
// 不受光：效果片自发光；FLATCOLOR 染色已在导出期烘进贴图（`apply_flat_tint`）。
export function makeBlendByAngleMaterial(m, props) {
  const map = m.map || null;
  if (map) { map.colorSpace = THREE.NoColorSpace; map.needsUpdate = true; }
  const p = props || {};
  const b = Array.isArray(p.bounds) && p.bounds.length === 2 ? p.bounds : [0, 1];
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      uTint: { value: m.color ? m.color.clone() : new THREE.Color(0xffffff) },
      uBounds: { value: new THREE.Vector2(b[0], b[1]) },
      uPower: { value: Number.isFinite(p.power) ? p.power : 1 },
      uInversion: { value: Number.isFinite(p.inversion) ? p.inversion : 0 },
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
    depthWrite: false,   // 客户端该预设 depthWrite: false
    side: THREE.DoubleSide,
  });
}

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
export function patchTankMaterial(m) {
  if (!m || !m.isMeshStandardMaterial) return m;
  if (m.userData && m.userData.__tankAmbientFixed) return m;
  if (m.userData) m.userData.__tankAmbientFixed = true;
  if (Number.isFinite(TANK_ENV_INTENSITY)) m.envMapIntensity = TANK_ENV_INTENSITY;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === 'function') prev.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_begin>',
      '#include <lights_fragment_begin>\n\tirradiance = vec3( 0.0 );   // 坦克：环境项只留 IBL（客户端 ULTRA 口径）',
    );
  };
  // 程序缓存键必须带标记：否则会复用"未打补丁"的同参数程序（three 按 key 缓存）
  const prevKey = m.customProgramCacheKey;
  m.customProgramCacheKey = function () {
    const base = (typeof prevKey === 'function') ? prevKey.call(this) : '';
    return base + '|tank-noambient';
  };
  m.needsUpdate = true;
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
export function patchSceneryDetail(m, detailTex, scale) {
  if (!m || !detailTex) return m;
  if (m.userData && m.userData.__sceneryDetail) return m;
  if (m.userData) m.userData.__sceneryDetail = true;
  detailTex.colorSpace = THREE.NoColorSpace;
  detailTex.needsUpdate = true;
  const sx = Number.isFinite(scale?.[0]) ? scale[0] : 1;
  const sy = Number.isFinite(scale?.[1]) ? scale[1] : 1;
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
  m.customProgramCacheKey = function () {
    const base = (typeof prevKey === 'function') ? prevKey.call(this) : '';
    return base + '|scenery-detail';
  };
  m.needsUpdate = true;
  return m;
}

/** 递归给一棵坦克模型子树里的 PBR 材质打补丁；返回处理过的材质数（测试用）。 */
export function applyTankLightingFix(root) {
  if (!root || typeof root.traverse !== 'function') return 0;
  const seen = new Set();
  root.traverse((o) => {
    const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of ms) if (m && !seen.has(m)) { seen.add(m); patchTankMaterial(m); }
  });
  return seen.size;
}

/** 释放一组场景对象：几何 + 材质（去重）+ 材质**直接属性与 uniforms** 里的纹理。
 *  供烘焙页在 --all 批处理中逐图卸载——SpeedTree/叶卡的贴图在
 *  ShaderMaterial.uniforms.map.value，只枚举直接属性会漏掉（评审实测
 *  material dispose=1、texture dispose=0，显存随图数累积）。顺手清空
 *  材质实例缓存：缓存若保留已 dispose 的材质，下一张图会拿到失效实例。 */
export function disposeSceneGroup(g) {
  const mats = new Set(), texs = new Set()
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose()
    const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])
    for (const m of ms) {
      if (!m) continue
      mats.add(m)
      for (const k in m) { const v = m[k]; if (v && v.isTexture) texs.add(v) }
      if (m.uniforms) {
        for (const k in m.uniforms) {
          const v = m.uniforms[k] && m.uniforms[k].value
          if (v && v.isTexture) texs.add(v)
        }
      }
    }
  })
  for (const t of texs) t.dispose()
  for (const m of mats) m.dispose()
  clearSceneryMatCache()
  return { materials: mats.size, textures: texs.size }
}
