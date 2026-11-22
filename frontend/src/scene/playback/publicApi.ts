// 场景实例公开 API 组装 owner（2026-11-22 自 playbackScene.js 闭包出仓，纯搬移）：
// initPlayback 返回对象的唯一组装点；公开 API 名与语义（含 getter/setter 形式）保持逐字一致。
import { foliageClip } from '../sceneryMaterials.js'
import { QUALITY_PRESETS } from './quality.js'
import { persistBoolPref } from './preferences.ts'
import type { Host } from '../playbackScene.js'

export function createPlaybackApi(S: Host) {
  return {
    loadData: S.session.loadData,
    loadMapOnly: S.session.loadMapOnly,
    /**
     * 地图预览会话：选择贴地基地环画哪组（'supremacy' | 'assault' | null=隐藏）。
     * 非法值归一为 null（fail-closed）。会话未就绪时只记意图——startPlayback 的
     * map 分支建场景时按它 build；已就绪则立即重建 + 标脏（按需渲染立即见效）。
     * 回放会话调用只记值（会被 teardown 复位），不触碰回放的轨迹判模式语义。
     */
    setMapBasesKind(kind: unknown) {
      S.MAP_BASES_KIND = (kind === 'supremacy' || kind === 'assault') ? kind : null;
      if (S.session.sessionMode() === 'map' && S.store.mapReady) {
        S.buildBases();
        S.invalidate();
      }
    },
    /**
     * 地图预览会话：下发出生点列（#835；语义档案 parseMapGridProfile.spawnPoints 的
     * 解析产物）。非数组归一为 null（fail-closed：缺档/脏值不画不猜，逐条兜底在
     * spawns.build）。推送纪律与 setMapBasesKind 完全一致：会话未就绪时只记意图
     * （startPlayback 的 map 分支按它 build）；已就绪则立即重建 + 标脏。回放会话
     * 调用只记值（会被 teardown 复位），buildSpawns 在回放会话恒传 null。
     */
    setMapSpawns(points: unknown) {
      S.MAP_SPAWN_POINTS = Array.isArray(points) ? points : null;
      if (S.session.sessionMode() === 'map' && S.store.mapReady) {
        S.buildSpawns();
        S.invalidate();
      }
    },
    /**
     * UI Profile 切换（useUiProfile 不 reload/remount）后刷新已有出生点材质颜色：
     * 与 setMapSpawns 同一 map 会话门控；非 map 会话 no-op。宿主（MapPreview3DPane）
     * watch `uiProfile` 触发——2D 出生点随 CSS 自动更新，3D 必须显式同步。
     */
    refreshSpawnColors() {
      S.refreshSpawnColors();
    },
    /**
     * 撤下当前回放（工作台清空选择 / 多文件未选场次 / 玩家换选）：回到「无数据」等待态。
     * 渲染器、画质档与相机保持——重新选回放时不必重建 WebGL 上下文、也不必重选画质；
     * 新数据就位的加载仍走 `loadData` 自己的 loading / asset 阶段（先解析、资产就绪后才
     * `hasData`），所以这里只负责把上一场彻底清干净，不留下任何「还在呈现旧回放」的残留。
     *
     * 撤下发生在**加载途中**时（换选 / 清空都可能落在解析或资产阶段里），在途续体必须整体
     * 作废：解析阶段的迟到数据已由 `teardownSession` 递增的 `sessionGen` 挡下（不会落成
     * `DATA`），这里再补上另两道闸——`sessionEpoch` 让 `startPlayback` 的资产续体在触到场景
     * 之前返回；`loadGeneration` 让被撤下的加载不得再写 store（否则 `teardownSession` 清空
     * `DATA` 后旧续体会在 `DATA.vehicles` 上抛错，把内部异常当「加载失败」写给用户）。
     */
    reset() {
      if (S.perf) { S.perf.interrupt('session-reset'); S.perf.beginSession(); S.session.clearReadySession(); S.perf.setIdentity({ replayDigest: null }); }
      S.session.invalidateLoadingTokens();
      S.teardownSession();               // 车辆/地图/地形/特效/GLB 模板全量释放 + roster/HP/点数归零
      S.setPlaying(false);
      S.store.hasData = false;
      S.store.mapReady = false;
      S.store.loading = false;
      S.store.assetStage = false;
      S.store.assetProgress = null;
      S.store.assetIssues = [];
      S.store.assetDegraded = false;
      S.store.err = '';
      S.store.scoreFriend = 0;
      S.store.scoreEnemy = 0;
      S.store.mapName = '';
      S.store.mapKey = null;
      S.store.startTime = 0;
      S.store.duration = 0;
      S.store.time = 0;
      S.store.seekFrac = 0;
      S.invalidate();
    },
    togglePlay: () => S.setPlaying(!S.PLAYING),
    setPlaying: S.setPlaying,
    /**
     * committed annotations 的 projection input（权威 owner = Replay3DPane）。
     * 同引用重复调用跳过；scene 不修改数组，也不把它当可回写状态。
     */
    setAnnotations: (annotations: unknown) => S.annotationScene.setAnnotations(annotations),
    /**
     * drawing tool 配置（pane 是唯一 owner）。width/eraserWidth 是 CSS px 视觉值；
     * scene 在 gesture 起点换算 semantic 尺寸。只在 enabled/tool 变化时取消 draft。
     */
    setAnnotationInteraction: (config: { enabled?: boolean; tool?: string; width?: number; eraserWidth?: number } = {}) => S.annotationScene.setAnnotationInteraction(config),
    /** 只切 renderer 可见性；不删 state、不写 history、不重建 geometry。 */
    setAnnotationsVisible: (visible: boolean) => S.annotationScene.setAnnotationsVisible(visible),
    setSpeed: S.setSpeed,
    setFlySpeed: (n: number) => S.cameraRuntime.setFlySpeed(n),
    flyTick: (dt: number, pressed: Set<string>) => S.cameraRuntime.flyTick(dt, pressed),
    invalidate: S.invalidate,
    seekFraction: (frac: number) => { if (S.DATA) S.seekTo(S.START + frac * (S.END - S.START)); },
    // 共用播放控件（PlaybackTransport）按绝对秒 seek / 跳秒；seekTo 自带 [START, END] 夹取（准备 / 倒计时阶段回不去）
    seekTime: (t: number) => { if (S.DATA) S.seekTo(t); },
    seekBy: (delta: number) => { if (S.DATA) S.seekTo(S.T + delta); },
    setBattleClock: S.setBattleClock,
    setCam: (mode: string) => S.cameraRuntime.setCam(mode),
    // 移动端竖向距离滑条（实现 owner = cameraRuntime）
    cameraDistanceState: () => S.cameraRuntime.cameraDistanceState(),
    setCameraDistance: (v: number) => S.cameraRuntime.setCameraDistance(v),
    /** 触屏相机契约开关（usePlaybackPhoneForm 判定，watch 下发；状态 owner = cameraRuntime）。 */
    setMobileTouch: (enabled: boolean) => S.cameraRuntime.setMobileTouch(enabled),
    setFollow: (eid: number | null) => S.cameraRuntime.setFollow(eid),
    setGlb: (on: boolean) => { if (!S.Q.forceGlb && (S.Q.allowGlb || !on)) S.vehicles.applyGlbToggle(on); S.invalidate(); },
    // 地面履带印开关（会话级，不持久化；关→开从 START 全量补铺，见 updateTrails）
    setTreadMarks: (on: boolean) => {
      S.store.treadOn = !!on;
      // 立即同步（review P2 2026-10-11）：writeTrailQuads/可见性只由 tick 驱动，而暂停时
      // animate 不 tick——只改 store 的话，暂停态 setTreadMarks(false) 后 mesh.visible 仍是
      // true（实测），必须继续播放或 seek 才更新。这里直接跑一次游标泵（幂等：同 T 重入
      // 不产生新段，全量重建也由 builtT=-∞ 路径确定性收敛）。
      S.tread.updateTrails();
      S.invalidate();
    },
    /**
     * 共享标签偏好（唯一 owner = usePlaybackPreferences）。契约：
     * - `enabled:false` → 整层名牌隐藏。伤害数字是战斗反馈而不是名牌内容：覆盖层收到
     *   的 anchor 仍带 `projected`，关名牌时数字回退到锚点上方继续显示；
     * - `showPlayerName / showTankName / showHp / showReload` → 名牌内部的行开关。
     * - `classIcons` → 使用 HTML 类型图标替换模型，保留事实 root 与拾取。
     * - `showStatus` → 作者标记环。战斗反馈（伤害数字 / 幽灵段 / 受击闪）不受它控制，
     *   只随 `enabled:false`（隐藏全部 UI）对应的覆盖层整层隐藏一起消失。
     */
    setLabelPrefs: (prefs: { enabled?: boolean; lastKnown?: boolean; classIcons?: boolean; showStatus?: boolean; showPlayerName?: boolean; showTankName?: boolean; showHp?: boolean; showReload?: boolean } | null | undefined = {}) => {
      const enabled = !prefs || prefs.enabled !== false;
      S.store.labelsOn = enabled;
      // 最后已知呈现（可视性诚实呈现；偏好唯一 owner = usePlaybackPreferences，经面板推入）。
      // 暂停时 applyPose 不逐帧跑：开关变化必须立即重摆一次（与 setTreadMarks 同理由）。
      const lastKnownOn = prefs?.lastKnown !== false;
      const lastKnownChanged = S.store.lastKnownOn !== lastKnownOn;
      S.store.lastKnownOn = lastKnownOn;
      S.labels.setClassIcons(prefs?.classIcons === true);
      S.labels.setShowMarkerStatus(prefs?.showStatus !== false);
      // Keep factual visibility and the raycast roots intact. Only artwork is
      // replaced; projected icon buttons continue selecting the same entity.
      for (const v of S.vehicles.getVehicles()) {
        S.vehicles.setLowPoly(v, !v.glb);
        S.vehicles.applyDetachedTurrets(v);
        if (v.glb) v.glb.visible = v.group.visible && !S.labels.classIconsVisible();
        S.vehicles.syncContactShadow(v);   // 类型图标替换后阴影随显隐（#907 主干随迁）
      }
      if (lastKnownChanged) for (const v of S.vehicles.getVehicles()) S.vehicles.applyPose(v);
      S.labels.setLabelPrefs();
      if (S.camera) S.labels.updateLabels();
    },
    // 渲染性能偏好切换：只持久化 + 同步 store（待开播阶段渲染器未创建，下次
    // initScene 按当前偏好装配——不重载、不重建；开关已移至待开播卡片，
    // 播放中不存在该入口）。
    setLogdepth: (on: boolean) => {
      S.LOGDEPTH = !!on;
      persistBoolPref('pb_logdepth', on);
      S.store.logdepth = !!on;
    },
    setDynres: (on: boolean) => {
      S.DYNRES = !!on;
      persistBoolPref('pb_dynres', on);
      S.store.dynres = !!on;
    },
    setArmorHighlight: (on: boolean) => {
      if (S.perf && S.ARMOR_HIGHLIGHT !== !!on) S.perf.interrupt('armor-setting-change');
      S.ARMOR_HIGHLIGHT = !!on;
      persistBoolPref('pb_armor_highlight', on);
      S.store.armorHighlight = !!on;
      if (!S.ARMOR_HIGHLIGHT) {
        // 关闭即释放 RT；模板与目标保留，重新打开时不再重新下载/构建。
        S.cameraRuntime.releaseArmorHighlightRenderTargets();
      } else if (S.cameraRuntime.cam() === 'recorder' && S.renderer) {
        S.cameraRuntime.prewarmArmorHighlight(S.camera);
      }
      S.invalidate();
    },
    setContactShadows: (on: boolean) => S.contactShadowCtl.setEnabled(on),
    setQuality: S.setQuality,
    setPaused: S.setPaused,
    qualityPresets: QUALITY_PRESETS,
    destroy() {
      S.destroyed = true;
      foliageClip.value = 0;
      S.cameraRuntime.flyLookApplyMode('follow');   // 恢复 controls 原生状态（实例随即销毁，防残 handedness）
      S.session.invalidateForDestroy();
      S.store.loading = false;
      S.store.assetStage = false;
      S.store.assetProgress = null;
      S.store.assetIssues = [];
      S.store.assetDegraded = false;
      // 使本实例所有在途 loadData 的归属判定永久失效：仅有 `destroyed` 也能挡住，
      // 但把加载令牌一并推进让「被销毁的实例」与「被取代的加载」走同一条判定路径
      // （ownsLoading 同时看 destroyed 与 loadGeneration），不依赖单一标志。
      cancelAnimationFrame(S.rafId);   // 显式取消：不等下一帧的 destroyed 自然退出
      S.teardownSession();             // 会话资源（车辆/地图/特效/GLB 模板）全量 dispose
      S.annotationScene.dispose();     // annotation 材质/geometry/group 随实例释放
      removeEventListener('resize', S.onResize);
      // container 由宿主复用（场景销毁 ≠ 舞台销毁）：capture 拦截必须摘除，
      // 否则重建场景后同一事件被多份闭包重复消费（拖拽增量翻倍）。
      S.annotationScene.detach();   // annotation capture 监听（原 5 行 removeEventListener 收口）
      S.cameraRuntime.detachListeners();   // fly capture 监听（原 6 行 removeEventListener 收口）
      S.sizeObserver?.disconnect();
      S.sizeObserver = null;
      if (S.DEBUG) {
        delete window.__scene; delete window.__camera; delete window.__controls; delete window.__setFollow; delete window.__renderer;
        delete window.__pbV; delete window.__gdbg; delete window.__battleFx;
        delete window.__destructStage; delete window.__destructDebug;
        delete window.__waterCoast;
      }
      // ?perf 看门狗随实例销毁停表并摘除调试句柄：实例没了帧循环自然停，但心跳
      // setInterval 不清会永久空转，window.__pbPerf 会指向已销毁实例的旧数据。
      if (S.PERF) {
        S.perfProbe.stopWatchdog();
        S.perf.reset();
        if (window.__pbPerf === S.perfProbe.perfHandle) delete window.__pbPerf;
      }
      if (S.renderer) {
        try { S.renderer.domElement.removeEventListener('pointerdown', S.cameraRuntime.onScenePointerDown); } catch (_) {}
        try { S.renderer.domElement.removeEventListener('pointerup', S.cameraRuntime.onScenePointerUp); } catch (_) {}
      }
      if (S.controls) {
        S.annotationScene.restoreTouches();   // touches.ONE 交还（原 annotation touches 恢复段）
        try { S.controls.dispose(); } catch (_) {}
      }
      if (S.renderer) {
        S.gpu?.dispose();
        S.renderer.dispose();
        try { S.renderer.forceContextLoss(); } catch (_) {}
        S.renderer.domElement.remove();
      }
    },
  };
}
