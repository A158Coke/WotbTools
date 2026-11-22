// 会话运行时 owner（2026-11-22 自 playbackScene.js 闭包出仓，纯搬移）：
// teardown / 渲染器重建与惰性创建 / 会话数据发布 / resolver 与游标复位，
// 以及 sessionLifecycle 的宿主接线（依赖注入语义见 playback/sessionLifecycle.ts）。
import { createDynRes } from '../dynRes.js'
import { foliageClip } from '../sceneryMaterials.js'
import { disposeObject3D } from '../materialDispose.js'
import { visibilitySpansByEid } from '../../replay-local/pose/vehiclePose.js'
import { resolveReplayClock } from '../../replay-local/canonical/facts'
import { createSessionLifecycle } from './sessionLifecycle.ts'
import { installDebugProbes } from './debugProbes.ts'
import type { Host } from '../playbackScene.js'
import { bind } from '../hostBind.ts'
import type { SessionPlaybackData } from './sessionLifecycle.ts'

export function installSessionRuntime(S: Host) {
  Object.assign(S, {
    teardownSession: bind(S, teardownSession),
    rebuildRenderer: bind(S, rebuildRenderer),
    ensureRenderer: bind(S, ensureRenderer),
    prepareSessionCamera: bind(S, prepareSessionCamera),
    publishSessionData: bind(S, publishSessionData),
    publishMapOnlyData: bind(S, publishMapOnlyData),
    prepareResolvers: bind(S, prepareResolvers),
    resetSessionCursors: bind(S, resetSessionCursors),
  })

  // ---------- 数据加载 ----------
  // 注：hull_yaw/turret_yaw 由后端相位解卷绕（连续域）后落盘，朴素线性插值即物理正确，
  // 前端不再二次去缠绕（旧版前端 unwrapAngleArray 已由后端数据契约取代）。

  //（动态层清除 owner = playback/battleRuntime.ts 的 clearEffects/dispose；seekTo 与
  //  teardownSession 经 battle 句柄调用，防 seek 循环累积显存的语义逐字保留）

  function teardownSession(S: Host) {
    S.session.bumpSessionGen();
    S.session.setSessionMode('replay');
    S.MAP_BASES_KIND = null;
    S.MAP_SPAWN_POINTS = null;   // 出生点列随会话复位（宿主就绪后经 setMapSpawns 补推）
    S.store.mapReady = false;
    // 录像者不跨回放：同步退出，旧机位不能被下一场当成用户的自由相机保留。
    //（相机段 teardown owner = cameraRuntime.resetSessionState：setCam('free') +
    //  topViewOnLoad 复位 + recorderCamera / armorHighlight 释放，语义逐字保留）
    S.cameraRuntime.resetSessionState();
    S.contactShadowCtl.dispose();   // 只释放资源；选择跨 teardown 保留给本次 startPlayback
    foliageClip.value = 0;
    S.store.recorderCameraStatus = 'idle';
    S.store.recorderViewAvailable = false;
    S.store.recorderModeUnknown = false;
    S.mapWorld.resetMapLighting();   // 逐图光照随会话复位（否则换图时上一张的太阳会残留）
    // 动画混合层材质随会话失效（材质已随 mapScenery dispose；mapWorld.dispose 内复位）
    S.battle.dispose();   // 战斗表现 teardown owner（#820 Step 5）：clearEffects + battleFx 释放
                        //（粒子批次 / 条带 / 图集）+ window.__battleFx 删除，顺序逐字保留
    // 拾取调试残留（标记网格 + 面板 DOM）与边界带随会话回收（实现在 playback/ 工厂）
    S.pickReporter.dispose({ scene: S.scene, disposeObject3D });
    S.waterReflection.dispose();   // 反射 RT / uniform 复位（水面材质随后随场景释放）
    S.mapWorld.dispose();   // 地图资产段 teardown（owner 在 mapWorld；对象清单/顺序逐字保留）
    S.annotationScene.clearSessionProjection();   // 旧会话的 annotation 派生几何不得跨图残留（权威在 pane）
    S.clearBases();   // 基地贴地标记（圆环 + 圆盘贴图）随会话释放
    S.clearSpawns();   // 出生点贴地标记随会话释放（#835，与基地同一生命周期）
    // 车辆域 teardown owner（#820 Step 4）：履带印逐车回收 + 贴图/参数缓存释放
    //（treadRuntime.dispose），随后车辆循环（分离炮塔/GLB/悬挂几何/低模组）+ GLB 模板
    // 缓存释放 + V=[]（vehicleRuntime.dispose）。先 tread 后 vehicles，保持原相对顺序
    //（原车辆循环内履带段在组 dispose 之前）。
    S.tread.dispose();
    S.vehicles.dispose();
    S.vehicleLife.reset();
    S.labels.resetSessionState();   // 标签段 teardown owner（#820 Step 5）：labelOverlay 清空 +
                                  // 标签游标/resolver/tankData 缓存复位（原逐行段收口）
    // 地图资产段 teardown 已在上方 mapWorld.dispose()（owner 释放：占位地面/地形/场景
    // GLB/底图/IBL/分层地表/高度场/遮挡与 annotation 候选格）。
    // GLB 模板缓存（session-scoped）的释放已并入上方 vehicles.dispose()（owner 在
    // vehicleRuntime；未决 Promise 挂 then(dispose) 的语义逐字保留）。
    S.DATA = null;
    S.VIS_BY_EID = new Map();
    S.POSE_GRID.tStart = 0;
    S.POSE_GRID.samples = 0;
    S.store.playbackSession = null;
    // 会话终止 = 不再有任何可用的回放数据：就绪标记必须一起落下，否则新会话加载期间
    // （或 file=null / 被阻断 / 组件卸载之后）HUD 与播放传输仍会按「已就绪」渲染，
    // 而底层 DATA/车辆/贴图已经 dispose。destroy 与 loadData 的替换路径都经过这里。
    S.store.hasData = false;
    S.T = 0; S.battle.resetShotPtr(); S.labels.resetCursors();
    S.winnerShown = false;
    S.cameraRuntime.resetFollow(); S.followAnchor = null;
    S.store.killfeed = [];
    S.store.banner = null;
    // HUD 派生字段显式归零（与 tick 的确定性重算互为双保险：会话切换不留上一场残值）
    S.store.pointsFriend = null; S.store.pointsEnemy = null;
    S.store.scoreFriend = 0; S.store.scoreEnemy = 0;
    S.store.hpFriend = 0; S.store.hpFriendMax = 0; S.store.hpEnemy = 0; S.store.hpEnemyMax = 0;
    S.store.hpFriendPct = 100; S.store.hpEnemyPct = 100;
    S.store.friendlyTeam = null;
    S.store.roster.team1 = [];
    S.store.roster.team2 = [];
    S.store.roster.unknown = [];
    S.labels.resetRoster();   // eid → 名册行 索引清空（实现在 playback/hudFeed.js）
  }

  /** 重建渲染器上下文（偏好失配时）：卸旧 renderer/controls/画布与事件，
   *  initScene 重建——会话数据（DATA/资产/相机状态）不动，仅重挂画布。 */
  function rebuildRenderer(S: Host) {
    // initScene 换新相机：机位不随之丢失，是否保留由 buildWorld 按会话决定。
    const position = S.camera.position.clone();
    const target = S.controls.target.clone();
    // 旧尺寸监听器必须先断（评审 P2）：initScene 每次新建 ResizeObserver 覆盖
    // sizeObserver——不断开旧实例会在同容器上累积回调（每次重建一个），
    // destroy 也只回收最后一个；旧回调还会对已 dispose 的 renderer 调 setSize。
    if (S.sizeObserver) { try { S.sizeObserver.disconnect(); } catch (_) {} S.sizeObserver = null; }
    removeEventListener('resize', S.onResize);
    if (S.controls) { try { S.controls.dispose(); } catch (_) {} S.controls = null; }
    if (S.renderer) {
      try { S.renderer.domElement.removeEventListener('pointerdown', S.cameraRuntime.onScenePointerDown); } catch (_) {}
      try { S.renderer.domElement.removeEventListener('pointerup', S.cameraRuntime.onScenePointerUp); } catch (_) {}
      S.gpu?.detach();
      S.renderer.dispose();
      try { S.renderer.forceContextLoss(); } catch (_) {}
      S.renderer.domElement.remove();
      S.renderer = null;
    }
    S.dynResCtl = null;
    S.initScene();
    S.camera.position.copy(position);
    S.controls.target.copy(target);
    if (S.cameraRuntime.flyMode()) S.cameraRuntime.flyLookSyncFromCamera('renderer rebuild', true);
    S.camera.lookAt(S.controls.target);
  }

  /** 渲染器就绪（startPlayback 编排调用；原 startPlayback 内联段，偏好失配语义原样）。 */
  function ensureRenderer(S: Host) {
    if (!S.renderer) S.initScene();   // 渲染器惰性创建：此时画质档已定型（loader 选择/URL 参数）
    if (S.DEBUG && S.renderer) installDebugProbes({ renderer: S.renderer, scene: S.scene, camera: S.camera, controls: S.controls, cameraRuntime: S.cameraRuntime });
    if (S.rendererCaps && (S.rendererCaps.logdepth !== S.LOGDEPTH || S.rendererCaps.dynres !== S.DYNRES
      || S.rendererCaps.stencil !== S.contactShadowCtl.wantsStencil())) {
      // 复用渲染器（换文件 reset 保留）但待开播偏好已改：按失配项热修正——
      // logdepth 是上下文级参数 → 重建渲染器（initScene 换新上下文，dynres 同步重装）；
      // 仅 dynres 变化 → 热装/卸控制器即可（无需动上下文）。
      if (S.rendererCaps.logdepth !== S.LOGDEPTH || S.rendererCaps.stencil !== S.contactShadowCtl.wantsStencil()) {
        S.rebuildRenderer();   // 上下文级参数（logdepth / stencil）→ 重建渲染器
      } else {
        // 仅 dynres 变化（评审 P2）：控制器可能已把 pixelRatio 降过档，热装/卸时
        // 必须先同步 renderer 回当前档位上限 + 重设画布——否则 B 场永久停在
        // A 场的低清晰度（或新控制器内部上限与实际画布不一致）。
        S.rendererCaps.dynres = S.DYNRES;
        const cap = Math.min(devicePixelRatio, S.Q.maxDpr);
        S.renderer.setPixelRatio(cap);
        S.renderer.setSize(S.container.clientWidth, S.container.clientHeight, false);
        S.renderer.domElement.style.width = S.container.clientWidth + 'px';
        S.renderer.domElement.style.height = S.container.clientHeight + 'px';
        S.dynResCtl = (S.DYNRES && cap > 1) ? createDynRes({ ceilDpr: cap }) : null;
      }
    }
  }
  /** 会话开场相机重置：跟随目标不跨回放（startPlayback 编排调用）。 */
  function prepareSessionCamera(S: Host) { S.cameraRuntime.prepareSessionCamera(); }
  /** 回放数据发布（sessionLifecycle 编排调用；DATA/VIS_BY_EID/POSE_GRID 唯一 owner 仍在本闭包）。 */
  function publishSessionData(S: Host, data: SessionPlaybackData, playbackSession: unknown) {
    S.DATA = data;
    S.VIS_BY_EID = visibilitySpansByEid(data.visibility);
    S.POSE_GRID.tStart = data.meta.t_start;
    S.POSE_GRID.samples = data.meta.samples;
    S.store.playbackSession = playbackSession;
    S.battle.prepareGunfire(data.vehicles || []);   // 炮声预热（owner = battleRuntime）
  }
  /** 地图预览 stub 发布（空车队，minimalData 同款形状；startPlayback 只走地图资产前缀）。 */
  function publishMapOnlyData(S: Host, mapId: number, mapName: string) {
    S.DATA = {
      meta: { map_id: mapId || 0, map_name: mapName || '', t_start: 0, friendly_team: 1, duration: 0 },
      vehicles: [],
      shots: [],
      periods: [],
      destructible_events: [],
    };
    S.VIS_BY_EID = visibilitySpansByEid(undefined);
    S.POSE_GRID.tStart = 0;
    S.POSE_GRID.samples = 0;
    S.store.playbackSession = null;
  }
  /** 会话级 resolver 装配 + mounted-configs 预取（owner = labelsRuntime.prepareResolvers）。 */
  function prepareResolvers(S: Host) { S.labels.prepareResolvers(); }
  /** 会话游标复位（开战时刻：弹道指针与击杀 feed 指针）。 */
  function resetSessionCursors(S: Host) { S.battle.resetShotPtr(); S.labels.resetCursors(); }
}

export function createPlaybackSession(S: Host) {
  // 会话生命周期 owner（#820 Step 1 出仓）：loadData / loadMapOnly / startPlayback 与
  // 会话代数三计数迁至 playback/sessionLifecycle.ts；本闭包是它的宿主（编排接线 +
  // 事实 owner），依赖注入语义见该模块 deps 接口。
  S.session = createSessionLifecycle({
    store: S.store,
    destroyed: () => S.destroyed,
    perf: () => S.perf,
    teardownSession: S.teardownSession,
    publishSessionData: S.publishSessionData,
    publishMapOnlyData: S.publishMapOnlyData,
    ensureRenderer: S.ensureRenderer,
    battleRange: S.battleRange,
    publishSceneClock: () => { S.sceneClock = resolveReplayClock(S.DATA.periods || [], null, S.DATA.meta.duration); },
    clearCanonicalClock: () => { S.canonicalClock = null; },
    prepareSessionCamera: S.prepareSessionCamera,
    setMapKey: (key) => S.mapWorld.setMapKey(key),
    getGlbOn: () => S.vehicles.glbOn(),
    buildWorld: () => S.mapWorld.buildWorld(),
    setCam: (mode) => S.cameraRuntime.setCam(mode),
    clampCameraTarget: S.clampCameraTarget,
    constrainFreeCameraAltitude: () => S.cameraRuntime.constrainFreeCameraAltitude(),
    loadMapImage: () => S.mapWorld.loadMapImage(),
    buildBases: S.buildBases,
    buildSpawns: S.buildSpawns,
    buildVehicles: () => S.vehicles.buildVehicles(),
    setupContactShadows: () => S.contactShadowCtl.setup(),
    applyGlbToggle: (on) => S.vehicles.applyGlbToggle(on),
    buildRoster: () => S.labels.buildRoster(),
    prepareResolvers: S.prepareResolvers,
    prewarmShaders: S.prewarmShaders,
    setPlaying: S.setPlaying,
    tick: S.tick,
    writeHud: S.writeHud,
    invalidate: S.invalidate,
    loadRecorderCamera: (source, epoch) => S.cameraRuntime.loadRecorderCamera(source, epoch),
    transients: S.battle.transients,
    setClockRange: (start, end) => { S.START = start; S.END = end; },
    setTime: (t) => { S.T = t; },
    debug: S.DEBUG,
    exposeVehicles: () => { window.__pbV = S.vehicles.getVehicles(); },
    data: () => S.DATA,
    topViewOnLoad: () => S.cameraRuntime.topViewOnLoad(),
    cam: () => S.cameraRuntime.cam(),
    forceGlb: () => !!S.Q.forceGlb,
    resetSessionCursors: S.resetSessionCursors,
  });
  return S.session
}
