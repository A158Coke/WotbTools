import { createContactShadowControl } from './playback/contactShadowControl.ts'
import { QUALITY_PRESETS, shadowQualityEligible } from './playback/quality.js'
import { confirm as appConfirm } from '../composables/useConfirm.js'
import { GRID_DT } from './playback/util.js'
import { activeEntityAt } from '../replay-local/canonical/facts'
import { lifeAt, defLifeAt } from '../utils/battlePlaybackV2.ts'
import { makeReplacedAt } from './playback/identity.ts'
import { spansContainAt } from './trackInterp.js'
import { createSceneCore } from './playback/renderer.js'
import { createPickReporter } from './playback/pickReport.js'
import type { SceneParts, SceneParams, QualityKey } from './playback/sceneParts.types.js'
import type { LocalPlayback } from '../replay-local/playback/parseLocalPlayback.js'
import type { VehiclePlaybackTrack } from '../types/playback-v2.js'

type RuntimeVehicle = ReturnType<SceneParts['vehicles']['getVehicles']>[number]

export function psP1(S: SceneParts, P: SceneParams): void {
  // ---------- 全局状态 ----------
                   // PlaybackData（当前会话）
  /** eid → 协议精确 AoI 段 flat [t0,t1,...]（来自 DATA.visibility；3D 炮塔/侧倾采样用） */
  
  /** 共享位姿采样器的时间轴（DATA 就位时写入；见 replay-local/pose/vehiclePose.ts）。
   *  唯一 owner 仍在本闭包（canonical 事实域），按引用共享给 vehicleRuntime。 */
  const POSE_GRID = { tStart: 0, samples: 0 };
  // 阵营/炮线调色（COLOR_* / TRACER_*，含深色板与炮线亮色的语义注释）在
  // ./playback/palette.js（调色唯一事实源，与 quality.js/pure.js 同款拆分）。
  // 车辆运行时（{def, group, turretG, gunPivot, labelAnchor, meshHull, glb}）与 GLB 模板缓存、
  // 履带印缓存的唯一 owner = playback/vehicleRuntime.ts / playback/treadRuntime.ts
  //（#820 Step 4 出仓；本闭包经 vehicles/tread 句柄读写，语义与拆分前逐字一致）
  
  // 地图预览（loadMapOnly）没有回放传输：T 恒 0。环境动画（草风摆/动画混合层/水波）
  // 在地图预览里**全部冻结为初始静态**（2026-11-17 用户裁示：动画会把反射/贴图硬边
  // 放大成白边）；回放会话仍严格跟随回放时钟 T（暂停/seek 相位可复现）。
  // 战斗时间轴 [START, END]：引擎是唯一权威（store.startTime / store.duration 只是发布）。0 = 开战，与 2D 同一个时钟：
  // 工作台 canonical 的 clock（面板经 setBattleClock 交给引擎）优先，canonical 未就绪 / 失败时用场景按同一
  // resolveReplayClock 从自身 periods 推出的 sceneClock，都没有才退回数据范围（t_start → battleEnd.js）。
  // 播放 / seek（seekTo / seekBy / seekFraction）/ 自动停止 / 进度比例 / 胜负横幅全部以它为准。
  
  
  // Derived identity index only; ReplaySession still owns every canonical life fact.
  
  // 相机状态（CAM/FOLLOW_EID/topViewOnLoad/录像者 facet/开镜隐藏层/呈现过渡）与
  // fly 接管、穿深着色、场景选中语义的唯一 owner = playback/cameraRuntime.ts
  //（#820 Step 4 出仓；本闭包经 cameraRuntime 句柄读写，语义与拆分前逐字一致）
  
     // 逐图光照（applyMapLighting 覆盖，见 load 流程）
  // 世界/地形/地图资产状态（mapPlane/heightField/mapScenery/destruct/envTexture…）与
  // 逐图 IBL envTexture/envMultiplier 的唯一 owner = playback/mapWorld.ts（#820 Step 2 出仓）。
  
  // 名牌偏好（classIcons/showMarkerStatus）与 HTML 标签游标的唯一 owner = playback/labelsRuntime.ts
  //（#820 Step 5 出仓；本闭包经 labels 句柄读写）
  // 高度场只有一份（客户端同构：渲染/查询/放置全用真值场）。让位掩码（v0.4.2 的"渲染场"副本
  // 概念）与"贴地结构脚印"细分判据均已撤销（2026-10-11 用户裁示：只对齐客户端，不自创补偿）。
  // ---------- 3D annotation（selected-surface drawing；无 surfaceY 时 terrain fallback）----------
  // GPU 资源 / rebuild 编排 / 地表拾取 / pointer 手势状态机的唯一 owner =
  // playback/annotationScene.ts（#820 Step 5 出仓；本闭包经 annotationScene 句柄读写，
  // 语义与拆分前逐字一致。committed annotation 的权威 owner 仍是 Replay3DPane）。
  
  // 会话代数三计数与 SESSION_MODE 的唯一 owner = playback/sessionLifecycle.ts
  //（#820 Step 1 出仓；本闭包经 session handle 读写，语义与拆分前逐字一致）
  /**
   * 地图预览会话的基地模式（'supremacy' | 'assault' | null）：宿主经 setMapBasesKind
   * 显式选择画哪组贴地基地环。回放会话不消费它（模式由 DATA 轨迹判，语义红线）；
   * teardown 随会话复位为 null。
   */
  
  /**
   * 地图预览会话的出生点列（#835）：宿主经 setMapSpawns 下发语义档案
   * （common/map-semantics → parseMapGridProfile.spawnPoints）解析出的点列；
   * 几何与渲染 fail-closed 在 playback/spawns.ts，本闭包只持数组的引用。
   * 回放会话不消费；teardown 随会话复位为 null。
   */
  
  // 渲染帧句柄：destroy 显式 cancel（旧实现依赖 destroyed 标志的自然退出，
  // 帧回调在 destroy 后仍可能再排队一次）
  
  /**
   * 宿主可见性闸门（Replay3DPane 的 `active`）：工作台切到别的能力时停帧——
   * rAF、相机 update、标签/基地重绘全部停止，**不销毁场景**（切回不重解析、
   * 保留 timeline / 相机 / 画质档）。恢复时重置时钟，否则暂停期间累积的 dt
   * 会让第一帧直接跳进战斗。
   */
  
  // 诊断强引用仅在显式 debug 下创建（生产不挂 window.__scene 等长生命周期引用）
  const DEBUG = (() => { try { return new URLSearchParams(location.search).has('debug'); } catch (e) { return false; } })();
  // 点击拾取调试（pickDebug.js）：dev 构建且 ?admin=1 / ?debug=1 时，单击场景任意物体
  // 即报告节点名/场景坐标/destructibles 实例（id、serverId cell+slot）。生产构建恒关。
  const PICK_DEBUG = (() => {
    if (!import.meta.env.DEV) return false;
    try {
      const q = new URLSearchParams(location.search);
      return q.has('admin') || q.has('debug');
    } catch (e) { return false; }
  })();
  // 渲染性能偏好（播放组件 Display 面板可切，localStorage 持久化；URL 参数最高优先）。
  // - logdepth（对数深度）：默认**关**——每片元写 gl_FragDepth + 禁 early-z，对
  //   alpha-test 植被的填充率开销是乘法级（真机 A/B 权衡后默认关闭）；代价是 600m+
  //   俯瞰时贴地薄板/重建地形交叠带可能成片 z-fighting（开启即恢复确定性深度序）。
  // - dynres（动态分辨率）：默认**开**——持续超帧预算降 DPR、有余量升回档位上限
  //  （纯函数状态机 scene/dynRes.js），负载起伏的软着陆。
  // 实例级可变量（非 const）：待开播阶段只持久化 + 同步 store，下次 initScene 按新偏好装配。
  
  
  

  // ---------- 画质分档 ----------
  // 解析优先级：URL ?q= > localStorage > 设备默认（实现在 playback/preferences.ts；
  // 四档都开 3D 地形，仅分段数降档；预设表用模块级 QUALITY_PRESETS，与面板共享）。
  
  P.store.qualityKey = S.QKEY;
  P.store.qualityLabel = '画质 · ' + S.Q.label;
  P.store.logdepth = S.LOGDEPTH;   // Display 面板开关的初始态（偏好解析见上方 prefOf）
  P.store.dynres = S.DYNRES;
  P.store.armorHighlight = S.ARMOR_HIGHLIGHT;
  // 接地阴影控制域（选择不持久化，语义见 contactShadowControl.ts 头注释）
  const contactShadowCtl = createContactShadowControl({
    store: P.store, qualityKey: () => S.QKEY, getScene: () => S.scene, getSunLight: () => S.sunLight,
    surfaceHeightAt: (x, z) => S.mapWorld.annotationSurfaceHeightAt(x, z) as number, stencilAssembled: () => !!S.rendererCaps?.stencil,
  });
  // 装配段替换（建场景后才有反射句柄）；dirty frame 强制刷新反射（按需渲染只有一帧）。
  
  
  function setQuality(raw: string): void {
    const k = raw as QualityKey;
    if (!QUALITY_PRESETS[k] || k === S.QKEY) return;
    const apply = () => {
      if (S.perf) S.perf.interrupt('quality-change');
      S.QKEY = k; S.Q = QUALITY_PRESETS[k] as typeof S.Q;
      try { localStorage.setItem('pb_quality', k); } catch (e) {}
      P.store.qualityKey = S.QKEY;
      P.store.qualityLabel = '画质 · ' + S.Q.label;
      if (!shadowQualityEligible(k)) contactShadowCtl.setEnabled(false);   // 降档清零；再升档不自动恢复
      S.applyQualityFeatures();
      applyGlbGate();
    };
    if (S.DATA) {
      // 已在播放：渲染参数一次性定型，切换档位需带新 ?q= 整页重载
      // （Tauri WebView 不弹 confirm 对话框，直接重载）
      // 应用内确认对话框（审计 PG-09：不用 window.confirm）；文案沿用本模块的上游中文
      const reload = () => {
        if (S.perf) S.perf.interrupt('quality-change');
        try { localStorage.setItem('pb_quality', k); } catch (e) {}
        const u = new URL(location.href); u.searchParams.set('q', k); location.replace(u);
      };
      if (window.__TAURI__) { reload(); return; }
      appConfirm({
        title: '切换画质',
        message: '切换到「' + QUALITY_PRESETS[k].label + '」画质将重新加载回放，继续？',
      }).then((ok: boolean) => { if (ok) reload(); });
      return;   // 取消则维持原档
    }
    apply();
  }
  // 低档强制盒子代理（14 车 ×数 MB GLB 下载 + PBR 填充率是移动端主要瓶颈之一）；
  // 高/极致反向强制 GLB（履带印轨距一致性，见 QUALITY_PRESETS 注）
  function applyGlbGate() {
    P.store.glbAllowed = S.Q.allowGlb && !S.Q.forceGlb;   // 强制档：开关停用（UI disabled + 提示）
    P.store.treadAllowed = !!S.Q.treadMarks;
    if (S.Q.forceGlb) {
      P.store.glbOn = true;
      if (!S.vehicles.glbOn()) S.vehicles.applyGlbToggle(true);
    } else if (!S.Q.allowGlb) {
      P.store.glbOn = false;
      if (S.vehicles.glbOn()) S.vehicles.applyGlbToggle(false);
    }
  }

  // ---------- 工具 ----------
  //（wrapPi 随车辆运行时出仓 playback/vehicleRuntime.ts——仅 applyPose/glbTurretMatrix 消费）

  function idxOf(t: number): number {
    const data = S.DATA;
    return data ? Math.floor((t - data.meta.t_start) / GRID_DT) : 0;
  }

  // 位姿求值（poseOf/poseStash/posAt/yawAt/hullPitchAt/turretAbsAt/gunPitchAt/rollAt）
  // 随车辆运行时出仓 playback/vehicleRuntime.ts（#820 Step 4）；宿主经 vehicles 句柄消费。
  // 位姿采样复用对象（每帧多车高频调用，零分配）
  //（_poseOut 一并随迁）

  function hpAt(v: RuntimeVehicle, t: number): number {
    const hp = v.def.hp ?? []; let cur = v.def.max_hp ?? 0;
    for (const [ht, hv] of hp) { if (ht <= t) cur = hv; else break; }
    return cur;
  }
  function canonicalLifeTrack(v: RuntimeVehicle, canonical: LocalPlayback): VehiclePlaybackTrack | undefined {
    const tracks = canonical.dataset?.vehicles;
    if (!tracks) return undefined;
    if (tracks !== S.lifeTracks) {
      S.lifeTracks = tracks;
      S.lifeTracksByAccount = new Map(tracks.map(track => [track.accountId, track]));
    }
    return S.lifeTracksByAccount.get(v.def.account_id);
  }
  /** Use the producer's canonical identity evidence; older local sessions retain coverage-based identity. */
  function canonicalDeathAppliesTo(v: RuntimeVehicle, rawDeath: number, canonical: LocalPlayback): boolean {
    const starts = canonical.entityStartsByAccount?.get(v.def.account_id);
    if (starts && canonical.clock) return activeEntityAt(starts, rawDeath - canonical.clock.startRaw) === v.def.eid;
    const siblings = S.vehicles.getVehicles().filter(candidate => candidate.def.account_id === v.def.account_id);
    if (siblings.length === 1) return Number.isFinite(rawDeath);
    const legacyStarts = new Map(siblings.map(candidate => [candidate.def.eid, candidate.def.coverage?.[0] ?? null]));
    return activeEntityAt(legacyStarts, rawDeath) === v.def.eid;
  }
  /** Canonical life uses battle-relative seconds; this render boundary returns raw seconds like T. */
  function sceneLifeAt(v: RuntimeVehicle, t: number): { lifeState?: string; destroyedKnownAtSec?: number | null } | null {
    const canonical = P.store.playbackSession?.canonical;
    const canonicalClock = canonical?.clock;
    if (canonical?.dataset?.vehicles && canonicalClock && Number.isFinite(canonicalClock.startRaw)) {
      const track = canonicalLifeTrack(v, canonical);
      if (!track) return null;
      const life = lifeAt(track, t - canonicalClock.startRaw);
      if (!life) return null;
      if (life.lifeState === 'DESTROYED') {
        const transition = track.lifeTransitions.find(item => item.lifeState === 'DESTROYED');
        const death = (life.destroyedKnownAtSec ?? transition?.timeSec ?? Number.NaN) + canonicalClock.startRaw;
        if (!canonicalDeathAppliesTo(v, death, canonical)) return null;
      }
      return {
        lifeState: life.lifeState,
        destroyedKnownAtSec: Number.isFinite(life.destroyedKnownAtSec)
          ? (life.destroyedKnownAtSec as number) + canonicalClock.startRaw : null,
      };
    }
    // Canonical may still be loading/fail: retain the existing authoritative scene fact, never HP.
    // def 层复活轨道感知（issue #622）：复活字段缺省 = 死亡终态（行为与既往逐位一致）。
    return defLifeAt(v.def, t);
  }
  function deathAt(v: RuntimeVehicle, t: number): boolean { return sceneLifeAt(v, t)?.lifeState === 'DESTROYED'; }
  const replacedAt = makeReplacedAt({ // 身份替换判据（见 playback/identity.ts，时间感知）
    canonical: () => P.store.playbackSession?.canonical,
    vehicles: () => S.vehicles.getVehicles().map(v => ({ eid: v.def.eid, account_id: v.def.account_id, coverage: v.def.coverage })),
    spansOf: (id) => S.VIS_BY_EID.get(id),
  });
  function visibleAt(v: RuntimeVehicle, t: number): boolean {
    // 活车按**协议精确 visibility** 显隐（coverage 只保证"有采样"，短隐藏段不断开）；
    // 否则隐藏期仍会显示车辆并把炮塔/炮管插值到下一段。死亡残骸例外由 applyPose
    // 的 `|| dead` 保留。
    return spansContainAt(S.VIS_BY_EID.get(v.def.eid) ?? v.def.coverage, t);
  }

  // ---------- 场景 ----------
  function initScene() {
    // 创建核心（渲染器/相机/控件/灯光/resize+pointer 接线）在 playback/renderer.js
    //（2026-10-24 Step A2 出仓；状态所有权仍在本闭包——解构写回可变绑定）
    const core = createSceneCore({
      container: P.container, quality: S.Q, logdepth: S.LOGDEPTH, dynres: S.DYNRES, stencil: contactShadowCtl.wantsStencil(), debug: DEBUG,
      envTexture: S.mapWorld.envTexture(), envMultiplier: S.mapWorld.envMultiplier() as number,
      onResize, onPointerDown: S.cameraRuntime.onScenePointerDown, onPointerUp: S.cameraRuntime.onScenePointerUp,
      setFollow: (eid: number | null) => S.cameraRuntime.setFollow(eid as number),
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
  function onResize() {
    if (!S.renderer || !S.camera) return;
    // 容器可能随名册布局改变高度；画布与投影必须跟随实际容器。
    const w = Math.max(1, Math.round(P.container.clientWidth));
    const h = Math.max(1, Math.round(P.container.clientHeight));
    S.camera.aspect = w / h;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(w, h);
    S.invalidate();            // 视口变化：下一帧必须重绘
  }
  // ---------- 点击拾取调试（PICK_DEBUG；报告器在 playback/pickReport.js，纯函数在 pickDebug.js） ----------
  
  const pickReporter = createPickReporter();
  // 事件时刻的 ctx 快照（闭包内均为可变绑定，工厂创建期捕获会过期——契约见 pickReport.js 头注释）
  const pickCtx = () => {
    const camera = S.camera; const raycaster = S.raycaster; const scene = S.scene;
    if (!camera || !raycaster || !scene) return null;
    return {
      clock: S.T, vehicles: S.vehicles.getVehicles(), scenery: S.mapWorld.mapScenery(), terrainMesh: S.mapWorld.terrainMesh(), groundMesh: S.mapWorld.groundMesh(),
      destruct: S.mapWorld.destruct(), destructPickList: S.mapWorld.destructPickList() as Parameters<typeof pickReporter.reportPick>[1]['destructPickList'], meshOwner: S.mapWorld.meshOwner() as Parameters<typeof pickReporter.reportPick>[1]['meshOwner'], heightField: S.mapWorld.heightField(), heightMeta: S.mapWorld.heightMeta(),
      camera, raycaster, container: P.container, scene, terrainSpan: S.mapWorld.terrainSpanOf(),
    };
  };
  function reportPick(e: PointerEvent): void { const ctx = pickCtx(); if (ctx) pickReporter.reportPick(e, ctx); }
  // 报告组装/面板/标记的实现自 2026-10-24 起在 playback/pickReport.js（工厂 + ctx 快照）。

  // 世界/地形/地图资产 owner（#820 Step 2 出仓）：buildWorld / loadMapImage / sampleHeight /
  // 地形 LOD / rebuildGround / 可破坏物推进 / 逐图光照接线 + 会话 teardown 的地图资产段。

  Object.assign(S, {
    POSE_GRID,
    DEBUG,
    PICK_DEBUG,
    contactShadowCtl,
    setQuality,
    applyGlbGate,
    idxOf,
    hpAt,
    canonicalLifeTrack,
    canonicalDeathAppliesTo,
    sceneLifeAt,
    deathAt,
    replacedAt,
    visibleAt,
    initScene,
    onResize,
    pickReporter,
    pickCtx,
    reportPick
  })
}
