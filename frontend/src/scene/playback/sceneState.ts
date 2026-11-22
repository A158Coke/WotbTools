// 场景内核可变状态 / 画质与身份判定 owner（2026-11-22 自 playbackScene.js 闭包出仓，纯搬移）。
// 所有跨子系统共享的可变状态集中在宿主对象 S 上（S.<name> 读写与搬移前闭包逐字一致）；
// 渲染器 / 场景 / 车辆等对象句柄由装配模块写入 S，本模块只做状态初始化与读取。
import { confirm as appConfirm } from '../../composables/useConfirm.js'
import { createVehicleLife } from './vehicleLife.ts'
import { spansContainAt } from '../trackInterp.js'
import { makeReplacedAt } from './identity.ts'
import { GRID_DT } from './util.js'
import { QUALITY_PRESETS, shadowQualityEligible } from './quality.js'
import { boolPref, resolveQualityKey } from './preferences.ts'
import { createContactShadowControl } from './contactShadowControl.ts'
import type { Host } from '../playbackScene.js'
import { bind } from '../hostBind.ts'

export function installSceneState(S: Host) {
  Object.assign(S, {
    setQuality: bind(S, setQuality),
    applyGlbGate: bind(S, applyGlbGate),
    idxOf: bind(S, idxOf),
    hpAt: bind(S, hpAt),
    visibleAt: bind(S, visibleAt),
  })

  // ---------- 全局状态 ----------
  S.DATA = null;                 // PlaybackData（当前会话）
  /** eid → 协议精确 AoI 段 flat [t0,t1,...]（来自 DATA.visibility；3D 炮塔/侧倾采样用） */
  S.VIS_BY_EID = new Map();
  /** 共享位姿采样器的时间轴（DATA 就位时写入；见 replay-local/pose/vehiclePose.ts）。
   *  唯一 owner 仍在本闭包（canonical 事实域），按引用共享给 vehicleRuntime。 */
  S.POSE_GRID = { tStart: 0, samples: 0 };
  // 阵营/炮线调色（COLOR_* / TRACER_*，含深色板与炮线亮色的语义注释）在
  // ./playback/palette.js（调色唯一事实源，与 quality.js/pure.js 同款拆分）。
  // 车辆运行时（{def, group, turretG, gunPivot, labelAnchor, meshHull, glb}）与 GLB 模板缓存、
  // 履带印缓存的唯一 owner = playback/vehicleRuntime.ts / playback/treadRuntime.ts
  //（#820 Step 4 出仓；本闭包经 vehicles/tread 句柄读写，语义与拆分前逐字一致）
  S.T = 0;
  S.PLAYING = false;
  S.SPEED = S.store.speed;
  // 地图预览（loadMapOnly）没有回放传输：T 恒 0。环境动画（草风摆/动画混合层/水波）
  // 在地图预览里**全部冻结为初始静态**（2026-11-17 用户裁示：动画会把反射/贴图硬边
  // 放大成白边）；回放会话仍严格跟随回放时钟 T（暂停/seek 相位可复现）。
  // 战斗时间轴 [START, END]：引擎是唯一权威（store.startTime / store.duration 只是发布）。0 = 开战，与 2D 同一个时钟：
  // 工作台 canonical 的 clock（面板经 setBattleClock 交给引擎）优先，canonical 未就绪 / 失败时用场景按同一
  // resolveReplayClock 从自身 periods 推出的 sceneClock，都没有才退回数据范围（t_start → battleEnd.js）。
  // 播放 / seek（seekTo / seekBy / seekFraction）/ 自动停止 / 进度比例 / 胜负横幅全部以它为准。
  S.START = 0;
  S.END = 0;
  S.sceneClock = null;
  S.canonicalClock = null;
  // Derived identity index only; ReplaySession still owns every canonical life fact.
  // 相机状态（CAM/FOLLOW_EID/topViewOnLoad/录像者 facet/开镜隐藏层/呈现过渡）与
  // fly 接管、穿深着色、场景选中语义的唯一 owner = playback/cameraRuntime.ts
  //（#820 Step 4 出仓；本闭包经 cameraRuntime 句柄读写，语义与拆分前逐字一致）
  S.renderer = null;
  S.scene = undefined;
  S.camera = undefined;
  S.controls = undefined;
  S.clock = undefined;
  S.raycaster = undefined;
  S.hemiLight = null;
  S.sunLight = null;   // 逐图光照（applyMapLighting 覆盖，见 load 流程）
  // 世界/地形/地图资产状态（mapPlane/heightField/mapScenery/destruct/envTexture…）与
  // 逐图 IBL envTexture/envMultiplier 的唯一 owner = playback/mapWorld.ts（#820 Step 2 出仓）。
  S.sizeObserver = null;
  // 名牌偏好（classIcons/showMarkerStatus）与 HTML 标签游标的唯一 owner = playback/labelsRuntime.ts
  //（#820 Step 5 出仓；本闭包经 labels 句柄读写）
  // 高度场只有一份（客户端同构：渲染/查询/放置全用真值场）。让位掩码（v0.4.2 的"渲染场"副本
  // 概念）与"贴地结构脚印"细分判据均已撤销（2026-10-11 用户裁示：只对齐客户端，不自创补偿）。
  // ---------- 3D annotation（selected-surface drawing；无 surfaceY 时 terrain fallback）----------
  // GPU 资源 / rebuild 编排 / 地表拾取 / pointer 手势状态机的唯一 owner =
  // playback/annotationScene.ts（#820 Step 5 出仓；本闭包经 annotationScene 句柄读写，
  // 语义与拆分前逐字一致。committed annotation 的权威 owner 仍是 Replay3DPane）。
  S.destroyed = false;
  // 会话代数三计数与 SESSION_MODE 的唯一 owner = playback/sessionLifecycle.ts
  //（#820 Step 1 出仓；本闭包经 session handle 读写，语义与拆分前逐字一致）
  /**
   * 地图预览会话的基地模式（'supremacy' | 'assault' | null）：宿主经 setMapBasesKind
   * 显式选择画哪组贴地基地环。回放会话不消费它（模式由 DATA 轨迹判，语义红线）；
   * teardown 随会话复位为 null。
   */
  S.MAP_BASES_KIND = null;
  /**
   * 地图预览会话的出生点列（#835）：宿主经 setMapSpawns 下发语义档案
   * （common/map-semantics → parseMapGridProfile.spawnPoints）解析出的点列；
   * 几何与渲染 fail-closed 在 playback/spawns.ts，本闭包只持数组的引用。
   * 回放会话不消费；teardown 随会话复位为 null。
   */
  S.MAP_SPAWN_POINTS = null;
  // 渲染帧句柄：destroy 显式 cancel（旧实现依赖 destroyed 标志的自然退出，
  // 帧回调在 destroy 后仍可能再排队一次）
  S.rafId = 0;
  /**
   * 宿主可见性闸门（Replay3DPane 的 `active`）：工作台切到别的能力时停帧——
   * rAF、相机 update、标签/基地重绘全部停止，**不销毁场景**（切回不重解析、
   * 保留 timeline / 相机 / 画质档）。恢复时重置时钟，否则暂停期间累积的 dt
   * 会让第一帧直接跳进战斗。
   */
  S.paused = false;
  // 诊断强引用仅在显式 debug 下创建（生产不挂 window.__scene 等长生命周期引用）
  S.DEBUG = (() => { try { return new URLSearchParams(location.search).has('debug'); } catch (e) { return false; } })();
  // 点击拾取调试（pickDebug.js）：dev 构建且 ?admin=1 / ?debug=1 时，单击场景任意物体
  // 即报告节点名/场景坐标/destructibles 实例（id、serverId cell+slot）。生产构建恒关。
  S.PICK_DEBUG = (() => {
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
  S.LOGDEPTH = boolPref('pb_logdepth', 'logdepth', false);
  S.DYNRES = boolPref('pb_dynres', 'dynres', true);
  S.ARMOR_HIGHLIGHT = boolPref('pb_armor_highlight', 'armorhl', false);

  // ---------- 画质分档 ----------
  // 解析优先级：URL ?q= > localStorage > 设备默认（实现在 playback/preferences.ts；
  // 四档都开 3D 地形，仅分段数降档；预设表用模块级 QUALITY_PRESETS，与面板共享）。
  S.QKEY = resolveQualityKey();
  S.Q = QUALITY_PRESETS[S.QKEY as keyof typeof QUALITY_PRESETS];
  S.store.qualityKey = S.QKEY;
  S.store.qualityLabel = '画质 · ' + S.Q.label;
  S.store.logdepth = S.LOGDEPTH;   // Display 面板开关的初始态（偏好解析见上方 prefOf）
  S.store.dynres = S.DYNRES;
  S.store.armorHighlight = S.ARMOR_HIGHLIGHT;
  // 接地阴影控制域（选择不持久化，语义见 contactShadowControl.ts 头注释）
  S.contactShadowCtl = createContactShadowControl({
    store: S.store, qualityKey: () => S.QKEY, getScene: () => S.scene, getSunLight: () => S.sunLight,
    surfaceHeightAt: (x, z) => S.mapWorld.annotationSurfaceHeightAt(x, z), stencilAssembled: () => !!S.rendererCaps?.stencil,
  });
  // 装配段替换（建场景后才有反射句柄）；dirty frame 强制刷新反射（按需渲染只有一帧）。
  S.applyQualityFeatures = () => {};
  S.requestWaterReflectionRefresh = () => {};
  function setQuality(S: Host, k: keyof typeof QUALITY_PRESETS) {
    if (!QUALITY_PRESETS[k] || k === S.QKEY) return;
    const apply = () => {
      if (S.perf) S.perf.interrupt('quality-change');
      S.QKEY = k; S.Q = QUALITY_PRESETS[k];
      try { localStorage.setItem('pb_quality', k); } catch (e) {}
      S.store.qualityKey = S.QKEY;
      S.store.qualityLabel = '画质 · ' + S.Q.label;
      if (!shadowQualityEligible(k)) S.contactShadowCtl.setEnabled(false);   // 降档清零；再升档不自动恢复
      S.applyQualityFeatures();
      S.applyGlbGate();
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
      }).then((ok) => { if (ok) reload(); });
      return;   // 取消则维持原档
    }
    apply();
  }
  // 低档强制盒子代理（14 车 ×数 MB GLB 下载 + PBR 填充率是移动端主要瓶颈之一）；
  // 高/极致反向强制 GLB（履带印轨距一致性，见 QUALITY_PRESETS 注）
  function applyGlbGate(S: Host) {
    S.store.glbAllowed = S.Q.allowGlb && !S.Q.forceGlb;   // 强制档：开关停用（UI disabled + 提示）
    S.store.treadAllowed = !!S.Q.treadMarks;
    if (S.Q.forceGlb) {
      S.store.glbOn = true;
      if (!S.vehicles.glbOn()) S.vehicles.applyGlbToggle(true);
    } else if (!S.Q.allowGlb) {
      S.store.glbOn = false;
      if (S.vehicles.glbOn()) S.vehicles.applyGlbToggle(false);
    }
  }

  // ---------- 工具 ----------
  //（wrapPi 随车辆运行时出仓 playback/vehicleRuntime.ts——仅 applyPose/glbTurretMatrix 消费）

  function idxOf(S: Host, t: number) { return Math.floor((t - S.DATA.meta.t_start) / GRID_DT); }

  // 位姿求值（poseOf/poseStash/posAt/yawAt/hullPitchAt/turretAbsAt/gunPitchAt/rollAt）
  // 随车辆运行时出仓 playback/vehicleRuntime.ts（#820 Step 4）；宿主经 vehicles 句柄消费。
  // 位姿采样复用对象（每帧多车高频调用，零分配）
  //（_poseOut 一并随迁）

  function hpAt(_S: Host, v: { def: { hp: ReadonlyArray<readonly [number, number]>; max_hp: number } }, t: number) {
    const hp = v.def.hp; let cur = v.def.max_hp;
    for (const [ht, hv] of hp) { if (ht <= t) cur = hv; else break; }
    return cur;
  }
  S.vehicleLife = createVehicleLife({ getCanonical: () => S.store.playbackSession?.canonical, getVehicles: () => S.vehicles.getVehicles() });
  S.sceneLifeAt = S.vehicleLife.sceneLifeAt;
  S.deathAt = S.vehicleLife.deathAt;
  S.deathTimesOf = S.vehicleLife.deathTimesOf;
  S.replacedAt = makeReplacedAt({ // 身份替换判据（见 playback/identity.ts，时间感知）
    canonical: () => S.store.playbackSession?.canonical,
    vehicles: () => S.vehicles.getVehicles().map((v: { def: { eid: unknown; account_id: unknown; coverage: unknown } }) => ({ eid: v.def.eid, account_id: v.def.account_id, coverage: v.def.coverage })),
    spansOf: (id) => S.VIS_BY_EID.get(id),
  });
  function visibleAt(S: Host, v: { def: { eid: unknown; coverage: unknown } }, t: number) {
    // 活车按**协议精确 visibility** 显隐（coverage 只保证"有采样"，短隐藏段不断开）；
    // 否则隐藏期仍会显示车辆并把炮塔/炮管插值到下一段。死亡残骸例外由 applyPose
    // 的 `|| dead` 保留。
    return spansContainAt(S.VIS_BY_EID.get(v.def.eid) ?? v.def.coverage, t);
  }
}
