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

  S.HUD_INTERVAL_MS = 100;
  S.hudWrittenMs = -Infinity;
  S.markersIdentitySnapshot = null;
  function writeHud(S: Host, force = false) {
    if (!S.DATA) return;
    const now = performance.now();
    if (!force && now - S.hudWrittenMs < S.HUD_INTERVAL_MS) return;
    S.hudWrittenMs = now;
    if (force) S.labels.publishLabels(true);
    Object.assign(S.store, teamHpTotals(
      S.vehicles.getVehicles().map((v: { def: { team: unknown; max_hp: number } }) => ({ team: v.def.team, hp: S.hpAt(v, S.T), maxHp: v.def.max_hp })),
      S.DATA.meta.friendly_team,
    ));
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
    if (!p) { S.writeHud(true); S.requestWaterReflectionRefresh(); }
    S.invalidate();
  }
  function setPaused(S: Host, next: boolean) {
    const value = !!next;
    if (value === S.paused) return;
    S.paused = value;
    if (S.paused) {
      if (S.perf) { S.perf.idle(); S.perf.interrupt('background'); }
      S.perfProbe.stopWatchdog();
      if (S.rafId) { cancelAnimationFrame(S.rafId); S.rafId = 0; }
    } else if (!S.destroyed) {
      S.perfProbe.perfStartWatchdog();
      if (S.clock) S.clock.getDelta();
      S.frameMeter.reset();
      if (!S.rafId) S.animate();
    }
  }
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
  function canonicalIdentityFingerprint(S: Host): string | null {
    const canonical = (S.store.playbackSession as { canonical?: { entityStartsByAccount?: Map<number, Map<number, number | null>> | null; clock?: { startRaw?: number | null } | null } | null } | null)?.canonical
    const starts = canonical?.entityStartsByAccount
    return canonical && starts
      ? JSON.stringify([canonical.clock?.startRaw ?? null,
        [...starts].map(([account, perEntity]) => [account, [...perEntity]])
          .sort(([a], [b]) => (a as number) - (b as number))])
      : null
  }
  function rebuildMarkersWithIdentitySnapshot(S: Host) {
    S.markersIdentitySnapshot = canonicalIdentityFingerprint(S)
    S.battleMarkers?.buildMarkers()
  }
  function setBattleClock(S: Host, clock: { startRaw: number; durationSec?: number | null } | null) {
    S.canonicalClock = clock && Number.isFinite(clock.startRaw) ? { startRaw: clock.startRaw, durationSec: clock.durationSec } : null;
    if (!S.DATA) return;
    [S.START, S.END] = S.battleRange();
    S.battle.transients.resyncBursts(S.T);
    S.store.startTime = S.START;
    S.store.duration = S.END;
    const identityChanged = canonicalIdentityFingerprint(S) !== S.markersIdentitySnapshot;
    if (identityChanged) rebuildMarkersWithIdentitySnapshot(S);
    const t = Math.max(S.START, Math.min(S.END, S.T));
    if (t !== S.T) S.seekTo(t);
    else {
      for (const v of S.vehicles.getVehicles()) S.vehicles.applyPose(v);
      if (identityChanged) S.battleMarkers?.update(S.T);
    }
    if (S.PLAYING && S.T >= S.END) S.setPlaying(false);
    S.writeHud(true);
    S.requestWaterReflectionRefresh();
    S.invalidate();
  }
  function seekTo(S: Host, t: number) {
    S.T = Math.max(S.START, Math.min(S.END, t));
    S.battle.clearEffects();
    S.battle.resetShotsTo(firstIndexAfter(S.DATA.shots, S.T, (x: { t_fire: number }) => x.t_fire));
    S.battle.transients.rewind(S.T);
    S.labels.rebuildFeed();
    S.labels.resetScore();
    S.winnerShown = false; S.store.banner = null;
    S.vehicles.markSeekSnap();
    S.tick();
    S.vehicles.clearSnap();
    S.writeHud(true);
    S.requestWaterReflectionRefresh();
    S.invalidate();
  }
  function setSpeed(S: Host, s: number) {
    if (!isPlaybackSpeed(s)) return;
    if (S.SPEED !== s && S.perf) S.perf.interrupt('speed-change');
    S.SPEED = s; S.store.speed = s;
  }
}
