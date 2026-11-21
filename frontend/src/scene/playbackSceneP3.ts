import * as THREE from 'three'
import { createFrameMeter } from './frameMeter.js'
import { advancePlaybackTime } from '../utils/playbackClock'
import { createPerfProbe } from './playback/perfProbe.ts'
import { createShaderPrewarm } from './playback/shaderPrewarm.ts'
import { applySupremacyPointsToStore } from './supremacyPoints.js'
import { teamHpTotals } from './teamHpTotals.js'

import type { SceneParts, SceneParams } from './playback/sceneParts.types.js'
export function psP3(S: SceneParts, P: SceneParams): void {
  const tmpV = new THREE.Vector3();
               // 跟随模式：上一帧坦克位置（位移增量基准）
  const tmpDir = new THREE.Vector3();  // 进入跟随：相机方向临时量
  const FOLLOW_SNAP_DIST = 26;         // 进入跟随：相机沿当前方向收拢到此距离（米；坦克约 7m 长）
  const FOLLOW_MIN_HEIGHT = 9;         // 进入跟随：相机至少高于坦克此高度（米，保证俯角不贴地）
  // 按需渲染的脏标记：状态跳变（seek/换相机/开关节/尺寸变化/特效到期）必须显式置脏，
  // 否则那一帧的静止状态会一直停留在旧画面上。
  
  function invalidate() { S.frameDirty = true; S.requestWaterReflectionRefresh(); }

  // 实时帧率（FPS 覆盖层）：rAF 回调间隔的 500ms 窗口均值，每窗口写一次 store
  //（每帧只多两次减法；窗口边界才触发一次响应式写入）。暂停 / 恢复时重新起窗。
  const frameMeter = createFrameMeter();
  
     // 场景进入空闲（!busy）后置位；恢复渲染前 re-起窗

  
  function animate() {
    if (S.destroyed) return;
    if (S.paused) { S.rafId = 0; return; }   // 停帧：不排队下一帧，场景与状态原样保留
    S.rafId = requestAnimationFrame(animate);
    if (!S.renderer) return;   // 渲染器惰性创建（首次 startPlayback）：数据加载完成前无场景可渲染
    const cpuStarted = PERF ? performance.now() : 0;
    const dt = Math.min(S.clock.getDelta(), 0.1);
    if (S.DATA && S.PLAYING) {
      // 推进 + 钳制合并到纯函数里（NaN/负增量不会污染时钟）；终点是比赛结束 END，不是录像流结束
      S.T = advancePlaybackTime(S.T, S.END, dt * 1000, S.SPEED);
      S.battle.advanceWreckClock(dt);
      S.vehicles.frameTiming(dt, false);   // 行程限速用的逐帧 dt + 本帧非跳变（客户端同源：按帧步长限速）
      tick();
      if (S.T >= S.END) setPlaying(false);   // 先 tick 后停：停播时的 HUD/名册补写要包含终点帧的事件
    }
    const tickFinished = PERF ? performance.now() : 0;
    // 动画混合层（烟雾/瀑布/浪）：纹理位移按**回放时钟**走——暂停即停、seek 后相位
    // 由回放时刻唯一确定（不随壁钟漂移，截图可复现）。未装载时该数组为空。
    const animLayerMats = S.mapWorld.animLayerMats();
    if (animLayerMats.length) {
      // 地图预览（有地图无回放）：环境动画**全部冻结**为初始静态（用户 2026-11-17 裁示）。
      // 回放会话（hasData）仍严格跟随回放时钟 T；水波材质已在装配期排除出该表。
      const mapMode = !!P.store.mapReady && !P.store.hasData;
      if (!mapMode) {
        const secs = S.T / 1000;
        for (const mm of animLayerMats) mm.uniforms.uTime.value = secs;
      }
      if (S.DEBUG) {
        type AmbientWindow = Window & { __ambient?: { frames?: number; mapMode: boolean; frozen: boolean; mats: number; frames2?: number; paused: boolean; dtMs: number } }
        const ambientWindow = window as AmbientWindow;
        const frames = (ambientWindow.__ambient?.frames ?? 0) + 1;
        ambientWindow.__ambient = { mapMode, frozen: mapMode, mats: animLayerMats.length,
          frames, paused: S.paused, dtMs: Math.round(dt * 1000 * 100) / 100 };
      }
    }
    // 动态光源：固定 16 盏池按相机近邻逐帧换绑（灯数恒定 ⇒ 不触发着色器重编译；
    // 142 盏数据在靠近时都会亮起，见 mapLighting.updateDynamicLights）
    S.mapWorld.tickDynamicLights?.(S.camera.position);
    // 相机
    // 跟随模式：相机位置与视点目标按坦克逐帧位移整体平移——用户选好的方位/
    // 距离/俯仰刚性保持，不会被拉回固定机位；旋转/缩放/平移始终自由
    if (S.DATA && S.cameraRuntime.cam() === 'follow' && S.cameraRuntime.followEid()) {
      const v = S.vehicles.getVehicles().find((x) => x.def.eid === S.cameraRuntime.followEid());
      if (v && v.group.visible) {
        S.vehicles.posAt(v, S.T, tmpV);
        if (!S.followAnchor) {
          S.controls!.target.copy(tmpV);          // 进入跟随：视点先对准车体（旋转中心 = 坦克）
          // 拉近：沿**当前观察方向**把相机收到跟随距离——此前进入跟随只挪视点、相机留在
          // 开局全景位（数百米外），旋转看起来绕着别处转。仅当当前更远时收拢（用户已手动
          // 贴近则不打扰），且不低于 minDistance+2（否则 controls.update 会再推出去）。
          const off = tmpDir.subVectors(S.camera.position, tmpV);
          const snap = Math.max(FOLLOW_SNAP_DIST, (S.controls!.minDistance || 0) + 2);
          if (off.length() > snap) {
            S.camera.position.copy(tmpV).addScaledVector(off.normalize(), snap);
          }
          if (S.camera.position.y < tmpV.y + FOLLOW_MIN_HEIGHT) {
            S.camera.position.y = tmpV.y + FOLLOW_MIN_HEIGHT;
          }
        } else {
          const dx = tmpV.x - S.followAnchor!.x, dy = tmpV.y - S.followAnchor!.y,
                dz = tmpV.z - S.followAnchor!.z;
          S.camera.position.x += dx; S.camera.position.y += dy; S.camera.position.z += dz;
          S.controls!.target.x += dx; S.controls!.target.y += dy; S.controls!.target.z += dz;
        }
        S.followAnchor = (S.followAnchor ?? new THREE.Vector3()).copy(tmpV);
      } else S.followAnchor = null;
    } else S.followAnchor = null;
    if (S.cameraRuntime.cam() === 'recorder') S.cameraRuntime.driveRecorderCamera(dt);
    else S.clampCameraTarget();
    S.cameraRuntime.zoomTick(dt);   // 滚轮缩放预算逐帧收敛（先于 controls.update()：本帧位移当帧可见）
    if (S.cameraRuntime.fovRestore()) S.cameraRuntime.stepFovRestore(dt);
    // flyMode 接管期间 OrbitControls.update() 必须完全停跑：enabled=false 只挡输入
    // 事件、update 照常执行——其内部球面状态会按 target/相机重算，与 flyLook 的
    // target 重钉互相污染（表现 = 拖拽行为在 FPS 转头与 OrbitControls 环绕之间漂移、
    // WASD 位移被球面拉回吞掉）。相机推进由 flyTick 全权负责。
    // flyMode 接管不变量（每帧断言）：enabled 意外被拉回 true 的同一帧压回 false，
    // 杜绝"FPS 转头与环绕/pan 漂移交替"的整类状态漂移。
    if (S.cameraRuntime.flyMode() && S.controls!.enabled) S.controls!.enabled = false;
    // free 接管期间 update() 不跑，它的 lookAt(target) 也随之缺席——相机朝向由本行
    // 维持（target 是权威：拖拽 / 平移 / 缩放都会先重钉 target）。不补这一步，
    // 拖拽只改 target 不改朝向，画面不转（用户实测）。
    if (S.cameraRuntime.flyMode()) S.camera.lookAt(S.controls!.target);
    const cameraMoved = S.cameraRuntime.cameraDriven() ? false : S.controls!.update();   // three 的 update() 返回相机是否变化（阻尼/交互）
    S.clampOrbitCameraToTerrain();
    const cameraFinished = PERF ? performance.now() : 0;
    // ---------- 按需渲染（脏帧）----------
    // 暂停且没有在飞特效、相机也静止时，跳过整帧工作（标签/基地/transient 重算 + 全屏
    // render）。此前空闲也满速重绘，是移动端发热与笔记本耗电的第一来源。
    // 伤害数字不参与这个判定：它是覆盖层 DOM + CSS 动画，暂停时自己走完，不需要出帧。
    const busy = S.PLAYING
      || cameraMoved
      || S.cameraRuntime.cameraBlend() || S.cameraRuntime.fovRestore()
      || S.frameDirty
      || S.mapWorld.destruct()?.animating
      || S.battle.isActive();   // 弹道在飞 / 战斗特效 / 战斗反馈 transient；战场标记是回放时钟窗口状态，不参与 busy 判定
    if (!busy) {
      if (perf) perf.idle();
      // 空闲（场景确实停画，而不是渲染很慢）：显式重起统计窗，避免把空闲间隙
      // 算成一帧；超过 0.6s 把角标归零（显示 —），别让旧帧率冒充“当前”。
      // 注意判定只在这里做——PLAYING 期间即使 300ms/帧也照常计入长帧（评审 P2）。
      const now = performance.now();
      const since = S.lastRenderAt ? now - S.lastRenderAt : Infinity;
      if (since > 250 && !S.fpsIdle) { frameMeter.reset(); S.fpsIdle = true; }
      if (P.store.fps && since > 600) {
        P.store.fps = 0; P.store.frameMs = 0; P.store.framePeakMs = 0;
      }
      return;
    }
    if (S.fpsIdle) { frameMeter.reset(); S.fpsIdle = false; }   // 恢复渲染：全新窗口
    S.lastRenderAt = performance.now();
    // 只统计**真正渲染的帧**：按需渲染下 rAF 每帧都跑（暂停静止也跑），数回调会得到
    // 120 FPS 这种与画面无关的数——用户实测「卡顿和显示的帧率不符」正是这个。
    const fpsStats = frameMeter.sample(S.lastRenderAt);
    if (fpsStats) {
      P.store.fps = fpsStats.fps;
      P.store.frameMs = fpsStats.frameMs;
      P.store.framePeakMs = fpsStats.peakMs;
    }
    S.frameDirty = false;
    // 动态分辨率调整必须在**渲染前**（黑闪根因）：canvas width/height 赋值会清空
    // drawing buffer——若在渲染后调整，合成器在下一帧渲染前取到空 buffer 即黑帧。
    // 渲染前调整则本帧立刻以新分辨率画满，buffer 从不空。dt 取自本帧 rAF。
    if (S.dynResCtl) {
      const nd = S.dynResCtl.frame(dt * 1000);
      if (nd != null) {
        const w = P.container.clientWidth, h = P.container.clientHeight;
        S.renderer.setSize(w, h, false);
        S.renderer.setPixelRatio(nd);
        S.renderer.domElement.style.width = w + 'px';
        S.renderer.domElement.style.height = h + 'px';
      }
    }
    const perfT0 = PERF ? performance.now() : 0;
    // 迟到的回放数据（canonical 位姿/名册重建、markers/chat 数据晚到）在暂停期间到达：
    // invalidate 只驱动本按需重绘帧、不会触发 tick —— 战场标记（攻击目标环等）必须按
    // 当前 T 与最新位姿/名册重算（update(T) 幂等；无标记时是廉价 no-op），否则目标环
    // 会停在迟到数据之前的旧位姿。播放中由 tick() 每帧承担，这里跳过避免双跑。
    // 必须先于 labels.updateLabels()：来源卡投影读的就是本次重算后的环锚点——
    // 先投影后重算会让卡停在旧屏幕坐标（评审 P2 实测 240≠560、隐藏时卡残留）。
    // 战场标记无壁钟动画（回放时钟窗口状态）：播放中逐帧跟随/淡出由 tick 的
    // battleMarkers.update(T) 承担；暂停期间的迟到数据重算见上面的非播放态分支。
    // 迟到的回放数据（canonical 位姿/名册重建、markers/chat 数据晚到）在暂停期间到达：
    // invalidate 只驱动本按需重绘帧、不会触发 tick —— 战场标记（攻击目标环等）必须按
    // 当前 T 与最新位姿/名册重算（update(T) 幂等；无标记时是廉价 no-op），否则目标环
    // 会停在迟到数据之前的旧位姿。播放中由 tick() 每帧承担，这里跳过避免双跑。
    // 必须先于 labels.updateLabels()：来源卡投影读的就是本次重算后的环锚点——
    // 先投影后重算会让卡停在旧屏幕坐标（评审 P2 实测 240≠560、隐藏时卡残留）。
    // 战场标记无壁钟动画（回放时钟窗口状态）：播放中逐帧跟随/淡出由 tick 的
    // battleMarkers.update(T) 承担；暂停期间的迟到数据重算见上面的非播放态分支。
    // 迟到的回放数据（canonical 位姿/名册重建、markers/chat 数据晚到）在暂停期间到达：
    // invalidate 只驱动本按需重绘帧、不会触发 tick —— 战场标记（攻击目标环等）必须按
    // 当前 T 与最新位姿/名册重算（update(T) 幂等；无标记时是廉价 no-op），否则目标环
    // 会停在迟到数据之前的旧位姿。播放中由 tick() 每帧承担，这里跳过避免双跑。
    // 必须先于 labels.updateLabels()：来源卡投影读的就是本次重算后的环锚点——
    // 先投影后重算会让卡停在旧屏幕坐标（评审 P2 实测 240≠560、隐藏时卡残留）。
    if (!(S.DATA && S.PLAYING)) S.battleMarkers.update(S.T);
    S.labels.updateLabels();
    S.updateBases();
    S.battle.transients.updateNow();
    S.battle.updateBattleFx();     // 战斗特效（壁钟特效暂停时也继续自然播完）
    const perfT1 = PERF ? performance.now() : 0;
    S.mapWorld.maybeRebuildTerrainLod();   // 地形 LOD 跟随相机姿态（视距滞回 + 绕转/FOV/aspect；120 ms 节流）
    const terrainFinished = PERF ? performance.now() : 0;
    // 一帧可有多次 render：探针期间手动复位，info 才是整帧累计而不是最后一次 render
    const perfAutoReset = PERF ? S.renderer.info.autoReset : null;
    try {
      if (PERF) { S.renderer.info.autoReset = false; S.renderer.info.reset(); }
      const gpuFrameId = S.session.isReadySession() ? gpu?.beginFrame() ?? null : null;
      // 水面动态反射（HIGH/ULTRA）：镜像 pass 必须在主渲染前完成（RT 供水面着色采样）。
      S.waterReflection.update(S.renderer, S.scene, S.camera);
      const gpuMainStarted = gpu?.begin('main') ?? false;
      try { S.renderer.render(S.scene, S.camera); } finally { if (gpuMainStarted) gpu?.end(); }
      S.session.tryMarkFirstReadyFrame(performance.now());
      const perfR0 = PERF ? performance.now() : 0;
      S.cameraRuntime.renderArmorHighlight();
      gpu?.submitFrame();
      const perfR1 = PERF ? performance.now() : 0;
      if (PERF && S.session.isReadySession()) perfProbe.perfFrame(perfT1 - perfT0, perfR0 - terrainFinished, perfR1 - perfR0, S.cameraRuntime.armorStats() as Parameters<typeof perfProbe.perfFrame>[3], { cpuFrameMs: perfR1 - cpuStarted, tickMs: tickFinished - cpuStarted, cameraMs: cameraFinished - tickFinished, terrainCheckInclusiveMs: terrainFinished - perfT1, gpuFrameId, gpu_total_ms: null });
      gpu?.recorded(gpuFrameId);
    } finally {
      if (PERF) S.renderer.info.autoReset = !!perfAutoReset;
      gpu?.abortFrame();
    }
  }

  // ---------- 性能探针（`?perf`；只读测量，不改变任何渲染行为） ----------
  // 分阶段逐帧耗时 / 主线程停顿看门狗 / window.__pbPerf 调试句柄的唯一 owner =
  // playback/perfProbe.ts（#820 Step 4 出仓）；PERF/perf/gpu 句柄仍由本闭包解构持有
  //（渲染循环与会话编排直接消费）。
  const perfProbe = createPerfProbe({
    container: P.container,
    getT: () => S.T,
    getRenderer: () => S.renderer,
    getQualityKey: () => S.QKEY,
    getArmorHighlightPref: () => S.ARMOR_HIGHLIGHT,
    getCameraMode: () => S.cameraRuntime.cam(),
    paused: () => S.paused,
    terrainCounters: () => S.mapWorld.terrainCounters(),
    resetTerrainCounters: () => S.mapWorld.resetTerrainCounters(),
    battle: S.battle,
    getVehicles: () => S.vehicles.getVehicles(),
    annotationStats: () => S.annotationScene.stats(),
    armorStats: () => S.cameraRuntime.armorStats() as NonNullable<Parameters<typeof perfProbe.perfFrame>[3]>,
    contactShadowsCount: () => S.contactShadowCtl.count(),
  });
  const PERF = perfProbe.PERF;
  const perf = perfProbe.perf;
  const gpu = perfProbe.gpu;
  
     // 当前渲染器实际装配的 { logdepth, dynres, stencil }（reset 保留渲染器时用于失配检测）


  const prewarmShaders = createShaderPrewarm({
    getRenderer: () => S.renderer, getScene: () => S.scene, getCamera: () => S.camera,
    ensureBattleFx: () => S.battle.ensureBattleFx(),
    ensureArmorHighlight: () => S.cameraRuntime.ensureArmorHighlight(),
    armorHighlightPref: () => S.ARMOR_HIGHLIGHT,
  });

  function tick() {
    // 弹道推进（游标/推进 owner = battleRuntime.advanceShotsTo）
    S.battle.advanceShotsTo(S.T);
    S.labels.advanceKills();
    // Visibility/position at this T must precede feedback: a newly destroyed vehicle
    // can become visible again after coverage ended, so last frame's visibility is stale.
    for (const v of S.vehicles.getVehicles()) S.vehicles.applyPose(v);
    S.vehicles.clearSnap();   // pose has consumed the seek snap for this tick
    // 炮口要等本 tick 炮管摆到 T 时刻姿态后再定位；曳光 / 光迹的可见起点（炮口）由它填入，
    // 所以弹道推进排在它之后
    S.battle.flushMuzzles();
    S.battle.updateTracers();
    // 战斗反馈事件泵（回放时钟；壁钟寿命/游标在 playback/transientFeedback3d.ts）
    S.battle.transients.advanceTo(S.T);
    S.battleMarkers.update(S.T);   // 战场标记窗口状态（回放时钟；暂停冻结/倒带重现）
    S.mapWorld.updateDestructibles(S.T);
    S.tread.updateTrails();     // 履带印游标泵（seek 后退 = 全量重算，前进 = 增量）
    S.labels.updateScore();
    // HUD → store
    // 顶栏：争霸实时点数每 tick 确定性重算 + 变更守卫（无采样也写 null，防切场残值）。
    applySupremacyPointsToStore(P.store, S.DATA as Parameters<typeof applySupremacyPointsToStore>[1], S.T);
    // 顶栏：单基地目标存在性 + 占领进度（取 ≤T 最后一条；无目标证据整行不显示）
    writeHud();
    if (!S.winnerShown && S.T >= S.END - 1e-3 && S.DATA!.meta.winner_team) {
      S.winnerShown = true;
      const w = S.DATA!.meta.winner_team, fr = S.DATA!.meta.friendly_team;
      // outcome 供消费方面板三语化（text 为上游兼容中文字段；WotBTools 唯一分叉的加性字段）
      P.store.banner = {
        text: w === 0 ? '平局' : (w === fr ? '胜利' : '失败'),
        color: w === fr ? '#3fa66a' : '#c05046',
        outcome: w === 0 ? 'draw' : (w === fr ? 'win' : 'lose'),
      };
    }
  }

  // ---------- 控制 ----------
  // HUD 降频：store.time / seekFrac 每帧都变会让页面壳（AgentReplay3D）每帧整页 VDOM patch
  // 一次（顶栏 + 双名册 + 击杀流 + 传输控件）。3D 平滑度来自场景时钟，HUD 与进度条按
  // ~10Hz 更新即可；seek / 会话开始 / 停播等状态跳变时 force 立即补一次，语义不丢。
  const HUD_INTERVAL_MS = 100;
  
  function writeHud(force: boolean = false) {
    if (!S.DATA) return;
    const now = performance.now();
    if (!force && now - S.hudWrittenMs < HUD_INTERVAL_MS) return;
    S.hudWrittenMs = now;
    if (force) S.labels.publishLabels(true);
    // 顶栏：双方队伍总血量（与上游 3D 视图同口径：各队 max_hp 汇总；未知阵营不计入任一方，
    // 见 teamHpTotals）。随 HUD 10Hz 节流写入即可——血量每秒变化远低于此，没必要每帧
    // 触发整页 VDOM patch（见上方 HUD_INTERVAL_MS）。
    Object.assign(P.store, teamHpTotals(
      S.vehicles.getVehicles().map((v) => ({ team: v.def.team, hp: S.hpAt(v, S.T), maxHp: v.def.max_hp })),
      S.DATA!.meta.friendly_team,
    ));
    // 名册与上面的总血量同帧写入：两侧名册与顶栏永远是同一个 T 的投影
    S.labels.updateRoster();
    P.store.time = S.T;
    P.store.recorderModeUnknown = S.cameraRuntime.recorderModeUnknown();
    P.store.recorderViewAvailable = S.cameraRuntime.recorderViewAvailable();
    const f = (S.T - S.START) / Math.max(0.001, S.END - S.START);
    if (!P.store.seeking) P.store.seekFrac = Math.round(f * 1000);
  }
  function setPlaying(p: boolean) {
    S.PLAYING = p;
    P.store.playing = p;
    // 停下（暂停 / 播到终点）后不再有帧：把 HUD 与名册补写到当前 T，
    // 否则停在节流窗口里的上一次写入（最后 ≤100ms 的掉血 / 击毁不上屏）
    if (!p) writeHud(true);
    invalidate();
  }
  /** 宿主可见性闸门：暂停时停帧（保留会话），恢复时重挂帧循环；已初始化场景还要
   *  丢弃暂停期间的时间差。渲染器/时钟是惰性创建的（首次 startPlayback 才 initScene），
   *  所以 pre-init resume 不能读 `clock`，但必须把 pause 取消掉的唯一 rAF 重新挂回去；
   *  `animate()` 在 renderer 尚不存在时本身就是安全的空转等待。 */
  function setPaused(next: boolean) {
    const value = !!next;
    if (value === S.paused) return;
    S.paused = value;
    if (S.paused) {
      if (perf) { perf.idle(); perf.interrupt('background'); }
      perfProbe.stopWatchdog();
      if (S.rafId) { cancelAnimationFrame(S.rafId); S.rafId = 0; }
    } else if (!S.destroyed) {
      // pre-init 也必须把被 pause 取消的唯一 rAF 重新挂回去：animate() 本身在 renderer
      // 尚未创建时只排下一帧并安全返回。否则「待开播切走 → 切回 → Start」会进入
      // paused=false / renderer!=null / rafId=0 的死态，场景 ready 但时间与画面都不再推进。
      perfProbe.perfStartWatchdog();
      if (S.clock) S.clock.getDelta();   // 已初始化时丢弃暂停期间累积的 dt
      frameMeter.reset();            // 恢复后重新起窗：暂停间隙不得计入帧间隔
      if (!S.rafId) animate();
    }
  }
  /** 当前权威时钟（canonical 优先，场景自推兜底）下的 [START, END]，夹在录像数据范围内。 */

  Object.assign(S, {
    tmpV,
    tmpDir,
    FOLLOW_SNAP_DIST,
    FOLLOW_MIN_HEIGHT,
    invalidate,
    frameMeter,
    animate,
    perfProbe,
    PERF,
    perf,
    gpu,
    prewarmShaders,
    tick,
    HUD_INTERVAL_MS,
    writeHud,
    setPlaying,
    setPaused
  })
}
