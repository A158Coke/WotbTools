import { createMapWorld } from './playback/mapWorld.ts'

import { disposeObject3D } from './materialDispose.js'
import { createWaterReflectionRuntime } from './playback/waterReflectionRuntime.ts'
import { createVehicleRuntime } from './playback/vehicleRuntime.ts'
import { COLOR_UNKNOWN, TRACER_FRIENDLY, TRACER_ENEMY, teamColorOf } from './playback/palette.ts'
import { createTreadRuntime } from './playback/treadRuntime.ts'
import { createBattleRuntime } from './playback/battleRuntime.ts'
import { createAnnotationScene } from './playback/annotationScene.ts'
import { createLabelsRuntime } from './playback/labelsRuntime.ts'
import { createBaseMarkers } from './playback/bases.js'
import { createSpawnMarkers } from './playback/spawns.js'
import { qualityFeatures } from './playback/quality.js'
import type { SceneParts, SceneParams, RuntimeVehicle } from './playback/sceneParts.types.js'

/** 工厂 deps 与其 getter 返回类型（cast 边界：S 袋是延迟初始化的，运行期才非空）。 */
type Deps<F extends (...args: never[]) => unknown> = Parameters<F>[0]
type Getter<D, K extends keyof D> = D[K] extends (...args: never[]) => infer R ? R : never

import { createBattleMarkerHost } from './playback/battleMarkerHost.ts'
import { createCameraTerrainClamp } from './playback/cameraTerrainClamp.js'
import { createCameraRuntime, CAMERA_GROUND_CLEARANCE } from './playback/cameraRuntime.ts'

export function psP2(S: SceneParts, P: SceneParams): void {
  const mapWorld = createMapWorld({
    store: P.store,
    debug: S.DEBUG,
    perf: () => S.perf,
    sessionEpoch: () => S.session.sessionEpoch(),
    destroyed: () => S.destroyed,
    getData: () => S.DATA as Getter<Deps<typeof createMapWorld>, 'getData'>,
    quality: () => S.Q,
    grassInstanceBudget: () => qualityFeatures(S.QKEY).grass.instances,
    getScene: () => S.scene,
    getCamera: () => S.camera,
    getRenderer: () => S.renderer,
    getControls: () => S.controls as Getter<Deps<typeof createMapWorld>, 'getControls'>,
    invalidate: () => S.invalidate(),
    disposeObject3D,
    constrainFreeCameraAltitude: () => cameraRuntime.constrainFreeCameraAltitude(),
    regroundBases,
    regroundSpawns,
    // annotation 派生缓存重建（owner = annotationScene；晚绑定箭头——工厂创建期不触碰）
    rebuildAnnotationProjection: () => annotationScene.rebuildAnnotationProjection(),
    reprojectAnnotationHeights: () => annotationScene.reprojectAnnotationHeights(),
    scopedHiddenEid: () => cameraRuntime.scopedHiddenEid(),
    onTerrainReground: () => S.contactShadowCtl.handle()?.reground(),   // 接地阴影随地形重建贴回
    onLightingApplied: () => S.contactShadowCtl.handle()?.syncSun(),   // 逐图光照后同步太阳
    lightingTargets: () => ({ renderer: S.renderer, scene: S.scene, sunLight: S.sunLight, hemiLight: S.hemiLight, debug: S.DEBUG }),
    buildWorldCameraPlacement: (center) => {
      const { cx, cz, ext } = center;
      // 用户操作过的自由视角跨回放保留；跟随目标不跨回放，仍回到默认机位。
      if (cameraRuntime.topViewOnLoad() || cameraRuntime.cam() !== 'free') {
        S.camera.position.set(cx, ext * 1.1, cz + ext * 1.2);
        S.controls!.target.set(cx, 0, cz);
      }
      applyCameraClamp();   // 世界范围决定 min/max 距离（初值，实测再调）
    },
  });

  // 水面 HIGH/ULTRA 动态平面反射（画质计划 W1/P1/W3）：镜像相机 + 半分辨率 RT，
  // 画质语义/反射 pass 覆盖层剔除/运行时改档收口在 waterReflectionRuntime.ts。
  const waterReflection = createWaterReflectionRuntime({
    getWaterMeshes: () => mapWorld.waterMeshes(),
    getWaterLevel: () => mapWorld.waterLevel(),
    // 反射 pass 覆盖层剔除（W3）：草/战斗特效/3D 标注不进镜像 RT。
    getExcludedRoots: () => [mapWorld.grassRoot(), battle.fxRoot(), annotationScene.annotationRoot()],
    qualityKey: () => S.QKEY,
    debug: S.DEBUG,
  })
  S.applyQualityFeatures = () => waterReflection.apply();
  S.requestWaterReflectionRefresh = () => waterReflection.requestRefresh();
  // 车辆运行时 owner（#820 Step 4 出仓）：buildVehicles / 位姿采样 / GLB / 悬挂 /
  // applyPose 与车辆 teardown 的唯一归属。canonical 生命事实（sceneLifeAt/visibleAt）
  // 与调色板仍在本闭包，按 deps 注入；POSE_GRID 按引用共享同一可变对象。
  const vehicles = createVehicleRuntime({
    store: P.store,
    destroyed: () => S.destroyed,
    sessionGen: () => S.session.sessionGen(),
    getScene: () => S.scene,
    getT: () => S.T,
    getData: () => S.DATA as Getter<Deps<typeof createVehicleRuntime>, 'getData'>,
    quality: () => S.Q,
    teamColor: (v) => teamColorOf(v.def.team, S.DATA!.meta.friendly_team),
    classIconsVisible: () => labels.classIconsVisible(),
    showMarkerStatus: () => labels.showMarkerStatus(),
    invalidate: () => S.invalidate(),
    visibleAt: (v, t) => S.visibleAt(v, t),
    sceneLifeAt: (v, t) => S.sceneLifeAt(v, t),
    // 身份替换判据（幽灵抑制；唯一消费方是车辆运行时，勿挪到 treadRuntime）
    replacedAt: (eid, t) => S.replacedAt(eid, t),
    sampleHeight: (x, z) => mapWorld.sampleHeight(x, z),
    // 晚绑定解环：vehicles 需要 tread.attachVehicle（buildVehicles 的履带装配段）、
    // tread 需要 vehicles 的位姿采样与车辆清单。buildVehicles 只在运行期调用，届时
    // 两个工厂都已构造完成（箭头闭包按引用读 tread，不按值捕获）。
    treadAttachVehicle: (v) => tread.attachVehicle(v),
    disposeObject3D,
    poseGrid: S.POSE_GRID,
    visByEid: () => S.VIS_BY_EID,
    contactShadows: () => S.contactShadowCtl.handle(),   // 逐车阴影挂接/同步（#907 主干随迁）
    scopedHiddenEid: () => cameraRuntime.scopedHiddenEid(),
  });
  // 地面履带印 owner（#820 Step 4 出仓）：逐车参数/贴图缓存、网格装配、路径喂样与
  // 游标泵的唯一归属；会话 teardown 的履带段（逐车 treadMesh + 共享贴图）在其 dispose。
  const tread = createTreadRuntime({
    store: P.store,
    quality: () => S.Q,
    getScene: () => S.scene,
    destroyed: () => S.destroyed,
    invalidate: () => S.invalidate(),
    getT: () => S.T,
    getStart: () => S.START,
    getData: () => S.DATA,
    getVehicles: () => vehicles.getVehicles() as Getter<Deps<typeof createBattleRuntime>, 'getVehicles'>,
    vehicles,
    visibleAt: (v, t) => S.visibleAt(v, t),
    heightAt: (x, z) => mapWorld.sampleHeight(x, z),
    heightFieldReady: () => !!mapWorld.heightField(),
  });

  // 战斗表现 owner（#820 Step 5 出仓）：弹道推进/炮口/曳光/弹着/击毁爆炸/战斗特效批次/
  // 残骸烟相位/动态层清除/战斗反馈 transient 的唯一归属。canonical 生命事实
  //（sceneLifeAt/deathTimesOf）与调色板仍在本闭包，按 deps 注入。
  const battle = createBattleRuntime({
    getData: () => S.DATA as Getter<Deps<typeof createBattleRuntime>, 'getData'>,
    getT: () => S.T,
    getScene: () => S.scene,
    getCamera: () => S.camera,
    getViewportHeight: () => P.container.clientHeight,
    debug: S.DEBUG,
    getVehicles: () => vehicles.getVehicles() as Getter<Deps<typeof createBattleRuntime>, 'getVehicles'>,
    vehicles,
    sceneLifeAt: (v, t) => S.sceneLifeAt(v, t),
    colorUnknown: COLOR_UNKNOWN,
    tracerFriendly: TRACER_FRIENDLY,
    tracerEnemy: TRACER_ENEMY,
    invalidate: () => S.invalidate(),
    deathTimesOf: (v) => deathTimesOf(v as RuntimeVehicle),
    qualityFx: () => S.Q.fx,
    // 标签快照失效（owner = labelsRuntime 的 labelsTime；晚绑定箭头——labels 工厂在其后构造）
    getLabelOverlay: () => P.labelOverlay as Getter<Deps<typeof createBattleRuntime>, 'getLabelOverlay'>,
    invalidateLabels: () => labels.invalidateLabels(),
  });

  // 3D annotation 场景层 owner（#820 Step 5 出仓）：GPU 资源/rebuild 编排/地表拾取/
  // pointer 手势状态机。相机/共享 raycaster/controls 来自渲染器核心；世界事实经 mapWorld
  // 句柄消费。事件监听注册/摘除收口为 attachListeners()/detach()。
  const annotationScene = createAnnotationScene({
    container: P.container,
    debug: S.DEBUG,
    perfEnabled: () => !!S.PERF,
    invalidate: () => S.invalidate(),
    getScene: () => S.scene,
    getCamera: () => S.camera,
    getRaycaster: () => S.raycaster,
    getControls: () => S.controls as Getter<Deps<typeof createAnnotationScene>, 'getControls'>,
    mapWorld,
    annotationSurfaceHeightAt: (x, z) => mapWorld.annotationSurfaceHeightAt(x, z),
    onAnnotationCommit: P.onAnnotationCommit,
    onAnnotationErase: P.onAnnotationErase,
  });

  // 标签运行时 owner（#820 Step 5 出仓）：软遮挡/名牌发布/会话 resolver/击杀 feed 计分名册。
  // writeHud（时钟+相机+名册编排）、teamHpTotals、applySupremacyPointsToStore 仍在本闭包。
  const labels = createLabelsRuntime({
    store: P.store as Deps<typeof createLabelsRuntime>['store'],
    container: P.container,
    getCamera: () => S.camera,
    getRaycaster: () => S.raycaster,
    getData: () => S.DATA as Getter<Deps<typeof createLabelsRuntime>, 'getData'>,
    getT: () => S.T,
    getVehicles: () => vehicles.getVehicles(),
    getSessionGen: () => S.session.sessionGen(),
    getFollowEid: () => cameraRuntime.followEid(),
    deathAt: S.deathAt,
    hpAt: S.hpAt,
    visibleAt: S.visibleAt,
    visByEid: () => S.VIS_BY_EID,
    scopedHiddenEid: () => cameraRuntime.scopedHiddenEid(),
    sampleHeight: (x, z) => mapWorld.sampleHeight(x, z),
    heightField: () => mapWorld.heightField(),
    heightMeta: () => mapWorld.heightMeta(),
    mapScenery: () => mapWorld.mapScenery(),
    occlGrid: () => mapWorld.occlGrid(),
    transients: battle.transients,
    getMarkerLabelSources: () => battleMarkers.labelSources(),   // 战场标记来源卡（与坦克名牌同一 DOM 卡片）
    fxScale: () => battle.fxScale(),
    getLabelOverlay: () => P.labelOverlay as Getter<Deps<typeof createLabelsRuntime>, 'getLabelOverlay'>,
    canonicalVehicles: () => P.store.playbackSession?.canonical?.dataset?.vehicles || [],
    invalidate: () => S.invalidate(),
  });

  // annotation 地表采样 = 世界事实的唯一采样口径（mapWorld owner；消费经 annotationScene deps）。


  // ---------- 基地（争霸 A–D / 单基地）贴地标记（实现在 playback/bases.js；快照式工厂） ----------
  //（原节的语义注释与 fail-closed 判据随实现迁往该模块头）
  const bases = createBaseMarkers({
    getScene: () => S.scene, getCamera: () => S.camera,
    getData: () => S.DATA as Getter<Deps<typeof createBaseMarkers>, 'getData'>, getMapBases: () => mapWorld.mapBases() as Getter<Deps<typeof createBaseMarkers>, 'getMapBases'>,
    store: P.store, groundY: (x, z) => mapWorld.groundY(x, z),
  });
  // 回放会话：模式由 DATA 轨迹判（buildBases 原语义）；地图预览会话：宿主经
  // setMapBasesKind 显式选组，几何仍是唯一事实（bases.buildStatic 内部 fail-closed）。
  function buildBases() {
    if (S.session.sessionMode() === 'map') bases.buildStatic(S.MAP_BASES_KIND);
    else bases.build();
  }
  function clearBases() { bases.clear(); }
  function regroundBases() { bases.reground(); }
  function updateBases() { bases.update(S.T); }

  // ---------- 出生点贴地标记（#835；实现在 playback/spawns.ts；快照式工厂） ----------
  //（数据面 / 呈现口径 / fail-closed 判据见该模块头：宿主经 setMapSpawns 下发语义
  //  档案解析出的点列，回放会话不消费；几何 fail-closed 在 spawns.build 内部。）
  const spawnMarkers = createSpawnMarkers({ getScene: () => S.scene, groundY: (x, z) => mapWorld.groundY(x, z) });
  function buildSpawns() { spawnMarkers.build((S.session.sessionMode() === 'map' ? S.MAP_SPAWN_POINTS : null) as Parameters<ReturnType<typeof createSpawnMarkers>['build']>[0]); }
  function clearSpawns() { spawnMarkers.clear(); }
  function regroundSpawns() { spawnMarkers.reground(); }
  /** UI Profile 切换后 token 色板变化（四季主题切换）：已有出生点
   *  材质原位重着色——不重建场景、不动相机。仅 map 会话有意义（回放无出生点）。 */
  function refreshSpawnColors() {
    if (S.session.sessionMode() !== 'map') return;
    spawnMarkers.refreshColors();
    S.invalidate();
  }

  // 战场快捷标记（battle markers）：宿主接线出仓 playback/battleMarkerHost.ts（0x2e markers +
  // attention_to_cell；生命周期 = 回放时钟窗口状态，判据见 markerRuntime 模块头）
  // invalidate 在 psP3 才赋值：必须晚绑定（与相邻运行时同款箭头），直接传 S.invalidate
  // 会把 undefined 固定进标记宿主，首个标记生成/隐藏时抛 TypeError。
  const battleMarkers = createBattleMarkerHost({ getScene: () => S.scene, mapWorld, vehicles, visibleAt: (v, t) => S.visibleAt(v, t), replacedAt: (eid, t) => S.replacedAt(eid, t), getT: () => S.T, getData: () => S.DATA, invalidate: () => S.invalidate() });

  // 相机地形净空与 target 钳制（#820 Wave B6A：实现与语义注释在
  // playback/cameraTerrainClamp.js）。本处只注入场景侧的事实来源。
  const cameraTerrainClamp = createCameraTerrainClamp({
    getCamera: () => S.camera,
    getControls: () => S.controls as Getter<Deps<typeof createCameraTerrainClamp>, 'getControls'>,
    // cameraDriven 归相机运行时：经箭头延迟求值，工厂创建期不触碰。
    cameraDriven: () => cameraRuntime.cameraDriven(),
    getTerrainMesh: () => mapWorld.terrainMesh(),
    getHeightField: () => mapWorld.heightField(),
    getHeightMeta: () => mapWorld.heightMeta() as Getter<Deps<typeof createCameraTerrainClamp>, 'getHeightMeta'>,
    sampleRenderedTerrainHeight: (x, z) => mapWorld.sampleRenderedTerrainHeight(x, z),
    sampleHeight: (x, z) => mapWorld.sampleHeight(x, z),
    clearance: CAMERA_GROUND_CLEARANCE,
    getWorldCenter: () => mapWorld.worldCenter(),
    isFollowing: () => !!cameraRuntime.followEid(),
  });
  function applyCameraClamp() { cameraTerrainClamp.applyCameraClamp(mapWorld.worldCenter().ext); }
  function terrainHeightForCameraClamp(x: number, z: number): number { return cameraTerrainClamp.terrainHeightForCameraClamp(x, z) as number; }
  function clampOrbitCameraToTerrain() { return cameraTerrainClamp.clampOrbitCameraToTerrain(); }
  function clampCameraTarget() { cameraTerrainClamp.clampCameraTarget(); }

  // 相机运行时 owner（#820 Step 4 出仓）：fly 接管 / 滚轮缩放平滑 / setCam·setFollow /
  // topViewOnLoad / 俯视机位 / 录像者视角域 / 穿深着色 / 场景选中语义的唯一归属。
  // 相机地形净空（cameraTerrainClamp）仍在本闭包，经 deps 回调注入；canonical 生命
  // 事实（deathAt/deathTimesOf）、?perf 域与 ARMOR_HIGHLIGHT 偏好仍在本闭包。
  const cameraRuntime = createCameraRuntime({
    store: P.store,
    container: P.container,
    debug: S.DEBUG,
    getCamera: () => S.camera,
    getRenderer: () => S.renderer,
    getControls: () => S.controls as Getter<Deps<typeof createCameraRuntime>, 'getControls'>,
    getRaycaster: () => S.raycaster,
    getScene: () => S.scene,
    invalidate: () => S.invalidate(),
    getT: () => S.T,
    getData: () => S.DATA as Getter<Deps<typeof createCameraRuntime>, 'getData'>,
    sessionEpoch: () => S.session.sessionEpoch(),
    destroyed: () => S.destroyed,
    writeHud: (force?: boolean) => S.writeHud(force),
    updateRoster: () => labels.updateRoster(),
    vehicles,
    mapWorld: mapWorld as Deps<typeof createCameraRuntime>['mapWorld'],
    annotationScene,
    deathAt: (v, t) => S.deathAt(v, t),
    deathTimesOf: (v) => deathTimesOf(v as RuntimeVehicle),
    gpu: () => S.gpu,
    perfEnabled: () => !!S.PERF,
    armorHighlightPref: () => S.ARMOR_HIGHLIGHT,
    recorderReticle: (P.recorderReticle ?? null) as Deps<typeof createCameraRuntime>['recorderReticle'],
    clampCameraTarget,
    clampOrbitCameraToTerrain,
    baseMinDistance: () => cameraTerrainClamp.baseMinDistance(),
    terrainHeightForCameraClamp,
    onVehicleSelect: P.onVehicleSelect ?? null,
    pickDebug: () => S.PICK_DEBUG,
    syncContactShadow: (v) => vehicles.syncContactShadow(v),
    getPickDownAt: () => S.pickDownAt,
    setPickDownAt: (p) => { S.pickDownAt = p; },
    reportPick: S.reportPick,
  });

  // ---------- 车辆运行时（buildVehicles / GLB 装载 / 悬挂 / 履带印 / applyPose）----------
  // 上述车辆域实现自 2026-11-05 起（#820 Step 4）整体出仓：
  //   · 车辆运行时 owner = playback/vehicleRuntime.ts（buildVehicles/poseStash/loadGlb/
  //     applyGlbToggle/collectSuspensionParts/suspensionStep/poseGlb/poseGlbRig/glbGunWorld/
  //     applyDetachedTurrets/applyPose/vehicleByEid + 会话 teardown 的车辆段）；
  //   · 地面履带印 owner = playback/treadRuntime.ts（treadParamsFor/ensureTreadMesh/feedTrail/
  //     updateTrails + 逐车 treadMesh 与贴图缓存 teardown）。
  // 本闭包只经 vehicles / tread 句柄调度，代码与搬移前逐字一致。

  // ---------- 战斗反馈 transient（状态/游标在 playback/transientFeedback3d.ts）----------
  // 壁钟寿命、血量链事件源、幽灵段/受击闪的语义注释随实现迁往该模块；本处只保留
  // 依赖场景的事实：canonical 生命链的 deathTimesOf、车模可见性/位置、battleFx 爆散。
  /** 车辆每次死亡的场景时刻（issue #622 复活模式：同一 eid 可多次死亡），未排序。 */
  function deathTimesOf(v: RuntimeVehicle): number[] {
    const canonical = P.store.playbackSession?.canonical;
    const times: number[] = [];
    const clock = canonical?.clock;
    const startRaw = clock?.startRaw;
    if (canonical?.dataset?.vehicles && startRaw != null && Number.isFinite(startRaw)) {
      const seenDeaths = new Set();
      for (const life of S.canonicalLifeTrack(v, canonical)?.lifeTransitions ?? []) {
        if (life.lifeState !== 'DESTROYED' || !Number.isFinite(life.timeSec)) continue;
        const identityTime = (life.destroyedKnownAtSec ?? life.timeSec) + startRaw;
        if (!S.canonicalDeathAppliesTo(v, identityTime, canonical)) continue;
        // 同一次死亡的重复迁移只算一次（既有不变式）；真复活模式的多死 killedAtSec 互异
        const key = Number.isFinite(life.destroyedKnownAtSec) ? life.destroyedKnownAtSec : life.timeSec;
        if (seenDeaths.has(key)) continue;
        seenDeaths.add(key);
        times.push(life.timeSec + startRaw);
      }
    } else {
      const death = v.def.death_t;
      if (typeof death === 'number' && Number.isFinite(death)) {
        times.push(death);
        for (const d of v.def.death_times ?? []) {
          if (typeof d === 'number' && Number.isFinite(d) && d !== death) times.push(d);
        }
      }
    }
    return times;
  }


  Object.assign(S, {
    mapWorld,
    waterReflection,
    vehicles,
    tread,
    battle,
    annotationScene,
    labels,
    bases,
    buildBases,
    clearBases,
    regroundBases,
    updateBases,
    spawnMarkers,
    buildSpawns,
    clearSpawns,
    regroundSpawns,
    refreshSpawnColors,
    battleMarkers,
    cameraTerrainClamp,
    applyCameraClamp,
    terrainHeightForCameraClamp,
    clampOrbitCameraToTerrain,
    clampCameraTarget,
    cameraRuntime,
    deathTimesOf
  })
}
