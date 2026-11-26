import { foliageClip } from '../sceneryMaterials.js'
import { QUALITY_PRESETS } from './quality.js'
import { persistBoolPref } from './preferences.ts'
import type { RenderSettingsPatch } from './renderSettings.ts'
import type { Host } from '../playbackScene.js'

export function createPlaybackApi(S: Host) {
  return {
    loadData: S.session.loadData,
    loadMapOnly: S.session.loadMapOnly,
    setMapBasesKind(kind: unknown) {
      S.MAP_BASES_KIND = (kind === 'supremacy' || kind === 'assault') ? kind : null;
      if (S.session.sessionMode() === 'map' && S.store.mapReady) {
        S.buildBases();
        S.invalidate();
      }
    },
    setMapSpawns(points: unknown) {
      S.MAP_SPAWN_POINTS = Array.isArray(points) ? points : null;
      if (S.session.sessionMode() === 'map' && S.store.mapReady) {
        S.buildSpawns();
        S.invalidate();
      }
    },
    refreshSpawnColors() {
      S.refreshSpawnColors();
    },
    reset() {
      if (S.perf) { S.perf.interrupt('session-reset'); S.perf.beginSession(); S.session.clearReadySession(); S.perf.setIdentity({ replayDigest: null }); }
      S.session.invalidateLoadingTokens();
      S.teardownSession();
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
    setAnnotations: (annotations: unknown) => S.annotationScene.setAnnotations(annotations),
    setAnnotationInteraction: (config: { enabled?: boolean; tool?: string; width?: number; eraserWidth?: number } = {}) => S.annotationScene.setAnnotationInteraction(config),
    setAnnotationsVisible: (visible: boolean) => S.annotationScene.setAnnotationsVisible(visible),
    setSpeed: S.setSpeed,
    setFlySpeed: (n: number) => S.cameraRuntime.setFlySpeed(n),
    flyTick: (dt: number, pressed: Set<string>) => S.cameraRuntime.flyTick(dt, pressed),
    invalidate: S.invalidate,
    settleCamera: () => { S.requestWaterReflectionRefresh(); S.invalidate(); },
    seekFraction: (frac: number) => { if (S.DATA) S.seekTo(S.START + frac * (S.END - S.START)); },
    seekTime: (t: number) => { if (S.DATA) S.seekTo(t); },
    seekBy: (delta: number) => { if (S.DATA) S.seekTo(S.T + delta); },
    setBattleClock: S.setBattleClock,
    setCam: (mode: string) => S.cameraRuntime.setCam(mode),
    cameraDistanceState: () => S.cameraRuntime.cameraDistanceState(),
    setCameraDistance: (v: number) => S.cameraRuntime.setCameraDistance(v),
    setMobileTouch: (enabled: boolean) => S.cameraRuntime.setMobileTouch(enabled),
    setFollow: (eid: number | null) => S.cameraRuntime.setFollow(eid),
    setBattleMarkers: (on: boolean) => {
      S.battleMarkers?.setEnabled(!!on);
      S.battleMarkers?.update(S.T);
      S.invalidate();
    },
    setGlb: (on: boolean) => { if (!S.Q.forceGlb && (S.Q.allowGlb || !on)) S.vehicles.applyGlbToggle(on); S.requestWaterReflectionRefresh(); S.invalidate(); },
    setTreadMarks: (on: boolean) => {
      S.store.treadOn = !!on;
      S.tread.updateTrails();
      S.invalidate();
    },
    setLabelPrefs: (prefs: { enabled?: boolean; lastKnown?: boolean; classIcons?: boolean; showStatus?: boolean; showPlayerName?: boolean; showTankName?: boolean; showHp?: boolean; showReload?: boolean } | null | undefined = {}) => {
      const enabled = !prefs || prefs.enabled !== false;
      S.store.labelsOn = enabled;
      const lastKnownOn = prefs?.lastKnown !== false;
      const lastKnownChanged = S.store.lastKnownOn !== lastKnownOn;
      S.store.lastKnownOn = lastKnownOn;
      S.labels.setClassIcons(prefs?.classIcons === true);
      S.labels.setShowMarkerStatus(prefs?.showStatus !== false);
      for (const v of S.vehicles.getVehicles()) {
        S.vehicles.setLowPoly(v, !v.glb);
        S.vehicles.applyDetachedTurrets(v);
        if (v.glb) v.glb.visible = v.group.visible && !S.labels.classIconsVisible();
        S.vehicles.syncContactShadow(v);
      }
      if (lastKnownChanged) for (const v of S.vehicles.getVehicles()) S.vehicles.applyPose(v);
      S.labels.setLabelPrefs();
      if (S.renderer && S.camera) S.labels.updateLabels();
      S.requestWaterReflectionRefresh();
    },
    setLogdepth: (on: boolean) => {
      S.LOGDEPTH = !!on;
      persistBoolPref('pb_logdepth', on);
      S.store.logdepth = !!on;
    },
    setDynres: (on: boolean) => {
      const v = !!on;
      if (S.DYNRES !== v && S.perf) S.perf.interrupt('dynres-change');
      S.DYNRES = v;
      persistBoolPref('pb_dynres', v);
      S.store.dynres = v;
    },
    setArmorHighlight: (on: boolean) => {
      if (S.perf && S.ARMOR_HIGHLIGHT !== !!on) S.perf.interrupt('armor-setting-change');
      S.ARMOR_HIGHLIGHT = !!on;
      persistBoolPref('pb_armor_highlight', on);
      S.store.armorHighlight = !!on;
      if (!S.ARMOR_HIGHLIGHT) {
        S.cameraRuntime.releaseArmorHighlightRenderTargets();
      } else if (S.cameraRuntime.cam() === 'recorder' && S.renderer) {
        S.cameraRuntime.prewarmArmorHighlight(S.camera);
      }
      S.invalidate();
    },
    // 待开播卡片直接调用：只改选择，startPlayback 装配时生效。
    // 已开播的统一修改入口是 applyRenderSettings（随本次暂存记录整页重载后装配）。
    setContactShadows: (on: boolean) => S.contactShadowCtl.setEnabled(on),
    setQuality: S.setQuality,
    /** 画质 / Log Depth / 动态分辨率 / 接地阴影一次应用；已开播时最多触发一次整页重载。 */
    applyRenderSettings: async (patch: RenderSettingsPatch): Promise<boolean> => S.applyRenderSettings(patch),
    setPaused: S.setPaused,
    qualityPresets: QUALITY_PRESETS,
    destroy() {
      S.destroyed = true;
      foliageClip.value = 0;
      S.cameraRuntime.flyLookApplyMode('follow');
      S.session.invalidateForDestroy();
      S.store.loading = false;
      S.store.assetStage = false;
      S.store.assetProgress = null;
      S.store.assetIssues = [];
      S.store.assetDegraded = false;
      cancelAnimationFrame(S.rafId);
      S.teardownSession();
      S.annotationScene.dispose();
      removeEventListener('resize', S.onResize);
      S.annotationScene.detach();
      S.cameraRuntime.detachListeners();
      S.sizeObserver?.disconnect();
      S.sizeObserver = null;
      if (S.DEBUG) {
        delete window.__scene; delete window.__camera; delete window.__controls; delete window.__setFollow; delete window.__renderer;
        delete window.__pbV; delete window.__gdbg; delete window.__battleFx;
        delete window.__destructStage; delete window.__destructDebug;
        delete window.__waterCoast;
      }
      S.perfProbe.dispose();
      if (S.renderer) {
        try { S.renderer.domElement.removeEventListener('pointerdown', S.cameraRuntime.onScenePointerDown); } catch (_) {}
        try { S.renderer.domElement.removeEventListener('pointerup', S.cameraRuntime.onScenePointerUp); } catch (_) {}
      }
      if (S.controls) {
        S.annotationScene.restoreTouches();
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
