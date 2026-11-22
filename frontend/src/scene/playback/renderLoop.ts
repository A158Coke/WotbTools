// 帧循环 / 跟随相机 / 性能探针 owner（2026-11-22 自 playbackScene.js 闭包出仓，纯搬移）：
// 按需渲染脏标记、rAF 循环与逐帧编排，以及 ?perf 探针与着色器预热。
// 依赖读取统一经宿主对象 S。
import * as THREE from 'three'
import { applySupremacyPointsToStore } from '../supremacyPoints.js'
import { createFrameMeter } from '../frameMeter.js'
import { advancePlaybackTime } from '../../utils/playbackClock'
import { createPerfProbe } from './perfProbe.ts'
import type { Host } from '../playbackScene.js'
import { bind } from '../hostBind.ts'

export function installRenderLoop(S: Host) {
  Object.assign(S, {
    invalidate: bind(S, invalidate),
    animate: bind(S, animate),
  })


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

  S.tmpV = new THREE.Vector3();
  S.followAnchor = null;             // 跟随模式：上一帧坦克位置（位移增量基准）
  S.tmpDir = new THREE.Vector3();  // 进入跟随：相机方向临时量
  S.FOLLOW_SNAP_DIST = 26;         // 进入跟随：相机沿当前方向收拢到此距离（米；坦克约 7m 长）
  S.FOLLOW_MIN_HEIGHT = 9;         // 进入跟随：相机至少高于坦克此高度（米，保证俯角不贴地）
  // 按需渲染的脏标记：状态跳变（seek/换相机/开关节/尺寸变化/特效到期）必须显式置脏，
  // 否则那一帧的静止状态会一直停留在旧画面上。
  S.frameDirty = true;
  function invalidate(S: Host) { S.frameDirty = true; S.requestWaterReflectionRefresh(); }

  // 实时帧率（FPS 覆盖层）：rAF 回调间隔的 500ms 窗口均值，每窗口写一次 store
  //（每帧只多两次减法；窗口边界才触发一次响应式写入）。暂停 / 恢复时重新起窗。
  S.frameMeter = createFrameMeter();
  S.lastRenderAt = 0;
  S.fpsIdle = false;   // 场景进入空闲（!busy）后置位；恢复渲染前 re-起窗

  S.winnerShown = false;
  function animate(S: Host) {
    if (S.destroyed) return;
    if (S.paused) { S.rafId = 0; return; }   // 停帧：不排队下一帧，场景与状态原样保留
    S.rafId = requestAnimationFrame(S.animate);
    if (!S.renderer) return;   // 渲染器惰性创建（首次 startPlayback）：数据加载完成前无场景可渲染
    const cpuStarted = S.PERF ? performance.now() : 0;
    const dt = Math.min(S.clock.getDelta(), 0.1);
    if (S.DATA && S.PLAYING) {
      // 推进 + 钳制合并到纯函数里（NaN/负增量不会污染时钟）；终点是比赛结束 END，不是录像流结束
      S.T = advancePlaybackTime(S.T, S.END, dt * 1000, S.SPEED);
      S.battle.advanceWreckClock(dt);
      S.vehicles.frameTiming(dt, false);   // 行程限速用的逐帧 dt + 本帧非跳变（客户端同源：按帧步长限速）
      S.tick();
      if (S.T >= S.END) S.setPlaying(false);   // 先 tick 后停：停播时的 HUD/名册补写要包含终点帧的事件
    }
    const tickFinished = S.PERF ? performance.now() : 0;
    // 动画混合层（烟雾/瀑布/浪）：纹理位移按**回放时钟**走——暂停即停、seek 后相位
    // 由回放时刻唯一确定（不随壁钟漂移，截图可复现）。未装载时该数组为空。
    const animLayerMats = S.mapWorld.animLayerMats();
    if (animLayerMats.length) {
      // 地图预览（有地图无回放）：环境动画**全部冻结**为初始静态（用户 2026-11-17 裁示）。
      // 回放会话（hasData）仍严格跟随回放时钟 T；水波材质已在装配期排除出该表。
      const mapMode = !!S.store.mapReady && !S.store.hasData;
      if (!mapMode) {
        const secs = S.T / 1000;
        for (const mm of animLayerMats) mm.uniforms.uTime.value = secs;
      }
      if (S.DEBUG) {
        const frames = ((window.__ambient?.frames) || 0) + 1;
        window.__ambient = { mapMode, frozen: mapMode, mats: animLayerMats.length,
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
      const v = S.vehicles.getVehicles().find((x: { def: { eid: unknown }; group: { visible: boolean } }) => x.def.eid === S.cameraRuntime.followEid());
      if (v && v.group.visible) {
        S.vehicles.posAt(v, S.T, S.tmpV);
        if (!S.followAnchor) {
          S.controls.target.copy(S.tmpV);          // 进入跟随：视点先对准车体（旋转中心 = 坦克）
          // 拉近：沿**当前观察方向**把相机收到跟随距离——此前进入跟随只挪视点、相机留在
          // 开局全景位（数百米外），旋转看起来绕着别处转。仅当当前更远时收拢（用户已手动
          // 贴近则不打扰），且不低于 minDistance+2（否则 controls.update 会再推出去）。
          const off = S.tmpDir.subVectors(S.camera.position, S.tmpV);
          const snap = Math.max(S.FOLLOW_SNAP_DIST, (S.controls.minDistance || 0) + 2);
          if (off.length() > snap) {
            S.camera.position.copy(S.tmpV).addScaledVector(off.normalize(), snap);
          }
          if (S.camera.position.y < S.tmpV.y + S.FOLLOW_MIN_HEIGHT) {
            S.camera.position.y = S.tmpV.y + S.FOLLOW_MIN_HEIGHT;
          }
        } else {
          const dx = S.tmpV.x - S.followAnchor.x, dy = S.tmpV.y - S.followAnchor.y,
                dz = S.tmpV.z - S.followAnchor.z;
          S.camera.position.x += dx; S.camera.position.y += dy; S.camera.position.z += dz;
          S.controls.target.x += dx; S.controls.target.y += dy; S.controls.target.z += dz;
        }
        S.followAnchor = (S.followAnchor || new THREE.Vector3()).copy(S.tmpV);
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
    if (S.cameraRuntime.flyMode() && S.controls.enabled) S.controls.enabled = false;
    // free 接管期间 update() 不跑，它的 lookAt(target) 也随之缺席——相机朝向由本行
    // 维持（target 是权威：拖拽 / 平移 / 缩放都会先重钉 target）。不补这一步，
    // 拖拽只改 target 不改朝向，画面不转（用户实测）。
    if (S.cameraRuntime.flyMode()) S.camera.lookAt(S.controls.target);
    const cameraMoved = S.cameraRuntime.cameraDriven() ? false : S.controls.update();   // three 的 update() 返回相机是否变化（阻尼/交互）
    S.clampOrbitCameraToTerrain();
    const cameraFinished = S.PERF ? performance.now() : 0;
    // ---------- 按需渲染（脏帧）----------
    // 暂停且没有在飞特效、相机也静止时，跳过整帧工作（标签/基地/transient 重算 + 全屏
    // render）。此前空闲也满速重绘，是移动端发热与笔记本耗电的第一来源。
    // 伤害数字不参与这个判定：它是覆盖层 DOM + CSS 动画，暂停时自己走完，不需要出帧。
    const busy = S.PLAYING
      || cameraMoved
      || S.cameraRuntime.cameraBlend() || S.cameraRuntime.fovRestore()
      || S.frameDirty
      || S.mapWorld.destruct()?.animating
      || S.battle.isActive();   // 弹道在飞 / 战斗特效 / 战斗反馈 transient（owner = battleRuntime）
    if (!busy) {
      if (S.perf) S.perf.idle();
      // 空闲（场景确实停画，而不是渲染很慢）：显式重起统计窗，避免把空闲间隙
      // 算成一帧；超过 0.6s 把角标归零（显示 —），别让旧帧率冒充“当前”。
      // 注意判定只在这里做——PLAYING 期间即使 300ms/帧也照常计入长帧（评审 P2）。
      const now = performance.now();
      const since = S.lastRenderAt ? now - S.lastRenderAt : Infinity;
      if (since > 250 && !S.fpsIdle) { S.frameMeter.reset(); S.fpsIdle = true; }
      if (S.store.fps && since > 600) {
        S.store.fps = 0; S.store.frameMs = 0; S.store.framePeakMs = 0;
      }
      return;
    }
    if (S.fpsIdle) { S.frameMeter.reset(); S.fpsIdle = false; }   // 恢复渲染：全新窗口
    S.lastRenderAt = performance.now();
    // 只统计**真正渲染的帧**：按需渲染下 rAF 每帧都跑（暂停静止也跑），数回调会得到
    // 120 FPS 这种与画面无关的数——用户实测「卡顿和显示的帧率不符」正是这个。
    const fpsStats = S.frameMeter.sample(S.lastRenderAt);
    if (fpsStats) {
      S.store.fps = fpsStats.fps;
      S.store.frameMs = fpsStats.frameMs;
      S.store.framePeakMs = fpsStats.peakMs;
    }
    S.frameDirty = false;
    // 动态分辨率调整必须在**渲染前**（黑闪根因）：canvas width/height 赋值会清空
    // drawing buffer——若在渲染后调整，合成器在下一帧渲染前取到空 buffer 即黑帧。
    // 渲染前调整则本帧立刻以新分辨率画满，buffer 从不空。dt 取自本帧 rAF。
    if (S.dynResCtl) {
      const nd = S.dynResCtl.frame(dt * 1000);
      if (nd != null) {
        const w = S.container.clientWidth, h = S.container.clientHeight;
        S.renderer.setSize(w, h, false);
        S.renderer.setPixelRatio(nd);
        S.renderer.domElement.style.width = w + 'px';
        S.renderer.domElement.style.height = h + 'px';
      }
    }
    const perfT0 = S.PERF ? performance.now() : 0;
    // 战场快捷标记：暂停/按需重绘也要重算窗口（迟到数据只置脏不推进 T；倒带经 seekTo→tick）
    if (!(S.DATA && S.PLAYING)) S.battleMarkers?.update(S.T);
    S.labels.updateLabels();
    S.updateBases();
    S.battle.transients.updateNow();
    S.battle.updateBattleFx();     // 战斗特效（壁钟特效暂停时也继续自然播完）
    const perfT1 = S.PERF ? performance.now() : 0;
    S.mapWorld.maybeRebuildTerrainLod();   // 地形 LOD 跟随相机姿态（视距滞回 + 绕转/FOV/aspect；120 ms 节流）
    const terrainFinished = S.PERF ? performance.now() : 0;
    // 一帧可有多次 render：探针期间手动复位，info 才是整帧累计而不是最后一次 render
    const perfAutoReset = S.PERF ? S.renderer.info.autoReset : null;
    try {
      if (S.PERF) { S.renderer.info.autoReset = false; S.renderer.info.reset(); }
      const gpuFrameId = S.session.isReadySession() ? S.gpu?.beginFrame() ?? null : null;
      // 水面动态反射（HIGH/ULTRA）：镜像 pass 必须在主渲染前完成（RT 供水面着色采样）。
      S.waterReflection.update(S.renderer, S.scene, S.camera);
      const gpuMainStarted = S.gpu?.begin('main') ?? false;
      try { S.renderer.render(S.scene, S.camera); } finally { if (gpuMainStarted) S.gpu.end(); }
      S.session.tryMarkFirstReadyFrame(performance.now());
      const perfR0 = S.PERF ? performance.now() : 0;
      S.cameraRuntime.renderArmorHighlight();
      S.gpu?.submitFrame();
      const perfR1 = S.PERF ? performance.now() : 0;
      if (S.PERF && S.session.isReadySession()) S.perfProbe.perfFrame(perfT1 - perfT0, perfR0 - terrainFinished, perfR1 - perfR0, S.cameraRuntime.armorStats(), { cpuFrameMs: perfR1 - cpuStarted, tickMs: tickFinished - cpuStarted, cameraMs: cameraFinished - tickFinished, terrainCheckInclusiveMs: terrainFinished - perfT1, gpuFrameId, gpu_total_ms: null });
      S.gpu?.recorded(gpuFrameId);
    } finally {
      if (S.PERF) S.renderer.info.autoReset = perfAutoReset;
      S.gpu?.abortFrame();
    }
  }
}

export function installPerfProbe(S: Host) {
  Object.assign(S, {
    prewarmShaders: bind(S, prewarmShaders),
    tick: bind(S, tick),
  })

  // ---------- 性能探针（`?perf`；只读测量，不改变任何渲染行为） ----------
  // 分阶段逐帧耗时 / 主线程停顿看门狗 / window.__pbPerf 调试句柄的唯一 owner =
  // playback/perfProbe.ts（#820 Step 4 出仓）；PERF/perf/gpu 句柄仍由本闭包解构持有
  //（渲染循环与会话编排直接消费）。
  S.perfProbe = createPerfProbe({
    container: S.container,
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
    armorStats: () => S.cameraRuntime.armorStats(),
    contactShadowsCount: () => S.contactShadowCtl.count(),
  });
  S.PERF = S.perfProbe.PERF;
  S.perf = S.perfProbe.perf;
  S.gpu = S.perfProbe.gpu;
  S.dynResCtl = null;
  S.rendererCaps = null;   // 当前渲染器实际装配的 { logdepth, dynres, stencil }（reset 保留渲染器时用于失配检测）


  /** 预热在用材质（见 renderer 初始化处注释）：把首次编译的数十~数百 ms 从"战斗第一次
   *  开火/命中"挪到加载阶段。失败不影响播放（best-effort）。 */
  function prewarmShaders(S: Host) {
    try {
      S.camera.updateMatrixWorld();
      // 战斗特效的批次与条带平时按需隐藏：预热期间临时显示，避免首发开火时才编译
      S.battle.ensureBattleFx().prewarm(() => {
        S.renderer.compile(S.scene, S.camera);
      });
      if (S.ARMOR_HIGHLIGHT && typeof S.renderer.compile === 'function') {
        S.cameraRuntime.ensureArmorHighlight().prewarm(S.camera);
      }
    } catch (e) { console.warn('着色器预热失败（忽略）:', e); }
  }

  function tick(S: Host) {
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
    S.mapWorld.updateDestructibles(S.T);
    S.tread.updateTrails();     // 履带印游标泵（seek 后退 = 全量重算，前进 = 增量）
    S.labels.updateScore();
    S.battleMarkers?.update(S.T);   // 战场快捷标记：回放时钟窗口状态（tick/seekTo 共用）
    // HUD → store
    // 顶栏：争霸实时点数每 tick 确定性重算 + 变更守卫（无采样也写 null，防切场残值）。
    applySupremacyPointsToStore(S.store, S.DATA, S.T);
    // 顶栏：单基地目标存在性 + 占领进度（取 ≤T 最后一条；无目标证据整行不显示）
    S.writeHud();
    if (!S.winnerShown && S.T >= S.END - 1e-3 && S.DATA.meta.winner_team) {
      S.winnerShown = true;
      const w = S.DATA.meta.winner_team, fr = S.DATA.meta.friendly_team;
      // outcome 供消费方面板三语化（text 为上游兼容中文字段；WotBTools 唯一分叉的加性字段）
      S.store.banner = {
        text: w === 0 ? '平局' : (w === fr ? '胜利' : '失败'),
        color: w === fr ? '#3fa66a' : '#c05046',
        outcome: w === 0 ? 'draw' : (w === fr ? 'win' : 'lose'),
      };
    }
  }
}
