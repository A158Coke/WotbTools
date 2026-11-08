// 会话生命周期 owner（#820 结构拆分，2026-11-05 自 initPlayback 闭包出仓）：
// loadData / loadMapOnly / startPlayback 与会话代数三计数（sessionGen 加载代数 /
// loadGeneration 实例令牌 / sessionEpoch 会话身份）的唯一归属。代码与搬移前逐字
// 一致；闭包读数改经 deps 注入（getter 快照），编排的子系统函数由宿主注入——
// 后续拆分（world/vehicle/battle…）落位后由宿主改接线，本模块不再变化。
//
// 会话生命周期契约 v2（评审 P0-2，原文保留）：同场景实例换回放必须 teardown 上一场
// ——load A → dispose A → load B；路由/组件销毁 → dispose 当前会话。异步资产加载带
// generation guard（迟到完成不得污染新会话，迟到的已加载资源随旧会话缓存一并释放）。
//
// 三个计数各司其职（混用会漏掉真实竞态，原文保留）：
// - `sessionGen`（加载代数）：只有新的 loadData / destroy 递增，判定「谁是最新一次加载」；
// - `loadGeneration`（实例内加载令牌）：同上但按实例隔离，配合 destroyed 判定归属；
// - `sessionEpoch`（会话身份）：每次新的 loadData 与 destroy 时递增，判定
//   「startPlayback 的资产续体是否还属于当前会话」。
//   与 sessionGen 分开的原因：sessionGen 表达「加载顺序」，而身份判定需要的是
//   「谁拥有当前会话」。teardown 只销毁旧会话资源、不改身份，否则本次加载自己的
//   资产续体会连同旧会话一起被判过期（正常加载被误伤）。
import { loadPlaybackData, resolveMapKey } from '../replaySource.js'
import { createPerf } from './perf.ts'

type PerfHandle = ReturnType<typeof createPerf>

/** 本模块消费的 PlaybackData 结构面（其余字段由场景内核子系统持有）。 */
export interface SessionPlaybackData {
  meta: { map_id?: number | null; map_name?: string | null; t_start?: number; friendly_team?: number | null; duration?: number | null }
  visibility?: unknown
  vehicles: unknown[]
  shots: unknown[]
  periods: unknown[]
  destructible_events?: unknown[]
}

/** 本模块读写的 store 字段面（store 的唯一 owner 在宿主，本模块只投影这些键）。 */
export interface SessionStore {
  hasData: boolean
  mapReady: boolean
  err: string
  loading: boolean
  assetStage: boolean
  assetProgress: number | null
  playbackSession: unknown
  mapName: string
  startTime: number
  duration: number
}

/** 回放来源（client-only 拓扑：仅 local 文件 / 已装填的 ReplaySession）。 */
export interface LoadSource {
  file?: Blob & { name?: string; lastModified?: number }
  session?: {
    loadScene(file: LoadSource['file'], observer?: SessionPerfObserver): Promise<SessionPlaybackData>
    getState(file: LoadSource['file']): unknown
  }
}

export interface SessionPerfObserver {
  (event: { stage: string; durationMs?: number | null; status?: string | null; digest?: string | null }): void
}

/** 地图预览会话入口参数。 */
export interface LoadMapOnlyOptions {
  mapId: number
  mapName?: string
}

/** 宿主注入的编排依赖（getter 快照 + 命令回调；语义见各字段处原文注释）。 */
export interface SessionLifecycleDeps {
  store: SessionStore
  /** 实例是否已 destroy（归属判定必须同时覆盖「实例还活着」）。 */
  destroyed(): boolean
  /** ?perf 探针（未开启时为 null；PERF 语义见宿主）。 */
  perf(): PerfHandle | null
  /** 拆旧会话资源（宿主持有；teardown 不改会话身份——见头部三计数说明）。 */
  teardownSession(): void
  /** 发布回放数据（宿主唯一 owner：DATA / VIS_BY_EID / POSE_GRID / store.playbackSession）。 */
  publishSessionData(data: SessionPlaybackData, playbackSession: unknown): void
  /** 地图预览 stub 数据发布（空车队；形状与 minimalData 同面，内核测试已证明安全）。 */
  publishMapOnlyData(mapId: number, mapName: string): void
  /** 渲染器就绪（惰性创建 / 偏好失配重建；实现与语义在宿主 renderer 域）。 */
  ensureRenderer(): void
  /** 权威时钟范围（canonical 优先，场景自推兜底；宿主实现）。 */
  battleRange(): [number, number]
  /** 场景自推时钟发布（宿主持有 sceneClock，并用 DATA.periods 现场推导）。 */
  publishSceneClock(): void
  /** 清上一场的 canonical 时钟（新会话就绪后由面板重新交给引擎）。 */
  clearCanonicalClock(): void
  /** 会话开场相机重置（跟随目标不跨回放：非 free 回到俯视机位）。 */
  prepareSessionCamera(): void
  /** 资产面 map key 发布（buildWorld 的 playableBoundsFor 依赖）。 */
  setMapKey(key: string | null): void
  /** GLB 车模偏好（applyGlbToggle 的触发前提）。 */
  getGlbOn(): boolean
  buildWorld(): void
  setCam(mode: string): void
  clampCameraTarget(): void
  constrainFreeCameraAltitude(): void
  loadMapImage(): Promise<void>
  buildBases(): void
  buildSpawns(): void
  buildVehicles(): void
  /** 装配层接地阴影门禁复核 + 资源创建（#907 主干随迁；宿主实现）。 */
  setupContactShadows(): void
  applyGlbToggle(on: boolean): Promise<void>
  buildRoster(): void
  /** 会话级 resolver 装配 + 共享 mounted-configs 预取（宿主 HUD 域实现）。 */
  prepareResolvers(): void
  prewarmShaders(): void
  setPlaying(playing: boolean): void
  tick(): void
  writeHud(force: boolean): void
  invalidate(): void
  loadRecorderCamera(source: LoadSource, epoch: number): void
  /** 战斗反馈事件源（宿主经 transientFeedback3d 工厂持有）。 */
  transients: { rebuildSources(): void; rewindBursts(t: number): void }
  /** 权威时间轴发布（宿主唯一 owner 的 START/END；引擎是唯一权威）。 */
  setClockRange(start: number, end: number): void
  /** 回放时钟（宿主唯一 owner；startPlayback 开战时刻写回）。 */
  setTime(t: number): void
  /** ?debug 车辆运行时暴露（诊断钩子；非 debug 不挂）。 */
  debug: boolean
  exposeVehicles(): void
  /** 当前会话回放数据（宿主唯一 owner 的 DATA 读取面）。 */
  data(): SessionPlaybackData
  /** 俯视开局标记（宿主相机域；跟随目标不跨回放，见 prepareSessionCamera）。 */
  topViewOnLoad(): boolean
  /** 当前相机模式（宿主相机域）。 */
  cam(): string
  /** 高/极致画质档强制 GLB（宿主画质域）。 */
  forceGlb(): boolean
  /** 会话游标复位（shotPtr / 击杀 feed 指针；宿主实现）。 */
  resetSessionCursors(): void
}

export function createSessionLifecycle(deps: SessionLifecycleDeps) {
  const store = deps.store
  // 会话代数三计数（owner 唯一 = 本模块；宿主经 handle 推进）
  let sessionGen = 0;
  /** 加载令牌：只有新的 loadData 递增，用于判定「谁是最新一次加载」（见 loadData 注释） */
  let loadGeneration = 0;
  /**
   * 会话身份：当前「活着的会话」的标识。旧会话的资源续体用它判定自己是否已过期，
   * 而本次加载的资产阶段用它判定自己是否仍是当前会话（见 startPlayback）。
   */
  let sessionEpoch = 0;
  /**
   * 会话模式：'replay'（回放会话，startPlayback 走完整链）| 'map'（地图预览会话，
   * loadMapOnly 提交 stub DATA，startPlayback 只走地图资产前缀——无车辆/传输/HUD）。
   * 由 teardown 复位为 'replay'；startPlayback 在地图资产就绪后按它提前收口。
   */
  let SESSION_MODE: 'replay' | 'map' = 'replay';
  // 性能探针的会话装载段状态（?perf；宿主 animate 经 handle 消费）
  let perfLoadingStart = 0, perfLoadingEpoch = 0, perfFirstSubmitted = false, perfReadySession: number | null = null;

  async function loadData(source: LoadSource) {
    const perf = deps.perf();
    if (perf) { perf.interrupt('file-change'); perf.beginSession(); perf.setIdentity({ replayDigest: null }); perfReadySession = null; perfLoadingStart = performance.now(); perfLoadingEpoch = perf.epoch; perfFirstSubmitted = false; }
    // source 仅接受 { kind:'local', file }（client-only 拓扑，replaySource 对
    // 其他形态显式拒绝）；字符串路径等 server 形态在本拓扑中不存在
    //
    // 归属判定必须同时覆盖两件事：**本实例还活着**（destroyed）且**本代仍是最新一次加载**。
    // 只看 loadGen 不够：`loadGeneration` 是实例内闭包，A 实例被 destroy 后自己的计数器不变，
    // 它会继续把自己评为「最新代」，于是被销毁实例的迟到续体仍能写共享 store（B 用同一个 store）。
    const gen = ++sessionGen;
    const epoch = ++sessionEpoch;
    const loadGen = ++loadGeneration;
    const ownsLoading = () => !deps.destroyed() && loadGen === loadGeneration;
    // 新会话被接受的那一刻，当前场景就不再是「已就绪」：否则解析/资产阶段（可能数秒）
    // 里 HUD、播放传输与 time/roster 仍然代表上一场回放（ready 泄漏 + 旧 UI 可交互）。
    // 与下面的 hasData=true 一起构成不变量：hasData ⟺ 当前会话已完成加载且 DATA 可用。
    store.hasData = false;
    // 上一场的 canonical 时钟不属于这一场：新会话就绪后由面板重新交给引擎（setBattleClock）
    deps.clearCanonicalClock();
    store.err = '';
    store.loading = true;
    store.assetStage = false;
    store.assetProgress = null;
    const diagnosticEpoch = perf?.epoch;
    try {
      // 数据获取在 teardown 之前：新回放解析失败时当前回放保持完好（替换语义 =
      // 新数据就位才拆旧会话）
      const observer: SessionPerfObserver | undefined = perf ? (event) => {
        if (ownsLoading() && gen === sessionGen && diagnosticEpoch === perf.epoch && event.stage === 'replay.identity' && event.digest) perf.setIdentity({ replayDigest: event.digest });
        if (ownsLoading() && gen === sessionGen) perf.event({ stage: event.stage, durationMs: event.durationMs ?? null,
          status: event.status ?? null, digest: event.digest ?? null }, diagnosticEpoch);
      } : undefined;
      const data = source?.session
        ? await (observer ? source.session.loadScene(source.file, observer) : source.session.loadScene(source.file))
        : await loadPlaybackData(observer ? { ...source, observer } : source);
      const playbackSession = source?.session ? source.session.getState(source.file) : null;
      if (gen !== sessionGen) return;   // 迟到：新数据随旧代数 GC（loading 由新所有者管理）
      deps.teardownSession();   // 拆旧会话资源；会话身份已在入口领取，本调用仍是当前会话
      deps.publishSessionData(data, playbackSession);
      deps.loadRecorderCamera(source, epoch);
      // 资产阶段（地图/地形/地表/场景）内部有多个 await：被取代后必须立刻放弃，
      // 否则旧会话会走完 buildVehicles / buildRoster / setPlaying / tick / writeHud 复活自己。
      const ready = await startPlayback(epoch);
      if (!ready || !ownsLoading()) return;
      store.hasData = true;
      if (perf) { perfReadySession = epoch; deps.invalidate(); }
    } catch (e) {
      // 只写原因；标题与重试由宿主页（Scene3DStatus）按当前语言呈现。
      // 只有最新一次加载可以写：旧加载的失败不得覆盖新加载的状态。
      if (ownsLoading()) {
        if (perf) perf.event({ stage: 'replay.load', status: 'error' }, diagnosticEpoch);
        store.err = String((e as { message?: unknown })?.message || e || 'unknown');
      }
    } finally {
      // 只有最新一次加载可以落下 loading；被取代的加载不得提前结束新会话的加载态。
      if (ownsLoading()) store.loading = false;
    }
  }

  /**
   * 地图预览会话（MapPreview3DPane）：不依赖回放文件，只按地图 id 装载地图面资产
   * （ground/terrain/lighting/IBL/scenery/destructibles 完好预状态），无车辆、无传输。
   *
   * 会话纪律与 `loadData` 完全同构（gen/epoch/loadGen 三计数 + ownsLoading 归属判定），
   * 差异只有两处：数据是 stub（`minimalData` 同款形状，空车队已被内核测试证明安全），
   * 且 `startPlayback` 在地图资产就绪后按 `SESSION_MODE === 'map'` 提前收口——就绪标记落
   * `store.mapReady`，`store.hasData` 保持 false（传输/阵容/HUD 门控天然禁用）。
   *
   * @param opts 资产面数字地图 id（resolveMapKey 'id='）
   * @returns {Promise<void>} 就绪/失败都写 store（err / mapReady / assetStage），不抛
   */
  async function loadMapOnly({ mapId, mapName = '' }: LoadMapOnlyOptions) {
    const perf = deps.perf();
    if (perf) { perf.interrupt('map-change'); perf.beginSession(); perfReadySession = null; perfLoadingStart = performance.now(); perfLoadingEpoch = perf.epoch; perfFirstSubmitted = false; }
    const gen = ++sessionGen;
    const epoch = ++sessionEpoch;
    const loadGen = ++loadGeneration;
    const ownsLoading = () => !deps.destroyed() && loadGen === loadGeneration;
    store.hasData = false;
    store.mapReady = false;
    deps.clearCanonicalClock();
    store.err = '';
    store.loading = true;
    store.assetStage = false;
    store.assetProgress = null;
    try {
      if (gen !== sessionGen) return;
      deps.teardownSession();   // 拆旧会话资源（同时复位 SESSION_MODE，下行再声明本会话模式）
      SESSION_MODE = 'map';
      deps.publishMapOnlyData(mapId, mapName);
      const ready = await startPlayback(epoch);
      if (!ready || !ownsLoading()) return;
      store.mapReady = true;
      if (perf) { perfReadySession = epoch; deps.invalidate(); }
    } catch (e) {
      if (ownsLoading()) store.err = String((e as { message?: unknown })?.message || e || 'unknown');
    } finally {
      if (ownsLoading()) store.loading = false;
    }
  }

  /**
   * 进入场景：等待运行所需全部资产（地图/地形/地表/场景 GLB 按画质档）后落成会话。
   *
   * 本函数内部有多个 await；`epoch` 是本会话的身份令牌，**每个 await 之后与最终就绪态之前
   * 都必须复核**。否则被取代的会话会在资产加载返回后继续走完
   * buildVehicles / buildRoster / setPlaying / tick / writeHud，把旧会话复活到新会话身上。
   *
   * @param epoch loadData 提交数据后领取的会话身份（见 loadData 注释）
   * @returns {boolean} true = 本会话仍是当前会话，可以落成就绪态；false = 已过期，调用方必须放弃
   */
  async function startPlayback(epoch: number): Promise<boolean> {
    const current = () => epoch === sessionEpoch && !deps.destroyed();
    // 入口即复核：数据阶段可能耗时到被取代，此时连渲染器都不该为它创建;
    if (!current()) return false;
    deps.ensureRenderer();
    const dataAtStart = deps.data();
    store.mapName = dataAtStart.meta.map_name || ('map_' + dataAtStart.meta.map_id);
    // 提前解析资产面 mapKey：buildWorld 要用 playableBoundsFor（依赖 currentMapKey）；
    // loadMapImage 里的 resolveMapKey 幂等（索引有缓存），不会重复请求。
    {
      const perf = deps.perf();
      const data = deps.data();
      const mid0 = data.meta.map_id || 0;
      const mq0 = mid0 ? ('id=' + mid0) : ('name=' + encodeURIComponent(data.meta.map_name || ''));
      // 场景自己的 currentMapKey（playableBoundsFor 读这个）必须在此赋值——只调不接曾让
      // buildWorld 拿不到可玩矩形、中心回退到车辆云心。
      const perfMapResolveAt = perf ? performance.now() : 0;
      const resolvedKey = await resolveMapKey(mq0).catch(() => null);
      if (perf && current()) perf.event({ stage: 'map-resolution', durationMs: performance.now() - perfMapResolveAt }, perfLoadingEpoch);
      if (!current()) return false;   // 资产解析期间被取代：不得继续动场景
      deps.setMapKey(resolvedKey);
    }
    // 跟随目标不跨回放：新回放回到俯视机位的自由视角，不留下无目标的 follow。
    deps.prepareSessionCamera();
    deps.buildWorld();
    // 默认机位：俯视总览模式（旋转中心 = 地图中心）；仍处于俯视时新地图要重新对心，
    // 保留的自由/跟随机位按新地图重新约束。
    if (deps.topViewOnLoad() || deps.cam() === 'top') deps.setCam('top');
    else if (deps.cam() === 'free') { deps.clampCameraTarget(); deps.constrainFreeCameraAltitude(); }
    // 进入场景前等待运行所需全部资产（评审要求：地图/地形/分层地表/场景 GLB 按
    // 画质档全部就绪后才进场，不再先进场后异步补图）。各段内部已 try/catch——
    // 资产缺失按档位语义降级（回退网格/2D/烘焙底图），等待不因单项缺失而悬挂。
    store.assetStage = true;
    store.assetProgress = null;
    const perf = deps.perf();
    const perfMapAt = perf ? performance.now() : 0;
    try {
      await deps.loadMapImage();
    } catch (e) {
      console.warn('地图资产加载失败（回退网格）:', e);
    } finally {
      if (current()) store.assetStage = false;
    }
    if (perf && current()) perf.event({ stage: 'map-assets-aggregate', durationMs: performance.now() - perfMapAt }, perfLoadingEpoch);
    if (!current()) return false;   // 地图资产期间被取代：后面全是 DATA 派生的会话状态
    if (SESSION_MODE === 'map') {
      if (perf) { perf.event({ stage: 'vehicle-construction', status: 'skipped' }, perfLoadingEpoch); perf.event({ stage: 'glb-wait', status: 'skipped' }, perfLoadingEpoch); perf.event({ stage: 'shader-prewarm', status: 'skipped' }, perfLoadingEpoch); }
      // 地图预览会话：地图资产就绪即完成——车辆/GLB/名册/传输/HUD 全部不建。
      // 相机（top/free）与地形钳制只依赖 heightField/WORLD_CENTER，照常可用；
      // 渲染由 animate() 常驻循环承担，就绪态由 loadMapOnly 落 store.mapReady。
      // 基地贴地环按宿主选的模式建（currentMapBases 已随 loadMapImage 解析）；
      // 地形异步就绪后由 regroundBases 把环带/圆盘重新贴回新地表（与回放同链）。
      // map 会话没有 tick() 驱动（PLAYING 恒 false、按需渲染），首帧必须显式标脏——
      // 否则 canvas 初始为黑，直到用户第一次拖动相机。
      deps.buildBases();
      deps.buildSpawns();   // 出生点贴地标记（#835；宿主下发的语义点列，缺档不画）
      deps.invalidate();
      return true;
    }
    const perfVehiclesAt = perf ? performance.now() : 0;
    deps.buildVehicles();
    // 装配层复核门禁（不只依赖 UI disabled）；map 会话已在上方提前收口，不会走到这里
    deps.setupContactShadows();
    if (perf && current()) perf.event({ stage: 'vehicle-construction', durationMs: performance.now() - perfVehiclesAt }, perfLoadingEpoch);
    const perfGlbAt = perf ? performance.now() : 0;
    if (deps.getGlbOn()) {
      const attach = deps.applyGlbToggle(true);   // 会话切换后按用户偏好恢复 GLB 车模
      if (deps.forceGlb()) {
        // 高/极致（2026-10-11 用户裁示）：进地图前**全部**车辆模型就绪——此前 GLB 在
        // 开始播放后才并发下载，开局数秒是盒子代理，且履带印轨距（suspension 模型
        // halfW）随挂载跳变，起步印记出现侧向折线
        store.assetStage = true;
        try { await attach; } finally { if (current()) store.assetStage = false; }
        if (!current()) return false;
      }
    }
    if (perf && current()) perf.event({ stage: 'glb-wait', durationMs: deps.getGlbOn() && deps.forceGlb() ? performance.now() - perfGlbAt : null, status: !deps.getGlbOn() ? 'skipped' : deps.forceGlb() ? 'complete' : 'background-pending' }, perfLoadingEpoch);
    deps.buildRoster();
    deps.prepareResolvers();
    deps.transients.rebuildSources();   // 战斗反馈事件源（伤害/击毁）
    deps.buildBases();   // 基地贴地标记（争霸 A–D / 单基地）
    // 会话从开战时刻开始：准备 / 倒计时阶段不在时间轴上（与 2D 一致）
    deps.publishSceneClock();
    const [start, end] = deps.battleRange();
    deps.setClockRange(start, end);
    const t = start;
    deps.setTime(t);
    deps.transients.rewindBursts(t);   // 伤害游标由 rebuildSources 归零（开战时刻的事件不跳过）
    deps.resetSessionCursors();
    if (deps.debug) deps.exposeVehicles();   // 调试钩子：控制台可查每车 GLB/位姿状态（仅 ?debug）
    const perfWarmAt = perf ? performance.now() : 0;
    deps.prewarmShaders();
    if (perf && current()) perf.event({ stage: 'shader-prewarm', durationMs: performance.now() - perfWarmAt }, perfLoadingEpoch);
    // 会话常量一次写清（此前每 tick 重写，值不变不会触发响应式，但语义上属会话级）
    store.startTime = start;
    store.duration = end;
    // 最后一处会「启动播放」的写：过期会话绝不允许走到这里（否则旧会话会自己开始 tick）
    if (!current()) return false;
    deps.setPlaying(true);
    deps.tick();
    deps.writeHud(true);   // 会话开始：立即对齐 HUD（不等降频窗口）
    deps.invalidate();
    return true;
  }

  return {
    loadData,
    loadMapOnly,
    startPlayback,
    /** 宿主 teardownSession 递增加载代数（teardown 不改会话身份，见头部说明）。 */
    bumpSessionGen() { sessionGen++; },
    /** 撤下当前回放（reset）：在途续体整体作废的两道闸之一。 */
    invalidateLoadingTokens() { loadGeneration++; sessionEpoch++; },
    /** destroy：被销毁实例与被取代加载走同一条判定路径。 */
    invalidateForDestroy() { loadGeneration++; sessionEpoch++; },
    sessionGen: () => sessionGen,
    sessionEpoch: () => sessionEpoch,
    sessionMode: () => SESSION_MODE,
    setSessionMode(mode: 'replay' | 'map') { SESSION_MODE = mode; },
    /** 就绪会话身份（perf 帧统计归属判定用；null = 尚无就绪会话）。 */
    readySession: () => perfReadySession,
    /** perf 装载段 epoch（宿主 perf event 归属判定用）。 */
    loadingEpoch: () => perfLoadingEpoch,
    /** 首个就绪帧提交（只记一次；宿主 animate 渲染路径调用）。 */
    tryMarkFirstReadyFrame(now: number) {
      const perf = deps.perf();
      if (!perf || perfFirstSubmitted || !(store.hasData || store.mapReady)) return;
      if (perfReadySession !== sessionEpoch || perfLoadingEpoch !== perf.epoch) return;
      perfFirstSubmitted = true;
      perf.event({ stage: 'firstReadyFrameSubmittedMs', durationMs: now - perfLoadingStart }, perfLoadingEpoch);
    },
    /** perf 帧统计归属（perfReadySession === sessionEpoch 的快照判定）。 */
    isReadySession: () => perfReadySession === sessionEpoch,
    /** reset/destroy 的 perf 探针复位（perfReadySession 归属本模块）。 */
    clearReadySession() { perfReadySession = null; },
  };
}

// startPlayback 的 DATA 读取面（map_id/map_name 解析与 sceneClock 推导）经 deps.data
// 注入，避免本模块再依赖宿主内部绑定。
