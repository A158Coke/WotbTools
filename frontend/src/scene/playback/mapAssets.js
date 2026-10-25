// 场景 GLB 装配（2026-10-24 自 loadMapImage 闭包出仓，拆分计划见 docs/current-plan.md
// Step A3；代码与搬移前逐字一致，仅闭包读数改经 ctx、闭包写回改经返回的 writes）。
// 覆盖：变体裁剪 → extras 贴图/材质分派 → 水面海岸线资源 → 走廊掩码 → 实例化合批 →
// 遮挡候选格 → 可破坏物槽位装配 → 静态子树矩阵冻结。
//
// ctx 契约（调用时刻快照/回调）：DATA/Q/DEBUG/camera/renderer/scene/controls/terrainMesh/
// groundLayers/heightField/heightMeta/terrainSpan 为当值；stale()/disposeObject3D/
// noteAsset/sampleHeight/onRefineMaskBuilt/destructDocPromise 为回调或 Promise。
// 返回 { stale, writes }：stale=true 表示装配中途会话过期（调用方先落已完成的
// writes 再 return，与原闭包逐段赋值 + 中途 return 的语义一致）；writes 只含已推进到的字段。
import * as THREE from 'three'
import { sceneHasSkyFlags, strictSurfacesOf, isWaterNode as isWaterNodeRule } from '../sceneryAssemblyRules.js'
import { resolveSceneryExtras, makeTexResolvers, assembleSceneryMaterials } from '../sceneryAssembly.js'
import { applyMaterialTextureAnisotropy } from '../sceneryMaterials.js'
import { pruneForeignVariantsDetailed } from '../variantFilter.js'
import { makeWaterCoast, buildCorridorRefineMask } from '../groundPass.js'
import {
  collectInstanceEntries, groupInstanceBatches, buildInstancedMesh, buildStandaloneLightmappedMeshes,
  writeHiddenInstance, refreshBatchSphere, hasTransparentMaterial,
} from '../sceneryInstancing.js'
import { buildMeshOwnerMap } from '../pickDebug.js'
import { buildDestructibleIndex, foldDestructibleStates, fallStopAngle } from '../destructibles.js'
import { occlusionFootprintCells } from './pure.js'

// 标签遮挡候选格边长（16m，见 occlusionCells/occlusionFootprintCells 注释）
const OCCL_CELL = 16;

export async function assembleMapScenery(gltf, ctx) {
  const { DATA, Q, DEBUG, groundLayers } = ctx;
  const writes = {};
  // 包级天空标记必须在**变体裁剪之前**采样：变体组里的唯一 sky 节点被裁掉后，
  // 再从缩减场景重算会退化为 false 并误启 /sky/ 名字 fallback（烘焙同理）。
  const skyFlagsAvailable = sceneHasSkyFlags(gltf.scene);
  const variantMappingIncomplete = gltf.scene.userData?.variantMappingIncomplete === true;
  // 变体裁剪（must 在材质转换/网格索引/遮挡登记之前）：多变体地图
  // （Dead Rail 等 9 图）的场景 GLB 按 space 共享，组外布景不剔除即成
  // 幻影物体——游戏一局只激活 LabelComponent 变体组中的一组。映射与
  // 节点标签由导出器随 GLB extras 下发；有变体节点但没有可用映射时
  // 消费端 fail-closed（隐藏全部带标记节点），不再全量渲染。
  const variantPrune = pruneForeignVariantsDetailed(gltf.scene, DATA.meta.map_id);
  const prunedVariants = variantPrune.removed;
  if (prunedVariants && DEBUG) window.__prunedVariantNodes = prunedVariants;
  if (variantMappingIncomplete || variantPrune.failClosed) {
    // fail-closed 裁剪（映射缺失/当前 map_id 不在映射，或导出器标记映射不完整）
    // 隐藏了变体节点：这是场景内容缺失，必须进入降级状态，不能只留 console.warn。
    ctx.noteAsset('scenery', 'variant-fail-closed', variantMappingIncomplete
      ? '导出器标记变体映射不完整，已 fail-closed 隐藏带标记节点'
      : '变体映射缺失/未知，已隐藏全部带标记节点');
  }
  // extras 贴图预解析（mask/lightmap/detail/env/water/decal）——共享模块同一实现
  const sceneryExtras = await resolveSceneryExtras(gltf);
  if (ctx.stale()) { ctx.disposeObject3D(gltf.scene); return { stale: true, writes }; }
  const strictSurfaces = strictSurfacesOf(gltf.scene);
  const isWaterNode = (name, mat) => isWaterNodeRule(name, mat, { strictSurfaces });
  // 材质→贴图解析器（键 = gltf.parser.associations 的材质下标）：装配模块同源的
  // makeTexResolvers，六个槽同表（mask/lm/detail/env/water/decal）
  const { maskTexOf, lmTexOf, detailTexOf, envTexOf, waterTexOf, decalTexOf } =
    makeTexResolvers(gltf, sceneryExtras);
  // 退化几何隔离（旧版导出器撕裂批次）已删除：按 (三角形/顶点) 比率逐网格
  // 判废是内容统计启发式，无法区分"旧导出器损坏"与合法高比率网格，且会静默
  // 删掉数据。树批次撕裂已由导出器修正；若未来再出现几何损坏，应由导出器写
  // 语义标记或 fail-closed 报错，不得在消费端按比率猜。
  // 场景网格清单（材质转换段顺带收集；`water` = 任一材质带 extras.water ⇒ 水面/水下片）：
  // 供"贴地薄构件走廊掩码"的类筛选用——必须在"实例化合批"之前取样（合批会换掉逐节点 Mesh）。
  // 见 terrainRefineMask 声明处的方案说明。
  const sceneryMeshes = [];
  // 水面"海岸线"（客户端 water-fp.sl 的 coastLine，见 makeWaterMaterial 注释）用的共享资源：
  // 高度场（真值，与地形网格/深度缓冲同一份）做成可线性滤波的浮点纹理。
  // 资源构造在共享模块 groundPass.makeWaterCoast（俯视烘焙同一份）；本处只探测
  // 深度位深（上下文实测）与相机 near/far，并登记会话 teardown 释放。
  let waterCoast = null;
  if (ctx.heightField && ctx.heightMeta) {
    try {
      const hn = ctx.heightMeta.size || 512;
      if (ctx.heightField.length === hn * hn) {
        // 深度分辨率（海岸线淡出阈值的量纲）：由**上下文实测**的深度位深推 ulp，
        // near/far 取相机实际值（本渲染器 0.5/4000）——阈值全程无手调常数。
        let depthBits = 24;
        try {
          const glc = ctx.renderer && ctx.renderer.getContext && ctx.renderer.getContext();
          const b = glc && glc.getParameter && glc.getParameter(glc.DEPTH_BITS);
          if (Number.isFinite(b) && b >= 16 && b <= 32) depthBits = b;
        } catch (e) { /* 取不到按 24bit 缺省 */ }
        waterCoast = makeWaterCoast({
          field: ctx.heightField, n: hn, span: ctx.terrainSpan,
          near: ctx.camera && Number.isFinite(ctx.camera.near) ? ctx.camera.near : 0.5,
          far: ctx.camera && Number.isFinite(ctx.camera.far) ? ctx.camera.far : 4000,
          depthBits,
        });
        writes.waterTexDispose = waterCoast.heightTex;    // 会话 teardown 释放
        // 诊断钩子（同一 ?debug 惯例）：确认"水面用的高度场/跨度"真的下发到了水面材质——
        // 用于把"画面没变化"区分为"页面跑的是旧包"与"另因"（控制台可读，不需目视）。
        if (DEBUG) window.__waterCoast = { present: true, span: waterCoast.mapSpan, materials: 0 };
      }
    } catch (e) { console.warn('水面海岸线高度场创建失败（按不淡出继续）:', e); }
  }
  // ---- 逐节点材质分派（SSOT：src/scene/sceneryAssembly.js，与俯视烘焙同一份）----
  // 内含：水面片收集/underWater 判据 → 天空穹（材质标记先于名字）→ 水/贴花/光照图
  // （+env+detail）/混合层掩码/水下/convMat → 水面深度修整；onMesh 钩子即走廊掩码取样
  // （必须在实例化合批前，本函数正处该阶段）。
  const { animLayerMats: assembledAnimMats } = assembleSceneryMaterials(gltf, {
    strictSurfaces,
    masks: { maskTexOf, lmTexOf, detailTexOf, envTexOf, waterTexOf, decalTexOf },
    groundLayers, waterCoast, debug: DEBUG,
    onMesh: (o, waterMarked) => { sceneryMeshes.push({ o, water: waterMarked }); },
    skyFlagsAvailable,
  });

  // 动画混合层材质（uTime 每帧写回放秒数）由装配模块登记返回；暂停即停、seek 后相位确定。
  writes.animLayerMats = assembledAnimMats;
  if (DEBUG) window.__animLayerMats = assembledAnimMats.length;

  // 场景 GLB 贴图各向异性：地面（分层地表）早按画质档设了，场景侧此前漏设 ——
  // 掠射角下建筑/道路贴图发糊并随镜头闪烁。逐纹理设一次（同贴图跨材质共享）。
  const aniso = Math.min(Q.anisotropy, ctx.renderer.capabilities.getMaxAnisotropy());
  const anisoTextures = applyMaterialTextureAnisotropy(gltf.scene, aniso);
  if (DEBUG) window.__sceneryAniso = { value: aniso, textures: anisoTextures };

  const mapScenery = new THREE.Group();
  mapScenery.rotation.order = 'YXZ';
  mapScenery.rotation.set(-Math.PI / 2, Math.PI, 0);
  mapScenery.add(gltf.scene);
  ctx.scene.add(mapScenery);
  writes.mapScenery = mapScenery;
  // 挂载即归属当前会话（评审 P1 复核）：group/水面纹理在 destructibles 悬挂期间也必须
  // 被 teardownSession 认领（宿主绑定立即拿到引用，恢复原闭包「装配即赋值」语义）——
  // 否则 reset/切场时这些资源无人释放，直到（可能永不）resolve 的请求返回。
  ctx.onSceneryMounted(mapScenery, waterCoast ? waterCoast.heightTex : null);

  // ---- 贴地薄构件走廊掩码（B：走廊强制细分）----
  // 实现（类判据/足迹取样/掩码生成）在共享模块 groundPass.buildCorridorRefineMask——
  // 俯视烘焙同一份（2026-10-14 用户报"轨道被下方地形遮挡"：烘焙此前未接入本机制）。
  // 必须在"实例化合批"之前做（合批会换掉逐节点 Mesh）；掩码只影响细分层级、不改高度值；
  // GLB 先于/后于地形加载都成立（后到时重建时取用）。
  if (sceneryMeshes.length && ctx.heightField) try {
    mapScenery.updateMatrixWorld(true);
    const built = buildCorridorRefineMask({
      meshes: sceneryMeshes, field: ctx.heightField,
      n: ctx.heightMeta?.size || 512, span: ctx.heightMeta?.span || 600,
    });
      if (built) {
        writes.terrainRefineMask = built.mask;
        if (DEBUG) window.__terrainRefineMask = { meshes: built.candidates, texels: built.texels };
        // 地形通常已先建好（地面段在前）⇒ 立刻重算一次（terrainLodStale(null,…) 恒真）。
        // mask 经回调参数交给宿主**先写入 terrainRefineMask 再重建**（评审 P2：宿主绑定
        // 仍为 null 时重建会拿到空掩码，且 terrainLodPrev 置当前后不再失效——走廊细分丢失）
        if (ctx.terrainMesh && ctx.camera && ctx.controls) ctx.onRefineMaskBuilt(built.mask);
      }
  } catch (e) { console.warn('走廊掩码构建失败（地形保持客户端口径）:', e); }

  // 天穹在材质转换段已换成 makeSkyMaterial 的无限远实现（此前整节点隐藏 →
  // 背景纯色 0x11161d）。草地仍无：导出器不生成草系统网格（GLB 内只有
  // dec_*_grass 静态装饰），见审计文档 P2。

  // ---- 实例化合批（场景侧减负主刀）----
  // 导出器把每个实例导成独立节点，但**节点级共享 mesh/几何**（实测 malinovka
  // 3096 节点 / 142 唯一几何，~21× 复用）。GLTFLoader 逐节点建 Mesh → 每帧
  // draw call ≈ 节点数、场景图双遍历（updateMatrixWorld + projectObject）同量级，
  // 是中/高档场景侧最大的 CPU 开销。按 (geometry, material) 合并为 InstancedMesh：
  // 几何**零拷贝**复用，draw call 与场景图规模一起降到批次数。
  // 天空与水体不参与：天穹每图只有 1–2 个节点、无复用收益，且它已关视锥剔除
  // （顶点被当方向、包围球只是 ~10m 小球），入批只让剔除语义更绕；水面是全场
  // 唯一真透明物，保持独立节点让 three 按相机距离做透明排序（合批会把整批
  // 退化成一个排序单位）。
  gltf.scene.updateMatrixWorld(true);
  // 天穹排除按装配期语义标记（extras.sky 或旧包名字 fallback 都会打标）；
  // 不得再用 /sky/i 猜名字——新包天穹名可能不含 sky，旧实现会把它合批后丢失
  // frustumCulled=false 的无限远语义。
  const allEntries = collectInstanceEntries(gltf.scene);
  const batchable = (e) =>
    !(e.node.userData && e.node.userData.isSky)
      && !isWaterNode(e.name, e.material)
      && !hasTransparentMaterial(e.material);
  const entries = allEntries.filter(batchable);
  // 透明材质保留独立排序单位；其中带逐节点光照图变换的用单实例 InstancedMesh，
  // 以保留 aLm 变换（普通 Mesh 的非实例分支会按原始 uv1 采错 atlas 区域）。
  buildStandaloneLightmappedMeshes(allEntries.filter((e) =>
    !batchable(e)
      && hasTransparentMaterial(e.material)
      && !(e.node.userData && e.node.userData.isSky)
      && !isWaterNode(e.name, e.material)), gltf.scene);
  // 可破坏匹配索引（旧 meshGrid 语义）：展平位置 → entry，2cm 半径邻域查找
  const meshGrid = new Map();
  const gridKey = (x, y) => `${Math.round(x / 2)},${Math.round(y / 2)}`;
  for (const e of entries) {
    const k = gridKey(e.x, e.y);
    (meshGrid.get(k) || meshGrid.set(k, []).get(k)).push(e);
  }
  // 宫格分块：8×8（600m 图 → 75m/格）——整批跨全图的包围球会失去逐实例
  // 视锥剔除（镜头看半张图，视野外的实例也全量提交；林荫图极致档实测卡顿
  // 的主因）。分片后每片包围球局部化，剔除恢复到格粒度。
  // span 取地形 sidecar（地面段已装载）；缺失回退 600（与 python 管线一致）
  const cellSize = Math.max(75, (ctx.heightMeta?.span || 600) / 8);
  const batches = groupInstanceBatches(entries, cellSize);
  for (const b of batches) b.items.forEach((e, i) => { e.batch = b; e.idx = i; });
  for (const b of batches) { b.mesh = buildInstancedMesh(b); gltf.scene.add(b.mesh); }
  // 原节点摘除：几何/材质已由批次持有（GPU 只上传批次侧），原 Mesh 不再进渲染图
  for (const e of entries) e.node.removeFromParent();
  // D_ 损毁态实例初始隐藏：实例化后没有逐实例 visible，用「远处 + 微缩」矩阵
  // （精确零矩阵是奇异矩阵，raycast 求逆走 NaN 路径，见 writeHiddenInstance）。
  for (const e of entries) {
    if (e.name && e.name.startsWith('D_')) { writeHiddenInstance(e.batch.mesh, e.idx); e.hidden = true; }
  }
  // 隐藏槽位落位后重算批次球：可见实例用当前矩阵、隐藏的 D_ 槽位用 base
  // 位姿计入覆盖——three 的 union 会把 y=-1e6 的隐藏矩阵撑爆半径（剔除
  // 全失效），而只按可见重算又会让全 D_ 批次空球、损毁激活后被整批剔除
  // （评审二轮/五轮两次指出的两个方向）
  for (const b of batches) refreshBatchSphere(b.mesh, b, (e) => e.hidden);
  // 标签遮挡候选格（16m，见 occlusionCells 注释）：登记粒度 = 批次。射线候选走
  // InstancedMesh 逐实例球测（成本 ≈ 候选实例数 × 球测，配合 far 钳制与 4ms 预算
  // 化轮转可控）。足印仍按**合法实例**逐一枚举（occlusionFootprintCells 语义不变；
  // hidden 实例在 y=-1e6，不得参与，否则足印撑爆全图）。无名字的 mesh 与旧行为
  // 一致：可渲染但既不匹配可破坏物、也不当遮挡候选。
  // 匹配半径 **2cm**（导出器把同一实例的全部批次放在同一坐标上：实测 99.8% 实例
  // 的完好网格在 1cm 内、成对 D_ 网格在 5mm 内）——早期用 1.5m 半径会把**邻近实例**
  // 的网格一起卷进来（malinovka 579 棵树里 22 棵会拖走邻居几何：一棵树倒，旁边草丛
  // 跟着转）。半径收紧后邻居不再误配；无对应网格 = 该物体不在 GLB（不渲染）。
  const MESH_MATCH_R = 0.02;
  const occGrid = new Map();
  for (const b of batches) {
    if (!b.geometry.boundingSphere) b.geometry.computeBoundingSphere();
    const r = b.geometry.boundingSphere ? b.geometry.boundingSphere.radius : 0;
    for (const e of b.items) {
      if (e.hidden || !e.name) continue;
      const c = occlusionFootprintCells(e.x - r, e.y - r, e.x + r, e.y + r, OCCL_CELL);
      for (const key of c) {
        const list = occGrid.get(key);
        if (list) { if (!list.includes(b.mesh)) list.push(b.mesh); }
        else occGrid.set(key, [b.mesh]);
      }
    }
  }
  writes.occlGrid = occGrid;   // 遮挡检测的候选表（旧会话的由 teardown 置 null）
  const findMeshes = (px, py, wantDestroyed, r = MESH_MATCH_R) => {
    const out = [];
    const gx = Math.round(px / 2), gy = Math.round(py / 2);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const e of meshGrid.get(`${gx + dx},${gy + dy}`) || []) {
        const destroyedMesh = e.name.startsWith('D_');
        if (destroyedMesh === wantDestroyed && Math.hypot(e.x - px, e.y - py) <= r) out.push(e);
      }
    }
    return out;
  };
  const destructDoc = await ctx.destructDocPromise;
  // 会话守卫先于一切清单/诊断读取：A 的迟到响应不得覆盖 B 已装载的清单
  //（实测竞态：B 的相同网格点击报告从 id=202 变成 id=101）
  if (ctx.stale()) {
    // 中途过期（评审 P1 复核）：挂载时已通过 onSceneryMounted **无条件归属宿主**，
    // 此后生命周期（含释放）只由宿主 teardown 负责——这里不得自行摘除/释放。
    // 反例（评审给出的实际回归）：A 的 destructibles 悬挂期间开始加载 B（epoch 前进），
    // A 返回时被判 stale；若 B 随后解析失败，宿主不会 teardown（A 仍是当前会话），
    // 自行摘除会让 A 的布景消失而地形/其它对象仍在。stale 只丢弃结果、不碰资源。
    return { stale: true, writes: {} };
  }
  if (DEBUG) window.__destructStage = destructDoc
    ? (Array.isArray(DATA.destructible_events) ? `events-${DATA.destructible_events.length}` : 'no-events-old-wasm')
    : 'doc-missing';
  let destruct = null;
  let destructPickList = null;
  let meshOwner = null;
  if (destructDoc && Array.isArray(destructDoc.instances)) {
    destructPickList = destructDoc.instances;   // 守卫内发布（拾取用全量清单）
    meshOwner = buildMeshOwnerMap(destructPickList, findMeshes);
  }
  if (destructDoc && Array.isArray(DATA.destructible_events)) {
    const areasByEid = new Map((DATA.destructible_areas || []).map((a) => [a.eid, a]));
    const index = buildDestructibleIndex(destructDoc);
    const states = foldDestructibleStates(DATA.destructible_events, areasByEid, index);
    // 可破坏物**槽位化**：不再重挂 pivot——状态持 { mesh, idx, base } 槽位。
    // 树倒 = T(p)·R·T(−p)·base 逐实例矩阵（与旧 pivot 装配逐值等价，等价性由
    // sceneryInstancing.test.js 随机位姿锁定）；建筑换模 = 完好/损毁槽位在 base
    // 与隐藏矩阵之间翻转。pivot 原点/树高/停止角公式与旧实现逐项一致。
    const slotOf = (e) => ({ mesh: e.batch.mesh, idx: e.idx, base: e.matrix });
    for (const st of states) {
      const [px, py] = st.inst.pos;
      if (st.prop === 3) {
        const hits = findMeshes(px, py, false);
        if (!hits.length) continue;
        const pivotZ = hits[0].z;
        // 树高 = 各网格几何在 pivot 局部系（z 上）的上界 + 网格自身 z 偏移（= 0，
        // 同实例批次同锚点）——倒伏时长 T ∝ √(L/g) 用它（见 destructibles.js）。
        let heightM = 0;
        for (const h of hits) {
          const geo = h.geometry;
          if (!geo) continue;
          if (!geo.boundingBox) geo.computeBoundingBox();
          const bb = geo.boundingBox;
          if (bb) heightM = Math.max(heightM, (bb.max.z ?? 0) + (h.z - pivotZ));
        }
        st.slots = hits.map(slotOf);
        st.heightM = heightM;
        st.pivotPos = { x: px, y: py, z: pivotZ };
        st.fallQuat = { w: 1 };   // settled 自校验读的倒伏旋转（destructibles.js）
        st.upright = true;
        // 停止角 = 树干沿倒向**触地**的角度（客户端"停在地形上"，因而随位置/倒向变化）。
        // 高度场在**世界系**（见 rebuildGround 注释：世界 x = −场景局部 x），而 pivot 在
        // gltf.scene 局部系（z 上）→ 采样用 (lx, ly) → (世界 −lx, 世界 lz=ly)。
        // 无高度场（2D 资源平面）→ sampleHeight 恒 0，此时按平坦地面（90°）。
        st.stopRad = ctx.heightField
          ? fallStopAngle(st.fallDir, st.pivotPos, heightM, (lx, ly) => ctx.sampleHeight(-lx, ly))
          : Math.PI / 2;
      } else {
        st.intactSlots = findMeshes(px, py, false).map(slotOf);
        st.deadSlots = findMeshes(px, py, true).map(slotOf);
      }
    }
    destruct = { states, ptr: 0, lastT: -1, animating: false };
    // 动态批次包围球保守扩张（评审 P2 二轮修正）：树倒 = 绕基点旋转，树梢会
    // 伸出 buildInstancedMesh 按直立位算的包围球。扩张量必须计入**槽位实际
    // 变换**——heightM 是原型几何高度，导出节点带非均匀缩放（erlenberg
    // Spruce2 ≈ [3.1, 2.39, 2.39]）时实高可差数倍，未缩放扩张不保守（倒下
    // 仍漏剔除/漏拾取）。正确量 = 几何球经 s.base 变换后的世界球（含缩放），
    // 再算该球到 pivot 的最远距离 = |center−pivot| + radius；hidden 槽位
    // （y=-1e6）不参与。
    for (const st of states) {
      if (st.prop !== 3 || !st.slots) continue;
      for (const s of st.slots) {
        const sph = s.mesh.boundingSphere;
        if (!sph) continue;
        if (!s.mesh.geometry.boundingSphere) s.mesh.geometry.boundingSphere = sph.clone();
        const geo = s.mesh.geometry.boundingSphere;
        // 几何球经 base 变换：center 仿射变换，radius 按最大轴缩放（保守）
        const e = s.base.elements;
        const cx = e[0] * geo.center.x + e[4] * geo.center.y + e[8] * geo.center.z + e[12];
        const cy = e[1] * geo.center.x + e[5] * geo.center.y + e[9] * geo.center.z + e[13];
        const cz = e[2] * geo.center.x + e[6] * geo.center.y + e[10] * geo.center.z + e[14];
        const sx = Math.hypot(e[0], e[1], e[2]);
        const sy = Math.hypot(e[4], e[5], e[6]);
        const sz = Math.hypot(e[8], e[9], e[10]);
        const r = geo.radius * Math.max(sx, sy, sz);
        // 倒伏最远触及（以**批次球心**度量，评审四轮）：旋转保点到 pivot
        // 的距离 → 任一倒角下，树体所有点到 pivot 的距离 ≤ |p−c_geom|+r；
        // 到批次球心 c 的距离再 +|c−p|（多树共批时 c 与树位相差可达半格宽，
        // 漏掉这一项 = 单棵树测试过、同批双树反例仍 0 命中）。
        const dGeo = Math.hypot(cx - st.pivotPos.x, cy - st.pivotPos.y, cz - st.pivotPos.z);
        const dCenter = Math.hypot(
          sph.center.x - st.pivotPos.x,
          sph.center.y - st.pivotPos.y,
          sph.center.z - st.pivotPos.z);
        const need = dCenter + dGeo + r + 2;
        if (need > sph.radius) sph.radius = need;
      }
    }
    if (DEBUG) window.__destructStage = `ready states=${destruct.states.length}`;
    if (DEBUG) window.__destructDebug = () => ({
      events: (DATA.destructible_events || []).length,
      states: destruct.states.length,
      trees: destruct.states.filter((st) => st.slots).length,
      swaps: destruct.states.filter((st) => st.intactSlots).length,
      ptr: destruct.ptr,
    });
  }
  writes.destructPickList = destructPickList;
  writes.meshOwner = meshOwner;
  writes.destruct = destruct;
  // ---- 静态子树矩阵冻结 ----
  // 场景 GLB 至此全部定型（合批 + 可破坏槽位装配完成）：先 bake 一遍世界矩阵，再关
  // 全树 matrixAutoUpdate（three 对 autoUpdate 节点每帧**无条件**重 compose）。批次
  // 自身变换恒为单位阵；运行期唯一的变换写入是实例矩阵（树倒/换模翻转），它不走
  // 节点 matrix 路径、不受冻结影响（instanceMatrix.needsUpdate 局部上传）。
  mapScenery.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { o.matrixAutoUpdate = false; });
  mapScenery.matrixAutoUpdate = false;   // 根组旋转已 bake，永不再变；保持 true 会让
                                         // 每帧置脏 + force 传播把冻结整个击穿
  return { stale: false, writes };
}
