// 场景装配（extras 贴图解 + 逐节点材质分派）SSOT：3D 运行时（playbackScene）与俯视烘焙
// （scripts/bake-ground-overhead.mjs）共用同一份。
//
// 2026-10-14 抽层（用户裁示"直接用它的代码算每个像素，别维护另一套渲染代码"）：把两侧
// 两次往返复制的"解 extras 贴图 → 逐节点选材质（水/贴花/光照图/混合层/水下/Lambert）→
// 收尾修整"收成一处。两侧只保留各自的宿主差异：
//   运行时：groundLayers（贴花 cm/lm）、waterCoast（海岸线高度场）、onMesh 钩子
//           （贴地薄构件走廊取样，须在实例化合批前）、animLayerMats（每帧 uTime）、
//           各向异性、实例化合批（sceneryInstancing.js，已共享）。
//   烘焙：  剔除表（sceneryAssemblyRules.bakeDropNode）+ 正交俯拍单帧；groundLayers 传
//           null ⇒ 贴花件回落（已知残留，档 2 收尾项）。
import * as THREE from 'three';
import {
  cachedSceneryMat, makeBillboardMaterial, makeBlendByAngleMaterial, makeBlendLayerMaterial,
  makeDecalMaterial, makeLightmappedMaterial, makeSkyMaterial, makeSpeedtreeStaticMaterial,
  makeWaterMaterial, patchSceneryDetail, SCENERY_LAMBERT_EXPOSURE,
} from './sceneryMaterials.js';
import {
  materialIsWater, isWaterNode, isSkyShell, sceneHasSkyFlags,
} from './sceneryAssemblyRules.js';

/** extras 贴图预解析（material.extras 里存 glTF **texture 下标**；GLTFLoader 的 texture
 *  依赖是异步的、材质转换遍历是同步的 ⇒ 先解析成 Map，遍历时同步取用）。
 *  解析不到（旧包/无 extras）⇒ 各分支自然回落（行为与无 extras 时期一致）。 */
export async function resolveSceneryExtras(gltf) {
  const maskTexByMatIndex = new Map();
  const lmTexByMatIndex = new Map();
  const detailTexByMatIndex = new Map();   // 细节层贴图（extras.detail.texture；B1）
  const envTexByMatIndex = new Map();      // 环境反射：[遮罩, 立方图]（extras.envMask/envCube）
  const waterTexByMatIndex = new Map();    // 水面：[法线, 立方图]（extras.water.normal / .cube）
  const decalTexByMatIndex = new Map();    // 贴花槽自有贴图（extras.decalTexture）
  try {
    const jsonMats = (gltf.parser && gltf.parser.json && gltf.parser.json.materials) || [];
    for (let i = 0; i < jsonMats.length; i++) {
      const ex = (jsonMats[i] && jsonMats[i].extras) || {};
      if (ex.maskTexture !== undefined) {
        maskTexByMatIndex.set(i, await gltf.parser.getDependency('texture', ex.maskTexture));
      }
      if (ex.lightmap !== undefined) {
        lmTexByMatIndex.set(i, await gltf.parser.getDependency('texture', ex.lightmap));
      }
      if (ex.decalTexture !== undefined) {
        decalTexByMatIndex.set(i, await gltf.parser.getDependency('texture', ex.decalTexture));
      }
      if (ex.detail && ex.detail.texture !== undefined) {
        detailTexByMatIndex.set(i, await gltf.parser.getDependency('texture', ex.detail.texture));
      }
      if (ex.water && typeof ex.water === 'object' && ex.water.normal !== undefined) {
        waterTexByMatIndex.set(i, [
          await gltf.parser.getDependency('texture', ex.water.normal),
          await gltf.parser.getDependency('texture', ex.water.cube),
        ]);
      }
      if (ex.envMask !== undefined && ex.envCube !== undefined) {
        envTexByMatIndex.set(i, [
          await gltf.parser.getDependency('texture', ex.envMask),
          await gltf.parser.getDependency('texture', ex.envCube),
        ]);
      }
    }
  } catch (e) { console.warn('场景 extras 贴图预解析失败（回退原口径）:', e); }
  return { maskTexByMatIndex, lmTexByMatIndex, detailTexByMatIndex, envTexByMatIndex, waterTexByMatIndex, decalTexByMatIndex };
}

/** 按材质对象取已解析贴图：键 = `gltf.parser.associations` 的材质下标。 */
export function makeTexResolvers(gltf, maps) {
  const texOf = (m, table) => {
    const assoc = gltf.parser && gltf.parser.associations && gltf.parser.associations.get(m);
    const idx = assoc && assoc.materials;
    return idx === undefined ? null : (table.get(idx) || null);
  };
  return {
    maskTexOf: (m) => texOf(m, maps.maskTexByMatIndex),
    lmTexOf: (m) => texOf(m, maps.lmTexByMatIndex),
    detailTexOf: (m) => texOf(m, maps.detailTexByMatIndex),
    envTexOf: (m) => texOf(m, maps.envTexByMatIndex),
    waterTexOf: (m) => texOf(m, maps.waterTexByMatIndex),
    decalTexOf: (m) => texOf(m, maps.decalTexByMatIndex),
  };
}

/** "被水面完全盖住"的静态件预计算：水面片（材质 extras.water 标记）的世界变换与各片
 *  占地面积/标高。GLB 仍是**场景系**（z = 高度，x/y = 地面；前端 group 旋转在后），
 *  故这里的"高度"取 z、地面取 (x,y)，与导出器的 glb_world_xyz 同一约定。 */
export function collectWaterSurfaces(root) {
  root.updateMatrixWorld(true);
  const waterSurfaces = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if (!materialIsWater(o.material)) return;
    const bb = new THREE.Box3().setFromObject(o);
    if (bb.isEmpty()) return;
    waterSurfaces.push({ h: bb.max.z, x0: bb.min.x, x1: bb.max.x, y0: bb.min.y, y1: bb.max.y });
  });
  return waterSurfaces;
}

/** 该网格是否整个位于某片水面之下（含 0.5 m 边缘余量、5 cm 高度余量）。 */
export function makeUnderWater(waterSurfaces) {
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
export function assembleSceneryMaterials(gltf, {
  strictSurfaces = false, masks, groundLayers = null, waterCoast = null, debug = false, onMesh = null,
  skyFlagsAvailable = null,
} = {}) {
  const { maskTexOf, lmTexOf, detailTexOf, envTexOf, waterTexOf, decalTexOf } = masks;
  const waterSurfaces = collectWaterSurfaces(gltf.scene);
  const underWater = makeUnderWater(waterSurfaces);
  let skyMeshes = 0;
  // 天空穹判据：优先材质 extras.sky（导出器按客户端 Skyobject 模板写入）；只有整份
  // GLB 都没有该标记（旧包）才退回节点名 /sky/i。名字不是语义——新包一旦出现任何
  // sky 标记，就禁止名字 fallback，避免把名字含 sky 的非天穹对象误判。
  // 新包判据必须由调用方在**任何剔除之前**采样（烘焙会先移除天穹再装配）；缺省从当前
  // 场景现算。判定本身只走共享 SSOT `isSkyShell`，本文件不得再复制一套开关。
  const skyFlagAvailable = skyFlagsAvailable ?? sceneHasSkyFlags(gltf.scene);
  const isSkyNode = (o) => isSkyShell(o.name, o.material, { skyFlagsAvailable: skyFlagAvailable });
  // 材质转换：与内核共享同一份实现。键组成必须与两侧历史口径一致——同 key 同材质、
  // 跨端观感一致（守卫锁定）。convMat 键指纹即本模块为准一来源（2026-10-14 抽层）。
  const convMat = (m, isCard) => cachedSceneryMat(
    // alphaTest/transparent 必须进键：GLTFLoader 不暴露 alphaMode，同 name+map
    // 的 MASK 与 OPAQUE 材质只靠这两项区分，漏掉会串用（先建的赢）
    // （`m.alphaMode` 当前恒为 undefined，保留仅作将来 GLTFLoader 补上时的保护）
    // 染色值取原始分量而非 getHexString：后者会把 >1 的 SH(L0) 钳到 ffffff，
    // 于是"同一张贴图、不同 SH 染色"的材质在键上无法区分（叶卡 uSH 就取它）。
    [isCard ? 'C' : 'M', m.name || '', m.map ? m.map.uuid : '',
     m.color ? [m.color.r, m.color.g, m.color.b].map((v) => v.toFixed(4)).join(',') : '',
     m.alphaMode || '', m.alphaTest ?? 0, !!m.transparent, m.opacity ?? 1,
     !!m.vertexColors,
     (m.userData && m.userData.occMean) || '',
     (m.userData && m.userData.blendLayer) || '',
     (m.userData && m.userData.alphaBlend) || '',
     // 细节层（B1）：补丁逐材质注入 detail 贴图/平铺倍率——不同 detail 的材质
     // 若串用缓存会互相采错贴图（同图不同砖纹的实例）
     (() => {
       const d = m.userData && m.userData.detail;
       if (!d) return '';
       const t = detailTexOf(m);
       return 'D|' + (t ? t.uuid : '') + '|' + (Array.isArray(d.scale) ? d.scale.join(',') : '');
     })()].join('|'),
    () => (isCard ? makeBillboardMaterial(m) : (() => {
      // ST|（SpeedTree 树/灌木）：客户端 speedtree-materials-fp = albedo × SH，
      // 无场景光照——用不受光材质（染色值经 baseColorFactor→color 传入）
      // 客户端 SpeedTree = AlphaTest+AlphaBlend 双通道。但导出材质多为
      // 【不透明度=1 的伪透明】（transparent 却 opacity 1）：这类走混合通道会进
      // 透明渲染队列，大量重叠植被面按深度排序不稳定 → 成片闪烁。按不透明度分流：
      //   不透明度≈1 → 不透明管线 + 裁切（排序无关，消除闪烁且更快）
      //   真透明      → 混合 + 不写深度（减少互遮挡）
      const opaqueEnough = (m.opacity ?? 1) >= 0.99;
      if ((m.name || '').startsWith('ST|')) {
        return makeSpeedtreeStaticMaterial(m, opaqueEnough);
      }
      // 伪透明（BLEND 但不透明度≈1）一律转不透明 + 裁切，消除透明排序闪烁；
      // 真透明保持混合但不写深度（避免互遮挡抖动）。
      // 例外：导出器明确标记的**真混合层**（material.extras.blendLayer，烟雾/瀑布/
      // 浪这类"动画 + 掩码"效果层）——其 alpha 是掩码烘出的软渐变，转不透明 + 裁切
      // 0.33 会把它削成硬边卡片（旧包无此 extras ⇒ undefined ⇒ 行为与改前一致）。
      const blendLayer = !!(m.userData && m.userData.blendLayer);
      // 导出器判定的软混合效果片（extras.alphaBlend；如视角淡出片）同样不得被
      // "伪透明→裁切"启发式削成硬边
      const softAlpha = !!(m.userData && m.userData.alphaBlend);
      const pseudoOpaque = !!m.transparent && (m.opacity ?? 1) >= 0.99 && !blendLayer && !softAlpha;
      const nm = new THREE.MeshLambertMaterial({
        map: m.map || null,
        // 曝光修整：这套光照是按坦克 GLB 调的，场景降级到 Lambert 后朝上面过曝
        // （岩石贴图 87.5/255 却渲染到 137/255、27% 像素近白）。只作用于本函数
        // 建出的场景材质，代理车/GLB 车模不受影响。
        color: (m.color ? m.color.clone() : new THREE.Color(0xffffff))
          .multiplyScalar(SCENERY_LAMBERT_EXPOSURE),
        transparent: !!m.transparent && !pseudoOpaque,
        opacity: m.opacity ?? 1,
        side: THREE.DoubleSide,
      });
      // 镂空材质必须继承 GLTFLoader 解析好的 alphaTest（GLTFLoader 不把 glTF 的
      // alphaMode 挂到材质上——MASK 只体现为 alphaTest、BLEND 只体现为 transparent）。
      if (m.alphaTest > 0) nm.alphaTest = m.alphaTest;
      if (pseudoOpaque) nm.alphaTest = Math.max(nm.alphaTest || 0, 0.33);
      // 细节层（B1）：没有光照图但客户端开了 MATERIAL_DETAIL 的实例走不了
      // makeLightmappedMaterial，只能给 Lambert 打补丁
      if (m.userData && m.userData.detail) {
        const dtex = detailTexOf(m);
        if (dtex) patchSceneryDetail(nm, dtex, m.userData.detail.scale);
      }
      if (nm.transparent) nm.depthWrite = false;
      // 法线：用几何自带的 NORMAL（导出器 authored 法线）。客户端按 authored 法线
      // 着色，故不设 flatShading。
      return nm;
    })()));
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    // 网格清单钩子（运行时的走廊掩码取样）：水面/水下片按客户端水材质标记排除
    const waterMarked = materialIsWater(o.material);
    if (onMesh) onMesh(o, waterMarked);
    // 天空穹：走 makeSkyMaterial 的"无限远"路径。语义判据 = 材质 extras.sky
    // （导出器按客户端 Skyobject 模板写入）；旧包无标记才退回节点名。⚠️ 水材质优先：
    // `SkySeaSurface.sc2`（NewBay 的海面）名字含 sky，但材质是 extras.water。
    // ⚠️ frustumCulled 必须关：天穹顶点在网格局部空间里只是 ~10m 的小球，
    // 按真实包围球剔锥时镜头一转向天就整片消失——客户端由 w=0 的无限远投影天然免疫。
    if (!waterMarked && isSkyNode(o)) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => makeSkyMaterial(m))
                                             : makeSkyMaterial(o.material);
      // 语义标记：合批过滤必须按它排除天穹（新包天穹名可能不含 sky；材质转换后
      // extras 判据不可再取）。名字 fallback 已由 isSkyNode 统一处理。
      o.userData.isSky = true;
      o.frustumCulled = false;
      skyMeshes++;
      if (debug && typeof window !== 'undefined') window.__skyMeshes = (window.__skyMeshes || 0) + 1;
      return;
    }
    // GLTFLoader 会把自定义属性名转小写：GLB 里的 _CORNER → geometry._corner
    const isCard = !!o.geometry.attributes._corner;
    // 该网格是否整个位于水面之下（客户端只经折射通道看到它们）
    const uw = !!o.geometry && underWater(o);
    const assignMat = (m) => {
      const ud = (m && m.userData) || {};
      // 水面（客户端 water-fp.sl 的 **MEDIUM 档**）：导出器带数据时走专用材质；
      // 旧包/无数据（water 仅 bool）落回 convMat + 下面的水面修整分支
      if (ud.water && typeof ud.water === 'object') {
        const wt = waterTexOf(m);
        if (wt) {
          if (debug && typeof window !== 'undefined' && window.__waterCoast) window.__waterCoast.materials++;
          return makeWaterMaterial(m, { normalTex: wt[0], cubeTex: wt[1], props: ud.water.props || {}, coast: waterCoast });
        }
      }
      // 视角淡出软混合效果片（客户端 AlphaBlend 预设 + BLEND_BY_ANGLE）
      if (ud.blendByAngle) {
        return makeBlendByAngleMaterial(m, ud.blendByAngle);
      }
      // 贴花（客户端 `MATERIAL_DECAL`）：`albedo(UV0) × colormap(UV1) × 2.0`，**不受光**——
      // 落到 Lambert 会比客户端亮一档。前置条件：extras.decal + 导出的 UV1 + 地表分层在位。
      // 槽图两类（按槽路径与地面 colorTexture 逐字相等判身份）：① 地图地表色图（用逐图
      // cm；其 alpha = 光照通道走 lm.webp）；② 材质自有贴图（extras.decalTexture 随导）。
      // separateLm（LSC 逐实例 define，extras.decalSeparateLm 显式布尔，旧包回退逐图）。
      if (ud.decal && groundLayers && o.geometry.attributes.uv1) {
        const ownDecal = decalTexOf(m);
        const cmTex = ownDecal || groundLayers.texs.cm;
        if (cmTex) {
          const GL = groundLayers.layers || {};
          return makeDecalMaterial(m, cmTex, ownDecal ? null : groundLayers.texs.lm, {
            separateLm: (ud.decalSeparateLm !== undefined)
              ? !!ud.decalSeparateLm
              : (!ownDecal && !!GL.separate_lm),
            lmAdjust: ud.decalLmAdjust || null,
            globalTint: !!GL.flatcolor,
          });
        }
      }
      // 烘焙光照图：静态场景在客户端是**不受光**的（albedo × lightmap(UV1×变换) × 2）。
      // ⚠️ 水面之下的静态件**不接光照图**（客户端那片水面不透明、折射通道不计漫反射；
      // 该类件在客户端图集里常落**未烘焙黑格** ⇒ 不接即对齐客户端可见结果。判据纯几何）。
      if (ud.lightmap !== undefined && !isWaterNode(o.name, m, { strictSurfaces })
          && !isSkyNode(o) && !underWater(o)) {
        const atlas = lmTexOf(m);
        if (atlas && o.geometry.attributes.uv1) {
          const et = envTexOf(m);
          const props = (m.userData && m.userData.env) || {};
          // 细节层（B1）：与光照图/环境反射可共存
          const dtex = ud.detail ? detailTexOf(m) : null;
          // 逐实例光照图 UV 变换走 aLm 实例属性（见 sceneryInstancing.buildInstancedMesh），
          // 与材质无关 ⇒ 按输入指纹缓存共享（同 glTF 材质的多节点实例拿到同一份材质）。
          return cachedSceneryMat(['LM', m.uuid, atlas.uuid,
            et ? [et[0].uuid, et[1].uuid, JSON.stringify(props)].join('|') : '',
            dtex ? [dtex.uuid, JSON.stringify(ud.detail.scale || null)].join('|') : ''].join('#'),
            () => makeLightmappedMaterial(m, atlas,
              et ? { maskTex: et[0], cubeTex: et[1], props } : null,
              dtex ? { tex: dtex, scale: ud.detail.scale } : null));
        }
      }
      const maskTex = ud.blendLayer ? maskTexOf(m) : null;
      if (maskTex && o.geometry.attributes.uv1) return makeBlendLayerMaterial(m, maskTex);
      // 水下静态件（兜底口径）：客户端折射通道 `VIEW_DIFFUSE=0` ⇒ `color = albedo`
      // （不乘 2、不受光）——正是 MeshBasicMaterial 的口径。
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
    o.material = Array.isArray(o.material) ? o.material.map(assignMat) : assignMat(o.material);
    // 水体（海平面等半透明大面）：透明 + depthWrite=true + DoubleSide 会与地形/自身共面
    // 产生 z-fighting 与透明互遮挡闪烁；其几何极简且为全场唯一透明物 ⇒ 正常写深度最稳。
    // 不设 renderOrder：交给 THREE 在透明队列内按摄像机距离排序。
    if (isWaterNode(o.name, o.material, { strictSurfaces })) {
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
      // 包围球按锚点计算，角点向外超出——扩 2m 防视锥剔除边缘闪没
      if (o.geometry.boundingSphere) o.geometry.boundingSphere.radius += 2;
    }
  });
  // 动画混合层材质登记：uTime 每帧写回放秒数（运行时）；烘焙单帧不消费
  const animLayerMats = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const mm of ms) {
      // 任何带 uTime 的材质都按回放时钟驱动（混合层的 uShiftRate、水面的 uShift0/1）
      if (mm && mm.uniforms && mm.uniforms.uTime) animLayerMats.push(mm);
    }
  });
  return { animLayerMats, skyMeshes };
}
