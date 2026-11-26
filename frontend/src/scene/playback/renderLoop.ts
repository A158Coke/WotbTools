import * as THREE from 'three'
import { applySupremacyPointsToStore } from '../supremacyPoints.js'
import { createFrameMeter } from '../frameMeter.js'
import { advancePlaybackTime } from '../../utils/playbackClock'
import { createPerfProbe } from './perfProbe.ts'
import { addPerfStage } from './perfStages.ts'
import type { Host } from '../playbackScene.js'
import { bind } from '../hostBind.ts'

export function installRenderLoop(S: Host) {
  Object.assign(S, {
    invalidate: bind(S, invalidate),
    animate: bind(S, animate),
  })




  S.tmpV = new THREE.Vector3();
  S.followAnchor = null;
  S.tmpDir = new THREE.Vector3();
  S.FOLLOW_SNAP_DIST = 26;
  S.FOLLOW_MIN_HEIGHT = 9;
  S.frameDirty = true;
  function invalidate(S: Host) { S.frameDirty = true; }

  S.frameMeter = createFrameMeter();
  S.lastRenderAt = 0;
  S.fpsIdle = false;

  S.winnerShown = false;
  function animate(S: Host) {
    if (S.destroyed) return;
    if (S.paused) { S.rafId = 0; return; }
    S.rafId = requestAnimationFrame(S.animate);
    if (!S.renderer) return;
    const cpuStarted = S.PERF ? performance.now() : 0;
    if (S.PERF) S.perfStages = Object.create(null);
    const dt = Math.min(S.clock.getDelta(), 0.1);
    if (S.DATA && S.PLAYING) {
      S.T = advancePlaybackTime(S.T, S.END, dt * 1000, S.SPEED);
      S.battle.advanceWreckClock(dt);
      S.vehicles.frameTiming(dt, false);
      S.tick();
      if (S.T >= S.END) S.setPlaying(false);
    }
    const tickFinished = S.PERF ? performance.now() : 0;
    const animLayerMats = S.mapWorld.animLayerMats();
    if (animLayerMats.length) {
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
    S.mapWorld.tickDynamicLights?.(S.camera.position);
    if (S.DATA && S.cameraRuntime.cam() === 'follow' && S.cameraRuntime.followEid()) {
      const v = S.vehicles.getVehicles().find((x: { def: { eid: unknown }; group: { visible: boolean } }) => x.def.eid === S.cameraRuntime.followEid());
      if (v && v.group.visible) {
        S.vehicles.posAt(v, S.T, S.tmpV);
        if (!S.followAnchor) {
          S.controls.target.copy(S.tmpV);
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
    S.cameraRuntime.zoomTick(dt);
    if (S.cameraRuntime.fovRestore()) S.cameraRuntime.stepFovRestore(dt);
    if (S.cameraRuntime.flyMode() && S.controls.enabled) S.controls.enabled = false;
    if (S.cameraRuntime.flyMode()) S.camera.lookAt(S.controls.target);
    const cameraMoved = S.cameraRuntime.cameraDriven() ? false : S.controls.update();
    S.clampOrbitCameraToTerrain();
    const cameraFinished = S.PERF ? performance.now() : 0;
    const busy = S.PLAYING
      || cameraMoved
      || S.cameraRuntime.cameraBlend() || S.cameraRuntime.fovRestore()
      || S.frameDirty
      || S.mapWorld.destruct()?.animating
      || S.battle.isActive();
    if (!busy) {
      if (S.perf) S.perf.idle();
      const now = performance.now();
      const since = S.lastRenderAt ? now - S.lastRenderAt : Infinity;
      if (since > 250 && !S.fpsIdle) { S.frameMeter.reset(); S.fpsIdle = true; }
      if (S.store.fps && since > 600) {
        S.store.fps = 0; S.store.frameMs = 0; S.store.framePeakMs = 0;
      }
      return;
    }
    if (S.fpsIdle) { S.frameMeter.reset(); S.fpsIdle = false; }
    S.lastRenderAt = performance.now();
    const fpsStats = S.frameMeter.sample(S.lastRenderAt);
    if (fpsStats) {
      S.store.fps = fpsStats.fps;
      S.store.frameMs = fpsStats.frameMs;
      S.store.framePeakMs = fpsStats.peakMs;
    }
    S.frameDirty = false;
    if (S.dynResCtl) {
      const nd = S.dynResCtl.frame(dt * 1000);
      if (nd != null) {
        const w = S.container.clientWidth, h = S.container.clientHeight;
        S.renderer.setSize(w, h, false);
        S.renderer.setPixelRatio(nd);
        S.renderer.domElement.style.width = w + 'px';
        S.renderer.domElement.style.height = h + 'px';
        S.requestWaterReflectionRefresh();
      }
    }
    const perfT0 = S.PERF ? performance.now() : 0;
    if (!(S.DATA && S.PLAYING)) S.battleMarkers?.update(S.T);
    S.labels.updateLabels();
    S.updateBases();
    S.battle.transients.updateNow();
    S.battle.updateBattleFx();
    const perfT1 = S.PERF ? performance.now() : 0;
    S.mapWorld.maybeRebuildTerrainLod();
    const terrainFinished = S.PERF ? performance.now() : 0;
    const perfAutoReset = S.PERF ? S.renderer.info.autoReset : null;
    try {
      if (S.PERF) { S.renderer.info.autoReset = false; S.renderer.info.reset(); }
      const gpuFrameId = S.session.isReadySession() ? S.gpu?.beginFrame() ?? null : null;
      const reflectionStarted = S.PERF ? performance.now() : 0;
      S.waterReflection.update(S.renderer, S.scene, S.camera, S.gpu);
      const mainStarted = S.PERF ? performance.now() : 0;
      const gpuMainStarted = S.gpu?.begin('main') ?? false;
      try { S.renderer.render(S.scene, S.camera); } finally { if (gpuMainStarted) S.gpu.end(); }
      S.session.tryMarkFirstReadyFrame(performance.now());
      const perfR0 = S.PERF ? performance.now() : 0;
      S.cameraRuntime.renderArmorHighlight();
      S.gpu?.submitFrame();
      const perfR1 = S.PERF ? performance.now() : 0;
      if (S.PERF && S.session.isReadySession()) S.perfProbe.perfFrame(perfT1 - perfT0, perfR0 - terrainFinished, perfR1 - perfR0, S.cameraRuntime.armorStats(), { ...(S.perfStages || {}), cpuFrameMs: perfR1 - cpuStarted, tickMs: tickFinished - cpuStarted, cameraMs: cameraFinished - tickFinished, terrainCheckInclusiveMs: terrainFinished - perfT1, reflectionUpdateMs: mainStarted - reflectionStarted, mainSubmitMs: perfR0 - mainStarted, gpuFrameId, gpu_total_ms: null });
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

  S.perfProbe = createPerfProbe({
    getViewportSize: () => S.getViewportSize(),
    getT: () => S.T,
    getRenderer: () => S.renderer,
    getQualityKey: () => S.QKEY,
    getArmorHighlightPref: () => S.ARMOR_HIGHLIGHT,
    getCameraMode: () => S.cameraRuntime.cam(),
    getSpeed: () => S.SPEED,
    getDynres: () => S.DYNRES,
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
  if (S.PERF) {
    S.perfStages = Object.create(null);
    S.perfAddStage = (key: string, ms: number, count?: number) => addPerfStage(S.perfStages, key, ms, count);
  }
  S.dynResCtl = null;
  S.rendererCaps = null;


  function prewarmShaders(S: Host) {
    try {
      S.camera.updateMatrixWorld();
      S.battle.ensureBattleFx().prewarm(() => {
        S.renderer.compile(S.scene, S.camera);
      });
      if (S.ARMOR_HIGHLIGHT && typeof S.renderer.compile === 'function') {
        S.cameraRuntime.ensureArmorHighlight().prewarm(S.camera);
      }
    } catch (e) { console.warn('着色器预热失败（忽略）:', e); }
  }

  function tick(S: Host) {
    S.battle.advanceShotsTo(S.T);
    S.labels.advanceKills();
    for (const v of S.vehicles.getVehicles()) S.vehicles.applyPose(v);
    S.vehicles.clearSnap();
    S.battle.flushMuzzles();
    S.battle.updateTracers();
    S.battle.transients.advanceTo(S.T);
    S.mapWorld.updateDestructibles(S.T);
    S.tread.updateTrails();
    S.labels.updateScore();
    S.battleMarkers?.update(S.T);
    applySupremacyPointsToStore(S.store, S.DATA, S.T);
    S.writeHud();
    if (!S.winnerShown && S.T >= S.END - 1e-3 && S.DATA.meta.winner_team) {
      S.winnerShown = true;
      const w = S.DATA.meta.winner_team, fr = S.DATA.meta.friendly_team;
      S.store.banner = {
        text: w === 0 ? '平局' : (w === fr ? '胜利' : '失败'),
        color: w === fr ? '#3fa66a' : '#c05046',
        outcome: w === 0 ? 'draw' : (w === fr ? 'win' : 'lose'),
      };
    }
  }
}
