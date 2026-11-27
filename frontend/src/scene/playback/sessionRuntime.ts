import { createDynRes } from '../dynRes.js'
import { foliageClip } from '../sceneryMaterials.js'
import { disposeObject3D } from '../materialDispose.js'
import { visibilitySpansByEid } from '../../replay-local/pose/vehiclePose.js'
import { resolveReplayClock } from '../../replay-local/canonical/facts'
import { createSessionLifecycle } from './sessionLifecycle.ts'
import { installDebugProbes } from './debugProbes.ts'
import type { Host } from '../playbackScene.js'
import { bind } from '../hostBind.ts'
import type { SessionPlaybackData } from './sessionLifecycle.ts'

export function installSessionRuntime(S: Host) {
  Object.assign(S, {
    teardownSession: bind(S, teardownSession),
    rebuildRenderer: bind(S, rebuildRenderer),
    ensureRenderer: bind(S, ensureRenderer),
    prepareSessionCamera: bind(S, prepareSessionCamera),
    publishSessionData: bind(S, publishSessionData),
    publishMapOnlyData: bind(S, publishMapOnlyData),
    prepareResolvers: bind(S, prepareResolvers),
    resetSessionCursors: bind(S, resetSessionCursors),
  })



  function teardownSession(S: Host) {
    S.session.bumpSessionGen();
    S.session.setSessionMode('replay');
    S.MAP_BASES_KIND = null;
    S.MAP_SPAWN_POINTS = null;
    S.store.mapReady = false;
    S.cameraRuntime.resetSessionState();
    S.contactShadowCtl.dispose();
    foliageClip.value = 0;
    S.store.recorderCameraStatus = 'idle';
    S.store.recorderViewAvailable = false;
    S.store.recorderModeUnknown = false;
    S.mapWorld.resetMapLighting();
    S.battle.dispose();
    S.pickReporter.dispose({ scene: S.scene, disposeObject3D });
    S.waterReflection.dispose();
    S.mapWorld.dispose();
    S.annotationScene.clearSessionProjection();
    S.clearBases();
    S.clearSpawns();
    S.tread.dispose();
    S.vehicles.dispose();
    S.vehicleLife.reset();
    S.battleMarkers?.clear();
    S.markersIdentitySnapshot = null;
    S.labels.resetSessionState();
    S.DATA = null;
    S.VIS_BY_EID = new Map();
    S.POSE_GRID.tStart = 0;
    S.POSE_GRID.samples = 0;
    S.store.playbackSession = null;
    S.store.hasData = false;
    S.T = 0; S.battle.resetShotPtr(); S.labels.resetCursors();
    S.winnerShown = false;
    S.cameraRuntime.resetFollow(); S.followAnchor = null;
    S.store.killfeed = [];
    S.store.banner = null;
    S.store.pointsFriend = null; S.store.pointsEnemy = null;
    S.store.scoreFriend = 0; S.store.scoreEnemy = 0;
    S.store.hpFriend = 0; S.store.hpFriendMax = 0; S.store.hpEnemy = 0; S.store.hpEnemyMax = 0;
    S.store.hpFriendPct = 100; S.store.hpEnemyPct = 100;
    S.store.friendlyTeam = null;
    S.store.roster.team1 = [];
    S.store.roster.team2 = [];
    S.store.roster.unknown = [];
    S.labels.resetRoster();
  }

  function rebuildRenderer(S: Host) {
    const position = S.camera.position.clone();
    const target = S.controls.target.clone();
    if (S.sizeObserver) { try { S.sizeObserver.disconnect(); } catch (_) {} S.sizeObserver = null; }
    removeEventListener('resize', S.onResize);
    if (S.controls) { try { S.controls.dispose(); } catch (_) {} S.controls = null; }
    if (S.renderer) {
      try { S.renderer.domElement.removeEventListener('pointerdown', S.cameraRuntime.onScenePointerDown); } catch (_) {}
      try { S.renderer.domElement.removeEventListener('pointerup', S.cameraRuntime.onScenePointerUp); } catch (_) {}
      S.gpu?.detach();
      S.renderer.dispose();
      try { S.renderer.forceContextLoss(); } catch (_) {}
      S.renderer.domElement.remove();
      S.renderer = null;
    }
    S.dynResCtl = null;
    S.initScene();
    S.camera.position.copy(position);
    S.controls.target.copy(target);
    if (S.cameraRuntime.flyMode()) S.cameraRuntime.flyLookSyncFromCamera('renderer rebuild', true);
    S.camera.lookAt(S.controls.target);
  }

  function ensureRenderer(S: Host) {
    if (!S.renderer) S.initScene();
    if (S.DEBUG && S.renderer) installDebugProbes({ renderer: S.renderer, scene: S.scene, camera: S.camera, controls: S.controls, cameraRuntime: S.cameraRuntime });
    if (S.rendererCaps && (S.rendererCaps.logdepth !== S.LOGDEPTH || S.rendererCaps.dynres !== S.DYNRES
      || S.rendererCaps.stencil !== S.contactShadowCtl.wantsStencil())) {
      if (S.rendererCaps.logdepth !== S.LOGDEPTH || S.rendererCaps.stencil !== S.contactShadowCtl.wantsStencil()) {
        S.rebuildRenderer();
      } else {
        S.rendererCaps.dynres = S.DYNRES;
        const cap = Math.min(devicePixelRatio, S.Q.maxDpr);
        S.renderer.setPixelRatio(cap);
        S.renderer.setSize(S.container.clientWidth, S.container.clientHeight, false);
        S.renderer.domElement.style.width = S.container.clientWidth + 'px';
        S.renderer.domElement.style.height = S.container.clientHeight + 'px';
        S.dynResCtl = (S.DYNRES && cap > 1) ? createDynRes({ ceilDpr: cap }) : null;
      }
    }
  }
  function prepareSessionCamera(S: Host) { S.cameraRuntime.prepareSessionCamera(); }
  function publishSessionData(S: Host, data: SessionPlaybackData, playbackSession: unknown) {
    S.DATA = data;
    S.VIS_BY_EID = visibilitySpansByEid(data.visibility);
    S.POSE_GRID.tStart = data.meta.t_start;
    S.POSE_GRID.samples = data.meta.samples;
    S.store.playbackSession = playbackSession;
    S.battle.prepareGunfire(data.vehicles || []);
  }
  function publishMapOnlyData(S: Host, mapId: number, mapName: string) {
    S.DATA = {
      meta: { map_id: mapId || 0, map_name: mapName || '', t_start: 0, friendly_team: 1, duration: 0 },
      vehicles: [],
      shots: [],
      periods: [],
      destructible_events: [],
    };
    S.VIS_BY_EID = visibilitySpansByEid(undefined);
    S.POSE_GRID.tStart = 0;
    S.POSE_GRID.samples = 0;
    S.store.playbackSession = null;
    S.battleMarkers?.clear();
  }
  function prepareResolvers(S: Host) { S.labels.prepareResolvers(); }
  function resetSessionCursors(S: Host) { S.battle.resetShotPtr(); S.labels.resetCursors(); }
}

export function createPlaybackSession(S: Host) {
  S.session = createSessionLifecycle({
    store: S.store,
    destroyed: () => S.destroyed,
    perf: () => S.perf,
    teardownSession: S.teardownSession,
    publishSessionData: S.publishSessionData,
    publishMapOnlyData: S.publishMapOnlyData,
    ensureRenderer: S.ensureRenderer,
    battleRange: S.battleRange,
    publishSceneClock: () => { S.sceneClock = resolveReplayClock(S.DATA.periods || [], null, S.DATA.meta.duration); },
    clearCanonicalClock: () => { S.canonicalClock = null; },
    prepareSessionCamera: S.prepareSessionCamera,
    setMapKey: (key) => S.mapWorld.setMapKey(key),
    getGlbOn: () => S.vehicles.glbOn(),
    buildWorld: () => S.mapWorld.buildWorld(),
    setCam: (mode) => S.cameraRuntime.setCam(mode),
    clampCameraTarget: S.clampCameraTarget,
    constrainFreeCameraAltitude: () => S.cameraRuntime.constrainFreeCameraAltitude(),
    loadMapImage: () => S.mapWorld.loadMapImage(),
    buildBases: S.buildBases,
    buildSpawns: S.buildSpawns,
    buildVehicles: () => S.vehicles.buildVehicles(),
    setupContactShadows: () => S.contactShadowCtl.setup(),
    applyGlbToggle: (on) => S.vehicles.applyGlbToggle(on),
    buildRoster: () => S.labels.buildRoster(),
    buildMarkers: () => S.rebuildMarkersWithIdentitySnapshot(),
    prepareResolvers: S.prepareResolvers,
    prewarmShaders: S.prewarmShaders,
    setPlaying: S.setPlaying,
    tick: S.tick,
    writeHud: S.writeHud,
    invalidate: S.invalidate,
    requestWaterReflectionRefresh: S.requestWaterReflectionRefresh,
    loadRecorderCamera: (source, epoch) => S.cameraRuntime.loadRecorderCamera(source, epoch),
    transients: S.battle.transients,
    setClockRange: (start, end) => { S.START = start; S.END = end; },
    setTime: (t) => { S.T = t; },
    debug: S.DEBUG,
    exposeVehicles: () => { window.__pbV = S.vehicles.getVehicles(); },
    data: () => S.DATA,
    topViewOnLoad: () => S.cameraRuntime.topViewOnLoad(),
    cam: () => S.cameraRuntime.cam(),
    forceGlb: () => !!S.Q.forceGlb,
    resetSessionCursors: S.resetSessionCursors,
  });
  return S.session
}
