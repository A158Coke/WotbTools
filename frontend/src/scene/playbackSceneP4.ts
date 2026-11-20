import { battleEndTime } from './battleEnd.js'
import { firstIndexAfter } from './seekPointer.js'
import { isPlaybackSpeed } from '../composables/usePlaybackTransport.js'
import { foliageClip } from './sceneryMaterials.js'
import { disposeObject3D } from './materialDispose.js'
import { installDebugProbes } from './playback/debugProbes.ts'
import { createDynRes } from './dynRes.js'
import { visibilitySpansByEid } from '../replay-local/pose/vehiclePose.js'
import { createSessionLifecycle } from './playback/sessionLifecycle.ts'
import { resolveReplayClock } from '../replay-local/canonical/facts'

import type { SceneParts, SceneParams } from './playback/sceneParts.types.js'
import type { AgentPlaybackFacet } from '../api/agent-replay-facets.js'
import type { WorkspacePlayback } from '../composables/useReplayWorkspace.js'
export function psP4(S: SceneParts, P: SceneParams): void {
  function battleRange(): [number, number] {
    const data = S.DATA!;
    const dataStart = data.meta.t_start;
    const dataEnd = Math.max(dataStart, battleEndTime(data));
    const clock = S.canonicalClock || S.sceneClock;
    if (!clock) return [dataStart, dataEnd];
    const streamEnd = Number(data.meta.duration) > dataStart ? Number(data.meta.duration) : dataEnd;
    const start = Math.min(Math.max(dataStart, clock.startRaw), streamEnd);
    const end = Number.isFinite(clock.durationSec) && clock.durationSec > 0
      ? Math.min(streamEnd, clock.startRaw + clock.durationSec) : dataEnd;
    return [start, Math.max(start, end)];
  }
  /**
   * canonical 时钟换了（晚到 / 失败 / 换会话）：重定 [START, END]，把 T 夹回范围（越界才 seek，范围内不打断播放），
   * 越过新终点时停播；随即发布到 store，播放条 / 顶栏 / Details 与引擎同一刻对齐。
   */
  function setBattleClock(clock: { startRaw?: number | null; durationSec?: number | null } | null): void {
    S.canonicalClock = clock && Number.isFinite(clock.startRaw) ? { startRaw: clock.startRaw as number, durationSec: clock.durationSec ?? 0 } : null;
    if (!S.DATA) return;
    [S.START, S.END] = battleRange();
    S.battle.transients.resyncBursts(S.T);   // late canonical never replays past explosions
    P.store.startTime = S.START;
    P.store.duration = S.END;
    const t = Math.max(S.START, Math.min(S.END, S.T));
    if (t !== S.T) seekTo(t);
    else for (const v of S.vehicles.getVehicles()) S.vehicles.applyPose(v);   // canonical late/failure refreshes paused visuals too
    if (S.PLAYING && S.T >= S.END) S.setPlaying(false);
    S.writeHud(true);
    S.invalidate();
  }
  function seekTo(t: number): void {
    S.T = Math.max(S.START, Math.min(S.END, t));
    S.battle.clearEffects();   // 动态层 dispose（与 teardown 同一路径，防 seek 循环累积显存）
    // 游标一律重定到「T 之后第一条」：clearEffects 已把 transient 游标归零，
    // 若不重定，紧随的 tick() 会把 t<=T 的历史飘字/爆散一次性补播（与 2D seek 语义不符）
    S.battle.resetShotsTo(firstIndexAfter(S.DATA!.shots, S.T, (x) => x.t_fire));
    S.battle.transients.rewind(S.T);
    S.battleMarkers.update(S.T);   // 战场标记窗口重算（窗内标记立即可见：跳转/倒带均适用）
    S.labels.rebuildFeed();
    S.labels.resetScore();     // 比分为单调游标，seek 后必须从头推进（否则分数不回落）
    S.winnerShown = false; P.store.banner = null;
    S.vehicles.markSeekSnap();  // 跳变：行程吸附到目标、侧位移不积分（客户端"首次可见直接吸附"同款）
    S.tick();
    S.vehicles.clearSnap();
    // seek 是状态跳变：立即把 HUD/进度条/名册对齐到新 T（不等下一个降频窗口）——
    // 暂停时没有帧在跑，名册投影只能靠这次强制写入。
    S.writeHud(true);
    S.invalidate();
  }
  // 只接受档位表内的值：面板按钮与 URL 参数都不该把场景带进"1.37×"这种未定义速度
  function setSpeed(s: number): void { if (!isPlaybackSpeed(s)) return; S.SPEED = s; P.store.speed = s; }


  // 键盘（空格 / ←→）由页面经 usePlaybackTransport 统一处理（与 2D 同一套键位与输入框防误触），
  // 场景内核不再自挂全局 keydown：原实现不区分输入框，会吞掉文本框里的空格。

  // ---------- 数据加载 ----------
  // 注：hull_yaw/turret_yaw 由后端相位解卷绕（连续域）后落盘，朴素线性插值即物理正确，
  // 前端不再二次去缠绕（旧版前端 unwrapAngleArray 已由后端数据契约取代）。

  //（动态层清除 owner = playback/battleRuntime.ts 的 clearEffects/dispose；seekTo 与
  //  teardownSession 经 battle 句柄调用，防 seek 循环累积显存的语义逐字保留）

  function teardownSession() {
    session.bumpSessionGen();
    session.setSessionMode('replay');
    S.MAP_BASES_KIND = null;
    S.MAP_SPAWN_POINTS = null;   // 出生点列随会话复位（宿主就绪后经 setMapSpawns 补推）
    P.store.mapReady = false;
    // 录像者不跨回放：同步退出，旧机位不能被下一场当成用户的自由相机保留。
    //（相机段 teardown owner = cameraRuntime.resetSessionState：setCam('free') +
    //  topViewOnLoad 复位 + recorderCamera / armorHighlight 释放，语义逐字保留）
    S.cameraRuntime.resetSessionState();
    S.contactShadowCtl.dispose();   // 只释放资源；选择跨 teardown 保留给本次 startPlayback
    foliageClip.value = 0;
    P.store.recorderCameraStatus = 'idle';
    P.store.recorderViewAvailable = false;
    P.store.recorderModeUnknown = false;
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
    S.battleMarkers.clear();   // 战场快捷标记（ping/目标光环/扇区）随会话释放（与基地同一生命周期）
    // 车辆域 teardown owner（#820 Step 4）：履带印逐车回收 + 贴图/参数缓存释放
    //（treadRuntime.dispose），随后车辆循环（分离炮塔/GLB/悬挂几何/低模组）+ GLB 模板
    // 缓存释放 + V=[]（vehicleRuntime.dispose）。先 tread 后 vehicles，保持原相对顺序
    //（原车辆循环内履带段在组 dispose 之前）。
    S.tread.dispose();
    S.vehicles.dispose();
    S.lifeTracks = null;
    S.lifeTracksByAccount.clear();
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
    P.store.playbackSession = null;
    // 会话终止 = 不再有任何可用的回放数据：就绪标记必须一起落下，否则新会话加载期间
    // （或 file=null / 被阻断 / 组件卸载之后）HUD 与播放传输仍会按「已就绪」渲染，
    // 而底层 DATA/车辆/贴图已经 dispose。destroy 与 loadData 的替换路径都经过这里。
    P.store.hasData = false;
    S.T = 0; S.battle.resetShotPtr(); S.labels.resetCursors();
    S.winnerShown = false;
    S.cameraRuntime.resetFollow(); S.followAnchor = null;
    P.store.killfeed = [];
    P.store.banner = null;
    // HUD 派生字段显式归零（与 tick 的确定性重算互为双保险：会话切换不留上一场残值）
    P.store.pointsFriend = null; P.store.pointsEnemy = null;
    P.store.scoreFriend = 0; P.store.scoreEnemy = 0;
    P.store.hpFriend = 0; P.store.hpFriendMax = 0; P.store.hpEnemy = 0; P.store.hpEnemyMax = 0;
    P.store.hpFriendPct = 100; P.store.hpEnemyPct = 100;
    P.store.friendlyTeam = null;
    P.store.roster.team1 = [];
    P.store.roster.team2 = [];
    P.store.roster.unknown = [];
    S.labels.resetRoster();   // eid → 名册行 索引清空（实现在 playback/hudFeed.js）
  }

  /** 重建渲染器上下文（偏好失配时）：卸旧 renderer/controls/画布与事件，
   *  initScene 重建——会话数据（DATA/资产/相机状态）不动，仅重挂画布。 */
  function rebuildRenderer(): void {
    if (!S.renderer) return;
    // initScene 换新相机：机位不随之丢失，是否保留由 buildWorld 按会话决定。
    const position = S.camera.position.clone();
    const target = S.controls!.target.clone();
    // 旧尺寸监听器必须先断（评审 P2）：initScene 每次新建 ResizeObserver 覆盖
    // sizeObserver——不断开旧实例会在同容器上累积回调（每次重建一个），
    // destroy 也只回收最后一个；旧回调还会对已 dispose 的 renderer 调 setSize。
    if (S.sizeObserver) { try { S.sizeObserver.disconnect(); } catch (_) {} S.sizeObserver = null; }
    removeEventListener('resize', S.onResize);
    if (S.controls) { try { S.controls!.dispose(); } catch (_) {} S.controls = null; }
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
    S.controls!.target.copy(target);
    if (S.cameraRuntime.flyMode()) S.cameraRuntime.flyLookSyncFromCamera('renderer rebuild', true);
    S.camera.lookAt(S.controls!.target);
  }

  /** 渲染器就绪（startPlayback 编排调用；原 startPlayback 内联段，偏好失配语义原样）。 */
  function ensureRenderer(): void {
    if (!S.renderer) S.initScene();   // 渲染器惰性创建：此时画质档已定型（loader 选择/URL 参数）
    if (S.DEBUG && S.renderer) installDebugProbes({ renderer: S.renderer, scene: S.scene, camera: S.camera, controls: S.controls, cameraRuntime: S.cameraRuntime });
    if (S.rendererCaps && (S.rendererCaps.logdepth !== S.LOGDEPTH || S.rendererCaps.dynres !== S.DYNRES
      || S.rendererCaps.stencil !== S.contactShadowCtl.wantsStencil())) {
      // 复用渲染器（换文件 reset 保留）但待开播偏好已改：按失配项热修正——
      // logdepth 是上下文级参数 → 重建渲染器（initScene 换新上下文，dynres 同步重装）；
      // 仅 dynres 变化 → 热装/卸控制器即可（无需动上下文）。
      if (S.rendererCaps.logdepth !== S.LOGDEPTH || S.rendererCaps.stencil !== S.contactShadowCtl.wantsStencil()) {
        rebuildRenderer();   // 上下文级参数（logdepth / stencil）→ 重建渲染器
      } else {
        // 仅 dynres 变化（评审 P2）：控制器可能已把 pixelRatio 降过档，热装/卸时
        // 必须先同步 renderer 回当前档位上限 + 重设画布——否则 B 场永久停在
        // A 场的低清晰度（或新控制器内部上限与实际画布不一致）。
        if (!S.renderer) return;
        S.rendererCaps.dynres = S.DYNRES;
        const cap = Math.min(devicePixelRatio, S.Q.maxDpr);
        S.renderer.setPixelRatio(cap);
        S.renderer.setSize(P.container.clientWidth, P.container.clientHeight, false);
        S.renderer.domElement.style.width = P.container.clientWidth + 'px';
        S.renderer.domElement.style.height = P.container.clientHeight + 'px';
        S.dynResCtl = (S.DYNRES && cap > 1) ? createDynRes({ ceilDpr: cap }) : null;
      }
    }
  }
  /** 会话开场相机重置：跟随目标不跨回放（startPlayback 编排调用）。 */
  function prepareSessionCamera() { S.cameraRuntime.prepareSessionCamera(); }
  /** 回放数据发布（sessionLifecycle 编排调用；DATA/VIS_BY_EID/POSE_GRID 唯一 owner 仍在本闭包）。 */
  function publishSessionData(data: AgentPlaybackFacet, playbackSession: WorkspacePlayback | null): void {
    S.DATA = data;
    S.VIS_BY_EID = visibilitySpansByEid(data.visibility);
    S.POSE_GRID.tStart = data.meta.t_start;
    S.POSE_GRID.samples = data.meta.samples;
    P.store.playbackSession = playbackSession;
    S.battle.prepareGunfire(data.vehicles || []);   // 炮声预热（owner = battleRuntime）
  }
  /** 地图预览 stub 发布（空车队，minimalData 同款形状；startPlayback 只走地图资产前缀）。 */
  function publishMapOnlyData(mapId: number, mapName: string): void {
    // 地图预览 stub：只带 mapWorld 消费的字段；回放事实（meta 计数/胜方等）全为占位。
    const stub = {
      meta: { map_id: mapId || 0, map_name: mapName || '', t_start: 0, friendly_team: 1, duration: 0 },
      vehicles: [],
      shots: [],
      periods: [],
      destructible_events: [],
    };
    S.DATA = stub as Partial<Record<keyof AgentPlaybackFacet, unknown>> as AgentPlaybackFacet;
    S.VIS_BY_EID = visibilitySpansByEid(undefined);
    S.POSE_GRID.tStart = 0;
    S.POSE_GRID.samples = 0;
    P.store.playbackSession = null;
  }
  /** 会话级 resolver 装配 + mounted-configs 预取（owner = labelsRuntime.prepareResolvers）。 */
  function prepareResolvers() { S.labels.prepareResolvers(); }
  /** 会话游标复位（开战时刻：弹道指针与击杀 feed 指针）。 */
  function resetSessionCursors() { S.battle.resetShotPtr(); S.labels.resetCursors(); }

  // 会话生命周期 owner（#820 Step 1 出仓）：loadData / loadMapOnly / startPlayback 与
  // 会话代数三计数迁至 playback/sessionLifecycle.ts；本闭包是它的宿主（编排接线 +
  // 事实 owner），依赖注入语义见该模块 deps 接口。
  const session = createSessionLifecycle({
    store: P.store,
    destroyed: () => S.destroyed,
    perf: () => S.perf,
    teardownSession,
    publishSessionData,
    publishMapOnlyData,
    ensureRenderer,
    battleRange,
    publishSceneClock: () => { S.sceneClock = resolveReplayClock(S.DATA!.periods || [], null, S.DATA!.meta.duration); },
    clearCanonicalClock: () => { S.canonicalClock = null; },
    prepareSessionCamera,
    setMapKey: (key) => S.mapWorld.setMapKey(key),
    getGlbOn: () => S.vehicles.glbOn(),
    buildWorld: () => S.mapWorld.buildWorld(),
    setCam: (mode) => S.cameraRuntime.setCam(mode),
    clampCameraTarget: S.clampCameraTarget,
    constrainFreeCameraAltitude: () => S.cameraRuntime.constrainFreeCameraAltitude(),
    loadMapImage: () => S.mapWorld.loadMapImage(),
    buildBases: S.buildBases,
    buildMarkers: S.battleMarkers.buildMarkers,   // 战场快捷标记事件源（owner = battleMarkerHost）
    buildSpawns: S.buildSpawns,
    buildVehicles: () => S.vehicles.buildVehicles(),
    setupContactShadows: () => S.contactShadowCtl.setup(),
    applyGlbToggle: (on) => S.vehicles.applyGlbToggle(on),
    buildRoster: () => S.labels.buildRoster(),
    prepareResolvers,
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
    exposeVehicles: () => { (window as Window & { __pbV?: unknown }).__pbV = S.vehicles.getVehicles(); },
    data: () => S.DATA as NonNullable<ReturnType<NonNullable<Parameters<typeof createSessionLifecycle>[0]['data']>>>,
    topViewOnLoad: () => S.cameraRuntime.topViewOnLoad(),
    cam: () => S.cameraRuntime.cam(),
    forceGlb: () => !!S.Q.forceGlb,
    resetSessionCursors,
  });
  S.session = session;

  // 初始化：事件绑定 + 动画循环（渲染器惰性创建，画质选择先于首帧定型）
  S.animate();
  S.applyGlbGate();


  Object.assign(S, {
    battleRange,
    setBattleClock,
    seekTo,
    setSpeed,
    teardownSession,
    rebuildRenderer,
    ensureRenderer,
    prepareSessionCamera,
    publishSessionData,
    publishMapOnlyData,
    prepareResolvers,
    resetSessionCursors,
    session
  })
}
