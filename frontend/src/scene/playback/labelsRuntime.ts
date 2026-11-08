// 标签运行时 owner（#820 结构拆分，2026-11-06 自 initPlayback 闭包出仓）：
// 标签软遮挡（terrainBlocksAim / sceneryBlocksAim / updateLabelOcclusion）、HTML 名牌
// 发布（publishLabels / labelLiftWorld / updateLabels / setLabelPrefs）、会话级 resolver
//（reloadStateAt / consumableStateAt / tankDataByTankId + prepareResolvers 的联表预取）与
// 击杀 feed / 计分 / 名册桥接（hudFeed 工厂 + advanceKills/rebuildFeed/resetScore/
// updateScore/buildRoster/updateRoster/resetKillPtr/resetRoster）的唯一归属。
// 代码与搬移前逐字一致；闭包读数改经 deps 注入（getter 快照）。writeHud /
// teamHpTotals / pointsAt 仍留在宿主（HUD 编排 = 时钟 + 相机 + 名册域）；会话 teardown
// 的标签段收口为 resetSessionState()（labelOverlay.clear + labelsTime/labelsWrittenMs
// 复位 + resolver 清空 + tankData 缓存重建），hudFeed.resetKillPtr()/resetRoster() 保持
// 原调用点与顺序由宿主经 resetCursors()/resetRoster() 触达。
import * as THREE from 'three'
import type { PerspectiveCamera } from 'three'
import { spanStartAt } from '../trackInterp.js'
import { occlusionCells } from './pure.js'
import { createReloadStateResolver } from '../reloadBar.js'
import type { ShellState } from '../reloadBar.js'
import { createConsumableStateResolver } from '../../utils/consumableRuntime.js'
import { GHOST_MS } from '../../utils/battlePlayback.js'
import { createHudFeed } from './hudFeed.js'
import type { HudFeedStore } from './hudFeed.js'
import { assetProvider } from '../assetProvider.js'
import type { TransientFeedback3d } from './transientFeedback3d.js'
import type { RuntimeVehicle } from './vehicleRuntime.js'

/** HTML label 覆盖层结构面（owner = Replay3DPane 的 PlaybackVehicleLabels3D）。 */
export interface LabelsOverlay {
  setLabels(rows: unknown): void
  setAnchor(eid: number, anchor: unknown): void
  clear(): void
}

/** 本模块消费的回放数据面（resolver 联表与击杀 feed 读取；其余由场景内核持有）。 */
export interface LabelsData {
  meta: { friendly_team?: number | null }
  kills?: Array<{ t: number; killer_eid: number; victim_eid: number; cause?: number }>
  vehicles?: Array<Record<string, unknown>>
  [key: string]: unknown
}

/** 本模块触碰的 store 字段（hudFeed 面 + 名牌开关投影）。 */
export type LabelsStore = HudFeedStore & { labelsOn: boolean }

/** 宿主注入的依赖（getter 快照；语义见各字段处原文注释）。 */
export interface LabelsRuntimeDeps {
  store: LabelsStore
  container: HTMLElement
  getCamera(): PerspectiveCamera
  /** 共享 raycaster（场景遮挡 raycast；owner = 宿主渲染器核心）。 */
  getRaycaster(): THREE.Raycaster
  /** 当前会话回放数据（宿主唯一 owner）。 */
  getData(): LabelsData | null
  /** 回放时钟（宿主唯一 owner；发布节流与 resolver 采样）。 */
  getT(): number
  /** 车辆清单（owner = vehicleRuntime）。 */
  getVehicles(): RuntimeVehicle[]
  /** 会话加载代数（击杀 feed 的迟到守卫 + resolver 预取守卫；owner = sessionLifecycle）。 */
  getSessionGen(): number
  /** 跟随目标 eid（名册 followed 高亮；宿主唯一 owner）。 */
  getFollowEid(): number | null
  /** 场景死亡判据（canonical 事实 owner = 宿主 deathAt）。 */
  deathAt(v: RuntimeVehicle, t: number): boolean
  /** HP 采样（宿主唯一 owner）。 */
  hpAt(v: RuntimeVehicle, t: number): number
  /** 协议精确可见性（canonical 事实 owner = 宿主 visibleAt）。 */
  visibleAt(v: RuntimeVehicle, t: number): boolean
  /** 协议精确 AoI 段（宿主唯一 owner 的 VIS_BY_EID 读取）。 */
  visByEid(): Map<number, number[]>
  /** 开镜隐藏的本车 eid（投影判定；宿主唯一 owner）。 */
  scopedHiddenEid(): number
  /** 地形高度采样（owner = mapWorld）。 */
  sampleHeight(x: number, z: number): number
  /** 地形遮挡的高度场判据（owner = mapWorld）。 */
  heightField(): Float32Array | null
  heightMeta(): { size?: unknown; span?: unknown } | null
  /** 静态场景遮挡源（owner = mapWorld）。 */
  mapScenery(): THREE.Object3D | null
  occlGrid(): Map<string, unknown[]> | null

  /** 战斗反馈 transient（HP 幽灵段/受击闪查询；owner = battleRuntime）。 */
  transients: Pick<TransientFeedback3d, 'ghostOf' | 'hasFlash'>
  /** 3D 反馈显示时长倍率（battleRuntime 的 FX_SCALE）。 */
  fxScale(): number
  /** HTML label 覆盖层（宿主可选注入）。 */
  getLabelOverlay(): LabelsOverlay | null
  /** canonical 数据面的车辆轨道（名牌类型图标映射；store.playbackSession 读取面）。 */
  canonicalVehicles(): Array<{ accountId: number; tankClass: string }>
  invalidate(): void
}

/** 标签运行时对外句柄（宿主的唯一消费面）。 */
export interface LabelsRuntimeHandle {
  /** tick 的击杀 feed 推进。 */
  advanceKills(): void
  rebuildFeed(): void
  resetScore(): void
  updateScore(): void
  buildRoster(): void
  updateRoster(): void
  /** animate 逐帧：锚点投影 + 软遮挡 + 名牌发布（原 updateLabels）。 */
  updateLabels(): void
  /** 名牌内容发布（writeHud force 路径消费；原 publishLabels）。 */
  publishLabels(force?: boolean): void
  /** 名牌内容快照失效 + 立即重发（原内部 setLabelPrefs）。 */
  setLabelPrefs(): void
  /** 标签快照失效（transients 的 invalidateLabels 消费点；labelsTime = null）。 */
  invalidateLabels(): void
  /** 名牌偏好（宿主 setLabelPrefs 公开 API 委托写入）。 */
  setClassIcons(on: boolean): void
  setShowMarkerStatus(on: boolean): void
  classIconsVisible(): boolean
  /** 作者标记环显隐（vehicleRuntime 的 deps 消费）。 */
  showMarkerStatus(): boolean
  /** 名牌锚点抬升（原 labelLiftWorld；伤害数字布局消费）。 */
  labelLiftWorld(distance: number): number
  /** 会话级 resolver 装配 + mounted-configs 预取（startPlayback 编排调用）。 */
  prepareResolvers(): void
  /** teardown：labelOverlay.clear + 标签游标/resolver/tankData 缓存复位（原标签段）。 */
  resetSessionState(): void
  /** teardown：击杀游标归零（原 hudFeed.resetKillPtr）。 */
  resetCursors(): void
  /** teardown：eid → 名册行 索引清空（原 hudFeed.resetRoster）。 */
  resetRoster(): void
}

export function createLabelsRuntime(deps: LabelsRuntimeDeps): LabelsRuntimeHandle {
  // ---------- 标签软遮挡（fast-pass）----------
  // camera → 标签锚点做一次视线检测：先撞地形或静态场景 → 该车标签被标记为 occluded。
  // 具体弱化强度由呈现层负责（3D 覆盖层按 utils/labelLayout.js 的
  // LABEL_OCCLUDED_OPACITY 加 `.label-occluded`）——**永不隐藏**，被挡只是明显变淡。
  // 只把地形与静态场景当 blocker，不含其他车辆。
  //
  // 成本控制（不让每个标签每帧都检测）：
  //   · 地形用高度场解析步进（LABEL_OCCL_SAMPLES 次 sampleHeight），不 raycast
  //     512² 地形网格（那是几十万三角形）；
  //   · 场景（建筑/树）才 raycast，且**每 occlStride 帧只检测一辆车**（轮转），
  //     其余帧复用上次结果；
  //   · 单次 raycast 超过 4ms（大图三角形多）自动拉长步长，避免掉帧。
  const LABEL_OCCL_SAMPLES = 16;
  const LABEL_OCCL_BUDGET_MS = 4;
  let occlCursor = 0, occlTick = 0, occlStride = 1, occlCostMs = 0;
  const _occlDir = new THREE.Vector3();

  // 场景遮挡候选格（**性能关键**）：早先对整个 `mapScenery` 做**递归全量**射线检测，
  // 会遍历**整张场景 GLB**（本工程实测 3000+ 节点、含全部树卡片批次）——
  // 单次可达数十~数百毫秒。它在"标签可见 + 正在播放"时按轮转触发，于是表现为
  // **打起来后间歇性整页卡死**（暂停时 `updateLabels` 不跑 → 立刻不卡，恢复播放过一会再卡）。
  // 现在改为：加载场景时把每个可见静态网格按**世界位置 + 包围球半径**登记进粗格
  // （16m），检测时只对"相机→锚点线段经过的格子"里的网格做 raycast。
  //（登记循环随场景装配块在 playback/mapAssets.js，格长常量 OCCL_CELL 亦在其内）
  // 遮挡候选格 owner = mapWorld（装配期构建，随会话场景失效）；此处经 getter 消费。
  /** 单次检测的候选上限：超限直接判"不遮挡"（fail-open，宁可少淡一个标签也不掉帧） */
  const OCCL_MAX_CANDIDATES = 400;

  // 地形遮挡：沿 camera→anchor 采样高度场（地形高过视线即判遮挡）
  function terrainBlocksAim(cx: number, cy: number, cz: number, ax: number, ay: number, az: number) {
    if (!deps.heightField() || !deps.heightMeta()) return false;
    for (let i = 1; i < LABEL_OCCL_SAMPLES; i++) {
      const k = i / LABEL_OCCL_SAMPLES;
      const x = cx + (ax - cx) * k, z = cz + (az - cz) * k;
      const y = cy + (ay - cy) * k;
      if (deps.sampleHeight(x, z) > y + 0.5) return true;
    }
    return false;
  }

  // 静态场景遮挡（建筑/树）：raycast，far 收到锚点之前。
  // **只对线段经过的粗格内的网格**做检测（见 occlGrid 注释）；候选超限则 fail-open。
  function sceneryBlocksAim(anchor: THREE.Vector3) {
    const camera = deps.getCamera();
    const mapScenery = deps.mapScenery(), occlGrid = deps.occlGrid();
    const raycaster = deps.getRaycaster();
    if (!mapScenery || !raycaster || !occlGrid) return false;
    _occlDir.copy(anchor).sub(camera.position);
    const dist = _occlDir.length();
    if (dist < 2) return false;
    _occlDir.divideScalar(dist);
    const cands: unknown[] = [];
    const seenObj = new Set<unknown>();
    for (const key of occlusionCells(camera.position.x, camera.position.z, anchor.x, anchor.z)) {
      const list = occlGrid.get(key);
      if (!list) continue;
      for (const m of list) {
        if (seenObj.has(m)) continue;
        seenObj.add(m);
        cands.push(m);
      }
    }
    if (!cands.length || cands.length > OCCL_MAX_CANDIDATES) return false;   // 无候选/超限 → fail-open
    const prevFar = raycaster.far;
    raycaster.far = dist - 1.0;   // 只关心锚点之前的遮挡物
    raycaster.set(camera.position, _occlDir);
    const hit = raycaster.intersectObjects(cands as THREE.Object3D[], false).length > 0;
    raycaster.far = prevFar;
    return hit;
  }

  function updateLabelOcclusion() {
    const n = deps.getVehicles().length;
    if (!n) return;
    occlStride = Math.min(16, occlCostMs > LABEL_OCCL_BUDGET_MS
      ? occlStride + 1 : Math.max(1, occlStride - 1));
    if (++occlTick < occlStride) return;   // 未到检测帧：沿用缓存结果
    occlTick = 0;
    const v = deps.getVehicles()[occlCursor++ % n];
    if (!v || !v.labelAnchor || !v.group.visible || !deps.store.labelsOn) return;
    const a = v.labelAnchor;
    const camera = deps.getCamera();
    let blocked = terrainBlocksAim(camera.position.x, camera.position.y, camera.position.z,
                                   a.x, a.y, a.z);
    if (!blocked) {
      const t0 = performance.now();
      blocked = sceneryBlocksAim(a);
      occlCostMs = performance.now() - t0;
    } else {
      occlCostMs = 0;
    }
    v.labelOccluded = blocked;
  }

  // HTML label contents are isolated in the child overlay, capped at 10 Hz.
  // Anchors use camera projection at render FPS without mutating Vue state.
  let reloadStateAt: (eid: number, t: number, size?: number) => ShellState[] | null = () => null;
  // 定时消耗品状态 resolver（ACTIVE/COOLDOWN + 剩余秒）；startPlayback 重建，teardown 清空
  let consumableStateAt: (eid: number, t: number, spanStart: number | null | undefined) => unknown[] = () => [];
  // 会话级 mounted-configs（tank_id → tank/{id}.json）：弹容 N 的实际搭载配置联表源
  //（reloadBar.resolveMountedConfig 消费；startPlayback 重建，teardown 清空）
  let tankDataByTankId = new Map<number, unknown>();
  let labelsWrittenMs = -Infinity;
  let labelsTime: number | null = null;
  // 上一轮快照里是否有正在装填（loading）的可见车：装填条是名牌唯一连续变化的元素
  // （HP/身份变化远低于此），有装填时按 ~30Hz 发布让进度平滑，其余时间维持 10Hz
  // （少触发整屏 VDOM patch）。
  let labelsReloadActive = false;
  const LABEL_INTERVAL_RELOAD_MS = 33;
  const LABEL_INTERVAL_IDLE_MS = 100;
  const labelClip = new THREE.Vector4();
  // 零分配锚点：所有车辆共用一个 scratch 喂 labelOverlay.setAnchor——overlay 侧契约是
  // **同步拷贝**进它自有的 per-eid 存储（见 PlaybackVehicleLabels3D.setAnchor），不持有
  // 调用方对象引用，因此逐帧逐车复用同一个对象是安全的（此前每帧每车新建一个对象）。
  const labelAnchorScratch: { x: number; y: number; visible: boolean; occluded: boolean | undefined; projected: boolean } = { x: 0, y: 0, visible: false, occluded: false, projected: false };
  // 名牌偏好（宿主 setLabelPrefs 公开 API 委托写入；见模块头）
  let classIcons = false, showMarkerStatus = true;
  const classIconsVisible = () => classIcons && deps.store.labelsOn;
  function publishLabels(force = false) {
    const labelOverlay = deps.getLabelOverlay();
    const DATA = deps.getData();
    const T = deps.getT();
    if (!DATA || !labelOverlay || !deps.store.labelsOn) return;
    const now = performance.now();
    const interval = labelsReloadActive ? LABEL_INTERVAL_RELOAD_MS : LABEL_INTERVAL_IDLE_MS;
    if (!force && (T === labelsTime || now - labelsWrittenMs < interval)) return;
    labelsWrittenMs = now;
    labelsTime = T;
    const canonicalVehicles = deps.canonicalVehicles();
    const classByAccount = new Map(canonicalVehicles.map((vehicle) => [vehicle.accountId, vehicle.tankClass]));
    const rows = deps.getVehicles().map((v) => {
      const destroyed = deps.deathAt(v, T);
      const current = deps.hpAt(v, T);
      const maxHp = Number(v.def.max_hp);
      const pct = Number.isFinite(maxHp) && maxHp > 0
        ? Math.max(0, Math.min(100, current / maxHp * 100)) : null;
      const friendlyTeam = DATA.meta.friendly_team;
      const friendly = [1, 2].includes(Number(friendlyTeam)) && [1, 2].includes(Number(v.def.team))
        ? v.def.team === friendlyTeam : null;
      const ghost = deps.transients.ghostOf(v.def.eid);
      return {
        eid: v.def.eid, accountId: v.def.account_id, playerName: v.def.nickname || '', tankName: v.def.tank_name || '',
        tankClass: classByAccount.get(v.def.account_id) || '',
        friendly, destroyed, lastKnown: false,
        hp: { current, pct, state: destroyed ? 'DESTROYED' : 'CURRENT' },
        reload: destroyed ? null : reloadStateAt(v.def.eid, T),
        consumables: destroyed || !deps.visibleAt(v, T) ? []
          : consumableStateAt(v.def.eid, T, spanStartAt(deps.visByEid().get(v.def.eid) ?? v.def.coverage, T)),
        hpGhost: ghost ? { prevPct: ghost.toFrac * 100, nextPct: ghost.fromFrac * 100, bornMs: ghost.bornMs, durationMs: GHOST_MS * deps.fxScale() } : null,
        hpFlash: deps.transients.hasFlash(v.def.eid),
      };
    });
    labelsReloadActive = rows.some((r) => Array.isArray(r.reload)
      && r.reload.some((sh) => sh.state === 'loading'));
    labelOverlay.setLabels(rows);
  }
  function setLabelPrefs() {
    labelsTime = null;
    publishLabels(true);
    deps.invalidate();
  }
  // 名牌锚点（= 名牌块底边）相对车体的世界抬升：这是"名牌挂在屏幕哪里"的唯一事实源。
  // 伤害数字在覆盖层里只量"相对锚点的几何"（见 PlaybackVehicleLabels3D.measureDamageLayout），
  // 屏幕位置每帧用当前 anchor 重算；关名牌 / 无血条 / 空名牌时覆盖层回退到这个锚点上方。
  // In symbol mode the icon replaces the hull at its projected position;
  // ordinary labels keep their headroom above the visible vehicle model.
  function labelLiftWorld(distance: number) {
    return classIconsVisible() ? 0.3 : Math.min(6, Math.max(3.25, distance * 0.045));
  }
  function updateLabels() {
    const labelOverlay = deps.getLabelOverlay();
    if (!labelOverlay) return;
    const camera = deps.getCamera();
    camera.updateMatrixWorld();
    for (const v of deps.getVehicles()) {
      const d = camera.position.distanceTo(v.group.position);
      v.labelAnchor.copy(v.group.position);
      v.labelAnchor.y += labelLiftWorld(d);
    }
    updateLabelOcclusion();
    // 视口尺寸在循环内恒定，循环外读一次（逐车 clientWidth/clientHeight 读取有强制布局风险）
    const viewW = deps.container.clientWidth, viewH = deps.container.clientHeight;
    for (const v of deps.getVehicles()) {
      labelClip.set(v.labelAnchor.x, v.labelAnchor.y, v.labelAnchor.z, 1)
        .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      const w = labelClip.w;
      const x = labelClip.x / w, y = labelClip.y / w, z = labelClip.z / w;
      // projected = 车辆在视锥内；visible = 名牌本身是否显示。两者必须分开：伤害数字是
      // 战斗反馈而不是名牌内容，关掉名牌后它仍要有落点（覆盖层里回退到锚点上方）。
      const projected = v.group.visible && v.def.eid !== deps.scopedHiddenEid() && w > 0
        && Number.isFinite(x) && Number.isFinite(y) && z >= -1 && z <= 1
        && x >= -1 && x <= 1 && y >= -1 && y <= 1;
      labelAnchorScratch.x = projected ? (x + 1) * viewW / 2 : 0;
      labelAnchorScratch.y = projected ? (1 - y) * viewH / 2 : 0;
      labelAnchorScratch.projected = projected;
      labelAnchorScratch.visible = projected && deps.store.labelsOn;
      labelAnchorScratch.occluded = v.labelOccluded;
      labelOverlay.setAnchor(v.def.eid, labelAnchorScratch);
    }
    publishLabels();
  }

  // ---------- 击杀 feed / 计分 / 名册（实现在 playback/hudFeed.js；快照式工厂） ----------
  //（原节的语义注释——响应式代理登记、阵营视角映射、resolver 单源——随实现迁往该模块）
  const hudFeed = createHudFeed({
    store: deps.store, getData: () => deps.getData() as Parameters<typeof createHudFeed>[0]['getData'] extends () => infer D ? D : never, getT: () => deps.getT(), getV: () => deps.getVehicles(),
    getSessionGen: () => deps.getSessionGen(), deathAt: deps.deathAt as Parameters<typeof createHudFeed>[0]['deathAt'],
    // reloadStateAt 是闭包 let（prepareResolvers 里重赋值为真实 resolver）——按 getter
    // 注入，工厂不得按值捕获初始空箭头（名册 reload 列会永远为 null）
    getReloadStateAt: () => reloadStateAt,
    getFollowEid: () => deps.getFollowEid(),
  });

  // ---------- 会话级 resolver ----------
  /** 会话级 resolver 装配 + mounted-configs 预取（startPlayback 编排调用）。 */
  function prepareResolvers() {
    const DATA = deps.getData();
    if (!DATA) return;
    // 会话级 mounted-configs 缓存（tank_id → tank/{id}.json）：先建 Map 再建 resolver——
    // resolver 闭包持有同一引用，异步填充后自动生效
    tankDataByTankId = new Map();
    reloadStateAt = createReloadStateResolver({ ...DATA, friendlyTeam: DATA.meta.friendly_team, mountedConfigs: tankDataByTankId } as Parameters<typeof createReloadStateResolver>[0]);
    consumableStateAt = createConsumableStateResolver(DATA as Parameters<typeof createConsumableStateResolver>[0]);
    // 弹容 N：resolver 按「实际搭载配置」取默认（comp locals → 发射弹种 → 初始血量 三级
    // 证据链联表资产面 tank/{id}.json；见 reloadBar.resolveMountedConfig）。多炮坦克各炮
    // 弹容不同，禁止跨配置取最大 / 剩余弹数+1 推断（上游 §六 裁决）。configs 就绪后写入
    // 共享 Map 即生效，这里只需触发一次重绘。
    {
      const mySession = deps.getSessionGen();
      const vehicles = DATA.vehicles ?? [];
      const tankIds = new Set(vehicles
        .filter((v) => v.team === DATA.meta.friendly_team && (v.tank_id as number) > 0)
        .map((v) => v.tank_id as number));
      for (const tid of tankIds) {
        assetProvider.json(`/tank/${tid}.json`).then((t) => {
          if (mySession !== deps.getSessionGen() || !t || tankDataByTankId.get(tid)) return;
          tankDataByTankId.set(tid, t);
          labelsTime = null;
          deps.invalidate();
        }).catch(() => {});
      }
    }
  }

  /** teardown：标签段（对象清单与顺序逐字保留自原 teardownSession 的标签部分）。 */
  function resetSessionState() {
    deps.getLabelOverlay()?.clear();
    labelsTime = null; labelsWrittenMs = -Infinity;
    reloadStateAt = () => null;
    consumableStateAt = () => [];
    tankDataByTankId = new Map();
  }

  return {
    advanceKills: () => hudFeed.advanceKills(),
    rebuildFeed: () => hudFeed.rebuildFeed(),
    resetScore: () => hudFeed.resetScore(),
    updateScore: () => hudFeed.updateScore(),
    buildRoster: () => hudFeed.buildRoster(),
    updateRoster: () => hudFeed.updateRoster(),
    updateLabels,
    publishLabels,
    setLabelPrefs,
    invalidateLabels: () => { labelsTime = null; },
    setClassIcons(on: boolean) { classIcons = on; },
    setShowMarkerStatus(on: boolean) { showMarkerStatus = on; },
    classIconsVisible,
    showMarkerStatus: () => showMarkerStatus,
    labelLiftWorld,
    prepareResolvers,
    resetSessionState,
    resetCursors: () => hudFeed.resetKillPtr(),
    resetRoster: () => hudFeed.resetRoster(),
  };
}
