// 播放传输与 HUD owner（2026-11-22 自 playbackScene.js 闭包出仓，纯搬移）：
// 时间轴播放/暂停/seek/倍速、战斗时钟范围、HUD 降频写入 store。
// 依赖读取统一经宿主对象 S。
import { battleEndTime } from '../battleEnd.js'
import { firstIndexAfter } from '../seekPointer.js'
import { teamHpTotals } from '../teamHpTotals.js'
import { isPlaybackSpeed } from '../../composables/usePlaybackTransport.js'
import type { Host } from '../playbackScene.js'
import { bind } from '../hostBind.ts'

export function installTransport(S: Host) {
  Object.assign(S, {
    writeHud: bind(S, writeHud),
    setPlaying: bind(S, setPlaying),
    setPaused: bind(S, setPaused),
    battleRange: bind(S, battleRange),
    setBattleClock: bind(S, setBattleClock),
    rebuildMarkersWithIdentitySnapshot: bind(S, rebuildMarkersWithIdentitySnapshot),
    seekTo: bind(S, seekTo),
    setSpeed: bind(S, setSpeed),
  })

  // ---------- 控制 ----------
  // HUD 降频：store.time / seekFrac 每帧都变会让页面壳（AgentReplay3D）每帧整页 VDOM patch
  // 一次（顶栏 + 双名册 + 击杀流 + 传输控件）。3D 平滑度来自场景时钟，HUD 与进度条按
  // ~10Hz 更新即可；seek / 会话开始 / 停播等状态跳变时 force 立即补一次，语义不丢。
  S.HUD_INTERVAL_MS = 100;
  S.hudWrittenMs = -Infinity;
  // canonical 身份指纹快照（建源时同步；变更才重建标记事件源，不按帧重建）。
  S.markersIdentitySnapshot = null;
  function writeHud(S: Host, force = false) {
    if (!S.DATA) return;
    const now = performance.now();
    if (!force && now - S.hudWrittenMs < S.HUD_INTERVAL_MS) return;
    S.hudWrittenMs = now;
    if (force) S.labels.publishLabels(true);
    // 顶栏：双方队伍总血量（与上游 3D 视图同口径：各队 max_hp 汇总；未知阵营不计入任一方，
    // 见 teamHpTotals）。随 HUD 10Hz 节流写入即可——血量每秒变化远低于此，没必要每帧
    // 触发整页 VDOM patch（见上方 HUD_INTERVAL_MS）。
    Object.assign(S.store, teamHpTotals(
      S.vehicles.getVehicles().map((v: { def: { team: unknown; max_hp: number } }) => ({ team: v.def.team, hp: S.hpAt(v, S.T), maxHp: v.def.max_hp })),
      S.DATA.meta.friendly_team,
    ));
    // 名册与上面的总血量同帧写入：两侧名册与顶栏永远是同一个 T 的投影
    S.labels.updateRoster();
    S.store.time = S.T;
    S.store.recorderModeUnknown = S.cameraRuntime.recorderModeUnknown();
    S.store.recorderViewAvailable = S.cameraRuntime.recorderViewAvailable();
    const f = (S.T - S.START) / Math.max(0.001, S.END - S.START);
    if (!S.store.seeking) S.store.seekFrac = Math.round(f * 1000);
  }
  function setPlaying(S: Host, p: boolean) {
    S.PLAYING = p;
    S.store.playing = p;
    // 停下（暂停 / 播到终点）后不再有帧：把 HUD 与名册补写到当前 T，
    // 否则停在节流窗口里的上一次写入（最后 ≤100ms 的掉血 / 击毁不上屏）
    if (!p) S.writeHud(true);
    S.invalidate();
  }
  /** 宿主可见性闸门：暂停时停帧（保留会话），恢复时重挂帧循环；已初始化场景还要
   *  丢弃暂停期间的时间差。渲染器/时钟是惰性创建的（首次 startPlayback 才 initScene），
   *  所以 pre-init resume 不能读 `clock`，但必须把 pause 取消掉的唯一 rAF 重新挂回去；
   *  `animate()` 在 renderer 尚不存在时本身就是安全的空转等待。 */
  function setPaused(S: Host, next: boolean) {
    const value = !!next;
    if (value === S.paused) return;
    S.paused = value;
    if (S.paused) {
      if (S.perf) { S.perf.idle(); S.perf.interrupt('background'); }
      S.perfProbe.stopWatchdog();
      if (S.rafId) { cancelAnimationFrame(S.rafId); S.rafId = 0; }
    } else if (!S.destroyed) {
      // pre-init 也必须把被 pause 取消的唯一 rAF 重新挂回去：animate() 本身在 renderer
      // 尚未创建时只排下一帧并安全返回。否则「待开播切走 → 切回 → Start」会进入
      // paused=false / renderer!=null / rafId=0 的死态，场景 ready 但时间与画面都不再推进。
      S.perfProbe.perfStartWatchdog();
      if (S.clock) S.clock.getDelta();   // 已初始化时丢弃暂停期间累积的 dt
      S.frameMeter.reset();            // 恢复后重新起窗：暂停间隙不得计入帧间隔
      if (!S.rafId) S.animate();
    }
  }
  /** 当前权威时钟（canonical 优先，场景自推兜底）下的 [START, END]，夹在录像数据范围内。 */
  function battleRange(S: Host) {
    const dataStart = S.DATA.meta.t_start;
    const dataEnd = Math.max(dataStart, battleEndTime(S.DATA));
    const clock = S.canonicalClock || S.sceneClock;
    if (!clock) return [dataStart, dataEnd];
    const streamEnd = Number(S.DATA.meta.duration) > dataStart ? Number(S.DATA.meta.duration) : dataEnd;
    const start = Math.min(Math.max(dataStart, clock.startRaw), streamEnd);
    const end = Number.isFinite(clock.durationSec) && clock.durationSec > 0
      ? Math.min(streamEnd, clock.startRaw + clock.durationSec) : dataEnd;
    return [start, Math.max(start, end)];
  }
  /** 当前 canonical 身份指纹（entityStartsByAccount + startRaw；null = 无身份证据）。 */
  function canonicalIdentityFingerprint(S: Host): string | null {
    const canonical = (S.store.playbackSession as { canonical?: { entityStartsByAccount?: Map<number, Map<number, number | null>> | null; clock?: { startRaw?: number | null } | null } | null } | null)?.canonical
    const starts = canonical?.entityStartsByAccount
    return canonical && starts
      ? JSON.stringify([canonical.clock?.startRaw ?? null,
        [...starts].map(([account, perEntity]) => [account, [...perEntity]])
          .sort(([a], [b]) => (a as number) - (b as number))])
      : null
  }
  /** 开场建源与 canonical 变更共用：按当前身份指纹重建标记事件源并同步快照。 */
  function rebuildMarkersWithIdentitySnapshot(S: Host) {
    S.markersIdentitySnapshot = canonicalIdentityFingerprint(S)
    S.battleMarkers?.buildMarkers()
  }
  /**
   * canonical 时钟换了（晚到 / 失败 / 换会话）：重定 [START, END]，把 T 夹回范围（越界才 seek，范围内不打断播放），
   * 越过新终点时停播；随即发布到 store，播放条 / 顶栏 / Details 与引擎同一刻对齐。
   */
  function setBattleClock(S: Host, clock: { startRaw: number; durationSec?: number | null } | null) {
    S.canonicalClock = clock && Number.isFinite(clock.startRaw) ? { startRaw: clock.startRaw, durationSec: clock.durationSec } : null;
    if (!S.DATA) return;
    [S.START, S.END] = S.battleRange();
    S.battle.transients.resyncBursts(S.T);   // late canonical never replays past explosions
    S.store.startTime = S.START;
    S.store.duration = S.END;
    // 0x2f attack_enemy 的目标 eid 在建源时按当时身份固定；canonical 身份指纹变化
    // （晚到 / 修正 / 换会话）时重建事件源。显式 target_eid 由 payload 原样重推。
    const identityChanged = canonicalIdentityFingerprint(S) !== S.markersIdentitySnapshot;
    if (identityChanged) rebuildMarkersWithIdentitySnapshot(S);
    const t = Math.max(S.START, Math.min(S.END, S.T));
    if (t !== S.T) S.seekTo(t);
    else {
      for (const v of S.vehicles.getVehicles()) S.vehicles.applyPose(v);   // canonical late/failure refreshes paused visuals too
      if (identityChanged) S.battleMarkers?.update(S.T);   // 未越界：应用新位姿后按当前 T 重算标记
    }
    if (S.PLAYING && S.T >= S.END) S.setPlaying(false);
    S.writeHud(true);
    S.invalidate();
  }
  function seekTo(S: Host, t: number) {
    S.T = Math.max(S.START, Math.min(S.END, t));
    S.battle.clearEffects();   // 动态层 dispose（与 teardown 同一路径，防 seek 循环累积显存）
    // 游标一律重定到「T 之后第一条」：clearEffects 已把 transient 游标归零，
    // 若不重定，紧随的 tick() 会把 t<=T 的历史飘字/爆散一次性补播（与 2D seek 语义不符）
    S.battle.resetShotsTo(firstIndexAfter(S.DATA.shots, S.T, (x: { t_fire: number }) => x.t_fire));
    S.battle.transients.rewind(S.T);
    S.labels.rebuildFeed();
    S.labels.resetScore();     // 比分为单调游标，seek 后必须从头推进（否则分数不回落）
    S.winnerShown = false; S.store.banner = null;
    S.vehicles.markSeekSnap();  // 跳变：行程吸附到目标、侧位移不积分（客户端"首次可见直接吸附"同款）
    S.tick();
    S.vehicles.clearSnap();
    // seek 是状态跳变：立即把 HUD/进度条/名册对齐到新 T（不等下一个降频窗口）——
    // 暂停时没有帧在跑，名册投影只能靠这次强制写入。
    S.writeHud(true);
    S.invalidate();
  }
  // 只接受档位表内的值：面板按钮与 URL 参数都不该把场景带进"1.37×"这种未定义速度
  function setSpeed(S: Host, s: number) { if (!isPlaybackSpeed(s)) return; S.SPEED = s; S.store.speed = s; }
}
