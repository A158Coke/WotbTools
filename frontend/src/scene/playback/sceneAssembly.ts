// 场景装配 owner（2026-11-22 自 playbackScene.js 闭包出仓，纯搬移）：渲染器/场景核心初始化、
// 地图世界与水面反射、车辆/履带/战斗/标注/标签/相机运行时、基地与出生点标记、相机地形夹取。
// 依赖读取统一经宿主对象 S；构造顺序与搬移前一致。
import { disposeObject3D } from '../materialDispose.js'
import { COLOR_UNKNOWN, TRACER_FRIENDLY, TRACER_ENEMY, teamColorOf } from './palette.ts'
import { createSceneCore } from './renderer.js'
import { createMapWorld } from './mapWorld.ts'
import { createWaterReflectionRuntime } from './waterReflectionRuntime.ts'
import { createVehicleRuntime } from './vehicleRuntime.ts'
import { createBattleMarkerHost } from './battleMarkerHost.ts'
import { createTreadRuntime } from './treadRuntime.ts'
import { createBattleRuntime } from './battleRuntime.ts'
import { createAnnotationScene } from './annotationScene.ts'
import { createLabelsRuntime } from './labelsRuntime.ts'
import { createCameraRuntime, CAMERA_GROUND_CLEARANCE } from './cameraRuntime.ts'
import { qualityFeatures } from './quality.js'
import { createPickReporter } from './pickReport.js'
import { createCameraTerrainClamp } from './cameraTerrainClamp.js'
import { createBaseMarkers } from './bases.js'
import { createSpawnMarkers } from './spawns.js'
import type { Host } from '../playbackScene.js'
import { bind } from '../hostBind.ts'

export function installSceneAssembly(S: Host) {
  Object.assign(S, {
    initScene: bind(S, initScene),
    onResize: bind(S, onResize),
    reportPick: bind(S, reportPick),
    teamColor: bind(S, teamColor),
    buildBases: bind(S, buildBases),
    clearBases: bind(S, clearBases),
    regroundBases: bind(S, regroundBases),
    updateBases: bind(S, updateBases),
    buildSpawns: bind(S, buildSpawns),
    clearSpawns: bind(S, clearSpawns),
    regroundSpawns: bind(S, regroundSpawns),
    refreshSpawnColors: bind(S, refreshSpawnColors),
    applyCameraClamp: bind(S, applyCameraClamp),
    terrainHeightForCameraClamp: bind(S, terrainHeightForCameraClamp),
    clampOrbitCameraToTerrain: bind(S, clampOrbitCameraToTerrain),
    clampCameraTarget: bind(S, clampCameraTarget),
  })

  // ---------- 场景 ----------
  function initScene(S: Host) {
    // 创建核心（渲染器/相机/控件/灯光/resize+pointer 接线）在 playback/renderer.js
    //（2026-10-24 Step A2 出仓；状态所有权仍在本闭包——解构写回可变绑定）
    const core = createSceneCore({
      container: S.container, quality: S.Q, logdepth: S.LOGDEPTH, dynres: S.DYNRES, stencil: S.contactShadowCtl.wantsStencil(), debug: S.DEBUG,
      envTexture: S.mapWorld.envTexture(), envMultiplier: S.mapWorld.envMultiplier(),
      onResize: S.onResize, onPointerDown: S.cameraRuntime.onScenePointerDown, onPointerUp: S.cameraRuntime.onScenePointerUp,
      setFollow: (eid: number | null) => S.cameraRuntime.setFollow(eid),
    });
    S.scene = core.scene; S.camera = core.camera; S.renderer = core.renderer;
    S.controls = core.controls; S.clock = core.clock; S.raycaster = core.raycaster;
    S.gpu?.attach(S.renderer);
    S.cameraRuntime.applyMobileTouchControls();
    S.hemiLight = core.hemiLight; S.sunLight = core.sunLight;
    S.dynResCtl = core.dynResCtl; S.sizeObserver = core.sizeObserver; S.rendererCaps = core.rendererCaps;
    // annotation 段收口（#820 Step 5）：独立 raycaster 重建 + 5 个 capture 监听 + layer
    // 就绪 + 触摸模式（原逐行实现的等价入口，见 playback/annotationScene.ts）。
    S.annotationScene.attachListeners();
    // FPS 飞行接管 + top/follow 滚轮拦截（#835）的 container capture 监听收口
    //（原 6 行 addEventListener 段等价入口，见 playback/cameraRuntime.ts）。
    S.cameraRuntime.attachListeners();
    if (S.cameraRuntime.cam() === 'free') S.cameraRuntime.flyLookApplyMode('free');   // 初始 CAM 可能已是 'free'（默认值）
  }
  function onResize(S: Host) {
    if (!S.renderer) return;
    // 容器可能随名册布局改变高度；画布与投影必须跟随实际容器。
    const w = Math.max(1, Math.round(S.container.clientWidth));
    const h = Math.max(1, Math.round(S.container.clientHeight));
    S.camera.aspect = w / h;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(w, h);
    S.invalidate();            // 视口变化：下一帧必须重绘
  }
  // ---------- 点击拾取调试（PICK_DEBUG；报告器在 playback/pickReport.js，纯函数在 pickDebug.js） ----------
  S.pickDownAt = null;
  S.pickReporter = createPickReporter();
  // 事件时刻的 ctx 快照（闭包内均为可变绑定，工厂创建期捕获会过期——契约见 pickReport.js 头注释）
  S.pickCtx = () => ({
    clock: S.T, vehicles: S.vehicles.getVehicles(), scenery: S.mapWorld.mapScenery(), terrainMesh: S.mapWorld.terrainMesh(), groundMesh: S.mapWorld.groundMesh(),
    destruct: S.mapWorld.destruct(), destructPickList: S.mapWorld.destructPickList(), meshOwner: S.mapWorld.meshOwner(), heightField: S.mapWorld.heightField(), heightMeta: S.mapWorld.heightMeta(),
    camera: S.camera, raycaster: S.raycaster, container: S.container, scene: S.scene, terrainSpan: S.mapWorld.terrainSpanOf(),
  });
  function reportPick(S: Host, e: PointerEvent) { S.pickReporter.reportPick(e, S.pickCtx()); }
  // 报告组装/面板/标记的实现自 2026-10-24 起在 playback/pickReport.js（工厂 + ctx 快照）。

  // 世界/地形/地图资产 owner（#820 Step 2 出仓）：buildWorld / loadMapImage / sampleHeight /
  // 地形 LOD / rebuildGround / 可破坏物推进 / 逐图光照接线 + 会话 teardown 的地图资产段。
  S.mapWorld = createMapWorld({
    store: S.store,
    debug: S.DEBUG,
    perf: () => S.perf,
    sessionEpoch: () => S.session.sessionEpoch(),
    destroyed: () => S.destroyed,
    getData: () => S.DATA,
    quality: () => S.Q,
    grassInstanceBudget: () => qualityFeatures(S.QKEY).grass.instances,
    getScene: () => S.scene,
    getCamera: () => S.camera,
    getRenderer: () => S.renderer,
    getControls: () => S.controls,
    invalidate: S.invalidate,
    disposeObject3D,
    constrainFreeCameraAltitude: () => S.cameraRuntime.constrainFreeCameraAltitude(),
    regroundBases: S.regroundBases,
    regroundSpawns: S.regroundSpawns,
    // annotation 派生缓存重建（owner = annotationScene；晚绑定箭头——工厂创建期不触碰）
    rebuildAnnotationProjection: () => S.annotationScene.rebuildAnnotationProjection(),
    reprojectAnnotationHeights: () => S.annotationScene.reprojectAnnotationHeights(),
    scopedHiddenEid: () => S.cameraRuntime.scopedHiddenEid(),
    onTerrainReground: () => S.contactShadowCtl.handle()?.reground(),   // 接地阴影随地形重建贴回
    onLightingApplied: () => S.contactShadowCtl.handle()?.syncSun(),   // 逐图光照后同步太阳
    lightingTargets: () => ({ renderer: S.renderer, scene: S.scene, sunLight: S.sunLight, hemiLight: S.hemiLight, debug: S.DEBUG }),
    buildWorldCameraPlacement: (center) => {
      const { cx, cz, ext } = center;
      // 用户操作过的自由视角跨回放保留；跟随目标不跨回放，仍回到默认机位。
      if (S.cameraRuntime.topViewOnLoad() || S.cameraRuntime.cam() !== 'free') {
        S.camera.position.set(cx, ext * 1.1, cz + ext * 1.2);
        S.controls.target.set(cx, 0, cz);
      }
      S.applyCameraClamp();   // 世界范围决定 min/max 距离（初值，实测再调）
    },
  });

  // 水面 HIGH/ULTRA 动态平面反射（画质计划 W1/P1/W3）：镜像相机 + 半分辨率 RT，
  // 画质语义/反射 pass 覆盖层剔除/运行时改档收口在 waterReflectionRuntime.ts。
  S.waterReflection = createWaterReflectionRuntime({
    getWaterMeshes: () => S.mapWorld.waterMeshes(),
    getWaterLevel: () => S.mapWorld.waterLevel(),
    // 反射 pass 覆盖层剔除（W3）：草/战斗特效/3D 标注不进镜像 RT。
    getExcludedRoots: () => [S.mapWorld.grassRoot(), S.battle.fxRoot(), S.annotationScene.annotationRoot()],
    qualityKey: () => S.QKEY,
    debug: S.DEBUG,
  });
  S.applyQualityFeatures = () => S.waterReflection.apply();
  S.requestWaterReflectionRefresh = () => S.waterReflection.requestRefresh();
  // 车辆运行时 owner（#820 Step 4 出仓）：buildVehicles / 位姿采样 / GLB / 悬挂 /
  // applyPose 与车辆 teardown 的唯一归属。canonical 生命事实（sceneLifeAt/visibleAt）
  // 与调色板仍在本闭包，按 deps 注入；POSE_GRID 按引用共享同一可变对象。
  S.vehicles = createVehicleRuntime({
    store: S.store,
    destroyed: () => S.destroyed,
    sessionGen: () => S.session.sessionGen(),
    getScene: () => S.scene,
    getT: () => S.T,
    getData: () => S.DATA,
    quality: () => S.Q,
    teamColor: (v) => S.teamColor(v),
    classIconsVisible: () => S.labels.classIconsVisible(),
    showMarkerStatus: () => S.labels.showMarkerStatus(),
    invalidate: S.invalidate,
    onGlbAttached: (eid) => S.cameraRuntime.refreshFollowMinDistance(eid),
    visibleAt: (v, t) => S.visibleAt(v, t),
    sceneLifeAt: (v, t) => S.sceneLifeAt(v, t),
    // 身份替换判据（幽灵抑制；唯一消费方是车辆运行时，勿挪到 treadRuntime）
    replacedAt: (eid, t) => S.replacedAt(eid, t),
    sampleHeight: (x, z) => S.mapWorld.sampleHeight(x, z),
    // 晚绑定解环：vehicles 需要 tread.attachVehicle（buildVehicles 的履带装配段）、
    // tread 需要 vehicles 的位姿采样与车辆清单。buildVehicles 只在运行期调用，届时
    // 两个工厂都已构造完成（箭头闭包按引用读 tread，不按值捕获）。
    treadAttachVehicle: (v) => S.tread.attachVehicle(v),
    disposeObject3D,
    poseGrid: S.POSE_GRID,
    visByEid: () => S.VIS_BY_EID,
    contactShadows: () => S.contactShadowCtl.handle(),   // 逐车阴影挂接/同步（#907 主干随迁）
    scopedHiddenEid: () => S.cameraRuntime.scopedHiddenEid(),
  });
  // 3D 战场快捷标记 owner（0x2e markers + 0x2f attention_to_cell）：场景事件源与
  // 回放时钟窗口状态在 playback/markerRuntime.ts；本句柄把车辆位姿/名册/地图语义
  // 接到运行时，并供 labelsRuntime 投影来源卡。DATA 类型面由本模块按 markers/chat_events
  // 消费子集收窄（会话数据本身来自上游契约，不做运行时改写）。
  S.battleMarkers = createBattleMarkerHost({
    getScene: () => S.scene,
    mapWorld: S.mapWorld,
    vehicles: S.vehicles,
    visibleAt: (v, t) => S.visibleAt(v, t),
    replacedAt: (eid, t) => S.replacedAt(eid, t),
    getT: () => S.T,
    getData: () => S.DATA,
    invalidate: S.invalidate,
  });
  // 地面履带印 owner（#820 Step 4 出仓）：逐车参数/贴图缓存、网格装配、路径喂样与
  // 游标泵的唯一归属；会话 teardown 的履带段（逐车 treadMesh + 共享贴图）在其 dispose。
  S.tread = createTreadRuntime({
    store: S.store,
    quality: () => S.Q,
    getScene: () => S.scene,
    destroyed: () => S.destroyed,
    invalidate: S.invalidate,
    getT: () => S.T,
    getStart: () => S.START,
    getData: () => S.DATA,
    getVehicles: () => S.vehicles.getVehicles(),
    vehicles: S.vehicles,
    visibleAt: (v, t) => S.visibleAt(v, t),
    heightAt: (x, z) => S.mapWorld.sampleHeight(x, z),
    heightFieldReady: () => !!S.mapWorld.heightField(),
  });

  // 战斗表现 owner（#820 Step 5 出仓）：弹道推进/炮口/曳光/弹着/击毁爆炸/战斗特效批次/
  // 残骸烟相位/动态层清除/战斗反馈 transient 的唯一归属。canonical 生命事实
  //（sceneLifeAt/deathTimesOf）与调色板仍在本闭包，按 deps 注入。
  S.battle = createBattleRuntime({
    getData: () => S.DATA,
    getT: () => S.T,
    getScene: () => S.scene,
    getCamera: () => S.camera,
    getViewportHeight: () => S.container.clientHeight,
    debug: S.DEBUG,
    getVehicles: () => S.vehicles.getVehicles(),
    vehicles: S.vehicles,
    sceneLifeAt: (v, t) => S.sceneLifeAt(v, t),
    colorUnknown: COLOR_UNKNOWN,
    tracerFriendly: TRACER_FRIENDLY,
    tracerEnemy: TRACER_ENEMY,
    invalidate: S.invalidate,
    deathTimesOf: (v) => S.deathTimesOf(v),
    qualityFx: () => S.Q.fx,
    // 标签快照失效（owner = labelsRuntime 的 labelsTime；晚绑定箭头——labels 工厂在其后构造）
    getLabelOverlay: () => S.labelOverlay,
    invalidateLabels: () => S.labels.invalidateLabels(),
  });

  // 3D annotation 场景层 owner（#820 Step 5 出仓）：GPU 资源/rebuild 编排/地表拾取/
  // pointer 手势状态机。相机/共享 raycaster/controls 来自渲染器核心；世界事实经 mapWorld
  // 句柄消费。事件监听注册/摘除收口为 attachListeners()/detach()。
  S.annotationScene = createAnnotationScene({
    container: S.container,
    debug: S.DEBUG,
    perfEnabled: () => !!S.PERF,
    invalidate: S.invalidate,
    getScene: () => S.scene,
    getCamera: () => S.camera,
    getRaycaster: () => S.raycaster,
    getControls: () => S.controls,
    mapWorld: S.mapWorld,
    annotationSurfaceHeightAt: (x, z) => S.mapWorld.annotationSurfaceHeightAt(x, z),
    onAnnotationCommit: S.onAnnotationCommit,
    onAnnotationErase: S.onAnnotationErase,
  });

  // 标签运行时 owner（#820 Step 5 出仓）：软遮挡/名牌发布/会话 resolver/击杀 feed 计分名册。
  // writeHud（时钟+相机+名册编排）、teamHpTotals、applySupremacyPointsToStore 仍在本闭包。
  S.labels = createLabelsRuntime({
    store: S.store,
    container: S.container,
    getCamera: () => S.camera,
    getRaycaster: () => S.raycaster,
    getData: () => S.DATA,
    getT: () => S.T,
    getVehicles: () => S.vehicles.getVehicles(),
    getSessionGen: () => S.session.sessionGen(),
    getFollowEid: () => S.cameraRuntime.followEid(),
    deathAt: S.deathAt,
    hpAt: S.hpAt,
    visibleAt: S.visibleAt,
    visByEid: () => S.VIS_BY_EID,
    scopedHiddenEid: () => S.cameraRuntime.scopedHiddenEid(),
    sampleHeight: (x, z) => S.mapWorld.sampleHeight(x, z),
    heightField: () => S.mapWorld.heightField(),
    heightMeta: () => S.mapWorld.heightMeta(),
    mapScenery: () => S.mapWorld.mapScenery(),
    occlGrid: () => S.mapWorld.occlGrid(),
    transients: S.battle.transients,
    fxScale: () => S.battle.fxScale(),
    getLabelOverlay: () => S.labelOverlay,
    getMarkerLabelSources: () => S.battleMarkers.labelSources(),
    canonicalVehicles: () => S.store.playbackSession?.canonical?.dataset?.vehicles || [],
    invalidate: S.invalidate,
  });

  // annotation 地表采样 = 世界事实的唯一采样口径（mapWorld owner；消费经 annotationScene deps）。

  function teamColor(S: Host, v: { def: { team: unknown } }) {
    // SSOT 角色分流：team 3 / 未知 friendly_team 一律 neutral，不再落入 enemy。
    return teamColorOf(v.def.team as number, S.DATA.meta.friendly_team);
  }

  // ---------- 基地（争霸 A–D / 单基地）贴地标记（实现在 playback/bases.js；快照式工厂） ----------
  //（原节的语义注释与 fail-closed 判据随实现迁往该模块头）
  S.bases = createBaseMarkers({
    getScene: () => S.scene, getCamera: () => S.camera,
    getData: () => S.DATA, getMapBases: () => S.mapWorld.mapBases(),
    store: S.store, groundY: (x, z) => S.mapWorld.groundY(x, z),
  });
  // 回放会话：模式由 DATA 轨迹判（buildBases 原语义）；地图预览会话：宿主经
  // setMapBasesKind 显式选组，几何仍是唯一事实（bases.buildStatic 内部 fail-closed）。
  function buildBases(S: Host) {
    if (S.session.sessionMode() === 'map') S.bases.buildStatic(S.MAP_BASES_KIND);
    else S.bases.build();
  }
  function clearBases(S: Host) { S.bases.clear(); }
  function regroundBases(S: Host) { S.bases.reground(); }
  function updateBases(S: Host) { S.bases.update(S.T); }

  // ---------- 出生点贴地标记（#835；实现在 playback/spawns.ts；快照式工厂） ----------
  //（数据面 / 呈现口径 / fail-closed 判据见该模块头：宿主经 setMapSpawns 下发语义
  //  档案解析出的点列，回放会话不消费；几何 fail-closed 在 spawns.build 内部。）
  S.spawnMarkers = createSpawnMarkers({ getScene: () => S.scene, groundY: (x, z) => S.mapWorld.groundY(x, z) });
  function buildSpawns(S: Host) { S.spawnMarkers.build(S.session.sessionMode() === 'map' ? S.MAP_SPAWN_POINTS : null); }
  function clearSpawns(S: Host) { S.spawnMarkers.clear(); }
  function regroundSpawns(S: Host) { S.spawnMarkers.reground(); }
  /** UI Profile 切换后 token 色板变化（四季主题切换）：已有出生点
   *  材质原位重着色——不重建场景、不动相机。仅 map 会话有意义（回放无出生点）。 */
  function refreshSpawnColors(S: Host) {
    if (S.session.sessionMode() !== 'map') return;
    S.spawnMarkers.refreshColors();
    S.invalidate();
  }

  // 相机地形净空与 target 钳制（#820 Wave B6A：实现与语义注释在
  // playback/cameraTerrainClamp.js）。本处只注入场景侧的事实来源。
  S.cameraTerrainClamp = createCameraTerrainClamp({
    getCamera: () => S.camera,
    getControls: () => S.controls,
    // cameraDriven 归相机运行时：经箭头延迟求值，工厂创建期不触碰。
    cameraDriven: () => S.cameraRuntime.cameraDriven(),
    getTerrainMesh: () => S.mapWorld.terrainMesh(),
    getHeightField: () => S.mapWorld.heightField(),
    getHeightMeta: () => S.mapWorld.heightMeta(),
    sampleRenderedTerrainHeight: (x, z) => S.mapWorld.sampleRenderedTerrainHeight(x, z),
    sampleHeight: (x, z) => S.mapWorld.sampleHeight(x, z),
    clearance: CAMERA_GROUND_CLEARANCE,
    getWorldCenter: () => S.mapWorld.worldCenter(),
    isFollowing: () => !!S.cameraRuntime.followEid(),
    followMinDistance: () => S.cameraRuntime.followMinDistance(),
  });
  function applyCameraClamp(S: Host) { S.cameraTerrainClamp.applyCameraClamp(S.mapWorld.worldCenter().ext); }
  function terrainHeightForCameraClamp(S: Host, x: number, z: number) { return S.cameraTerrainClamp.terrainHeightForCameraClamp(x, z); }
  function clampOrbitCameraToTerrain(S: Host) { return S.cameraTerrainClamp.clampOrbitCameraToTerrain(); }
  function clampCameraTarget(S: Host) { S.cameraTerrainClamp.clampCameraTarget(); }

  // 相机运行时 owner（#820 Step 4 出仓）：fly 接管 / 滚轮缩放平滑 / setCam·setFollow /
  // topViewOnLoad / 俯视机位 / 录像者视角域 / 穿深着色 / 场景选中语义的唯一归属。
  // 相机地形净空（cameraTerrainClamp）仍在本闭包，经 deps 回调注入；canonical 生命
  // 事实（deathAt/deathTimesOf）、?perf 域与 ARMOR_HIGHLIGHT 偏好仍在本闭包。
  S.cameraRuntime = createCameraRuntime({
    store: S.store,
    container: S.container,
    debug: S.DEBUG,
    getCamera: () => S.camera,
    getRenderer: () => S.renderer,
    getControls: () => S.controls,
    getRaycaster: () => S.raycaster,
    getScene: () => S.scene,
    invalidate: S.invalidate,
    getT: () => S.T,
    getData: () => S.DATA,
    sessionEpoch: () => S.session.sessionEpoch(),
    destroyed: () => S.destroyed,
    writeHud: S.writeHud,
    updateRoster: () => S.labels.updateRoster(),
    vehicles: S.vehicles,
    mapWorld: S.mapWorld,
    annotationScene: S.annotationScene,
    deathAt: (v, t) => S.deathAt(v, t),
    deathTimesOf: (v) => S.deathTimesOf(v),
    gpu: () => S.gpu,
    perfEnabled: () => !!S.PERF,
    armorHighlightPref: () => S.ARMOR_HIGHLIGHT,
    recorderReticle: S.recorderReticle ?? null,
    clampCameraTarget: S.clampCameraTarget,
    clampOrbitCameraToTerrain: S.clampOrbitCameraToTerrain,
    baseMinDistance: () => S.cameraTerrainClamp.baseMinDistance(),
    terrainHeightForCameraClamp: S.terrainHeightForCameraClamp,
    onVehicleSelect: S.onVehicleSelect ?? null,
    pickDebug: () => S.PICK_DEBUG,
    syncContactShadow: (v) => S.vehicles.syncContactShadow(v),
    getPickDownAt: () => S.pickDownAt,
    setPickDownAt: (p) => { S.pickDownAt = p; },
    reportPick: S.reportPick,
  });
}
