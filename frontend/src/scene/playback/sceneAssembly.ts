import * as THREE from 'three'
import { disposeObject3D } from '../materialDispose.js'
import { COLOR_UNKNOWN, TRACER_FRIENDLY, TRACER_ENEMY, teamColorOf } from './palette.ts'
import { createSceneCore } from './renderer.js'
import { createMapWorld } from './mapWorld.ts'
import { createWaterReflectionRuntime } from './waterReflectionRuntime.ts'
import { createVehicleRuntime } from './vehicleRuntime.ts'
import { createBattleMarkerHost } from './battleMarkerHost.ts'
import { createTreadRuntime } from './treadRuntime.ts'
import { createBattleRuntime } from './battleRuntime.ts'
import { createAnnotationScene } from './annotationScene.ts'
import { createLabelsRuntime } from './labelsRuntime.ts'
import { createCameraRuntime, CAMERA_GROUND_CLEARANCE } from './cameraRuntime.ts'
import { qualityFeatures } from './quality.js'
import { createPickReporter } from './pickReport.js'
import { createCameraTerrainClamp } from './cameraTerrainClamp.js'
import { createBaseMarkers } from './bases.js'
import { createSpawnMarkers } from './spawns.js'
import type { Host } from '../playbackScene.js'
import { bind } from '../hostBind.ts'

export function installSceneAssembly(S: Host) {
  Object.assign(S, {
    initScene: bind(S, initScene),
    onResize: bind(S, onResize),
    reportPick: bind(S, reportPick),
    teamColor: bind(S, teamColor),
    buildBases: bind(S, buildBases),
    clearBases: bind(S, clearBases),
    regroundBases: bind(S, regroundBases),
    updateBases: bind(S, updateBases),
    buildSpawns: bind(S, buildSpawns),
    clearSpawns: bind(S, clearSpawns),
    regroundSpawns: bind(S, regroundSpawns),
    refreshSpawnColors: bind(S, refreshSpawnColors),
    applyCameraClamp: bind(S, applyCameraClamp),
    terrainHeightForCameraClamp: bind(S, terrainHeightForCameraClamp),
    clampOrbitCameraToTerrain: bind(S, clampOrbitCameraToTerrain),
    clampCameraTarget: bind(S, clampCameraTarget),
  })

  const logicalViewport = new THREE.Vector2();
  const getViewportSize = () => {
    if (!S.renderer) return { x: S.container.clientWidth, y: S.container.clientHeight };
    S.renderer.getSize(logicalViewport);
    return logicalViewport;
  };
  S.getViewportSize = getViewportSize;

  function initScene(S: Host) {
    const core = createSceneCore({
      container: S.container, quality: S.Q, logdepth: S.LOGDEPTH, dynres: S.DYNRES, stencil: S.contactShadowCtl.wantsStencil(), debug: S.DEBUG,
      envTexture: S.mapWorld.envTexture(), envMultiplier: S.mapWorld.envMultiplier(),
      onResize: S.onResize, onPointerDown: S.cameraRuntime.onScenePointerDown, onPointerUp: S.cameraRuntime.onScenePointerUp,
      setFollow: (eid: number | null) => S.cameraRuntime.setFollow(eid),
    });
    S.scene = core.scene; S.camera = core.camera; S.renderer = core.renderer;
    S.controls = core.controls; S.clock = core.clock; S.raycaster = core.raycaster;
    S.perfProbe?.attachRenderer?.(S.renderer);
    S.gpu?.attach(S.renderer);
    S.cameraRuntime.applyMobileTouchControls();
    S.hemiLight = core.hemiLight; S.sunLight = core.sunLight;
    S.dynResCtl = core.dynResCtl; S.sizeObserver = core.sizeObserver; S.rendererCaps = core.rendererCaps;
    S.annotationScene.attachListeners();
    S.cameraRuntime.attachListeners();
    if (S.cameraRuntime.cam() === 'free') S.cameraRuntime.flyLookApplyMode('free');
  }
  function onResize(S: Host) {
    if (!S.renderer) return;
    const w = Math.max(1, Math.round(S.container.clientWidth));
    const h = Math.max(1, Math.round(S.container.clientHeight));
    S.camera.aspect = w / h;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(w, h);
    S.requestWaterReflectionRefresh();
    S.invalidate();
  }
  S.pickDownAt = null;
  S.pickReporter = createPickReporter();
  S.pickCtx = () => ({
    clock: S.T, vehicles: S.vehicles.getVehicles(), scenery: S.mapWorld.mapScenery(), terrainMesh: S.mapWorld.terrainMesh(), groundMesh: S.mapWorld.groundMesh(),
    destruct: S.mapWorld.destruct(), destructPickList: S.mapWorld.destructPickList(), meshOwner: S.mapWorld.meshOwner(), heightField: S.mapWorld.heightField(), heightMeta: S.mapWorld.heightMeta(),
    camera: S.camera, raycaster: S.raycaster, container: S.container, scene: S.scene, terrainSpan: S.mapWorld.terrainSpanOf(),
  });
  function reportPick(S: Host, e: PointerEvent) { S.pickReporter.reportPick(e, S.pickCtx()); }

  S.mapWorld = createMapWorld({
    store: S.store,
    debug: S.DEBUG,
    perf: () => S.perf,
    sessionEpoch: () => S.session.sessionEpoch(),
    destroyed: () => S.destroyed,
    getData: () => S.DATA,
    quality: () => S.Q,
    grassInstanceBudget: () => qualityFeatures(S.QKEY).grass.instances,
    getScene: () => S.scene,
    getCamera: () => S.camera,
    getRenderer: () => S.renderer,
    getControls: () => S.controls,
    invalidate: S.invalidate,
    disposeObject3D,
    constrainFreeCameraAltitude: () => S.cameraRuntime.constrainFreeCameraAltitude(),
    regroundBases: S.regroundBases,
    regroundSpawns: S.regroundSpawns,
    rebuildAnnotationProjection: () => S.annotationScene.rebuildAnnotationProjection(),
    reprojectAnnotationHeights: () => S.annotationScene.reprojectAnnotationHeights(),
    scopedHiddenEid: () => S.cameraRuntime.scopedHiddenEid(),
    onTerrainReground: () => S.contactShadowCtl.handle()?.reground(),
    onLightingApplied: () => S.contactShadowCtl.handle()?.syncSun(),
    lightingTargets: () => ({ renderer: S.renderer, scene: S.scene, sunLight: S.sunLight, hemiLight: S.hemiLight, debug: S.DEBUG }),
    buildWorldCameraPlacement: (center) => {
      const { cx, cz, ext } = center;
      if (S.cameraRuntime.topViewOnLoad() || S.cameraRuntime.cam() !== 'free') {
        S.camera.position.set(cx, ext * 1.1, cz + ext * 1.2);
        S.controls.target.set(cx, 0, cz);
      }
      S.applyCameraClamp();
    },
  });

  S.waterReflection = createWaterReflectionRuntime({
    getWaterMeshes: () => S.mapWorld.waterMeshes(),
    getWaterLevel: () => S.mapWorld.waterLevel(),
    getExcludedRoots: () => [S.mapWorld.grassRoot(), S.battle.fxRoot(), S.annotationScene.annotationRoot()],
    qualityKey: () => S.QKEY,
    debug: S.DEBUG,
  });
  S.applyQualityFeatures = () => {
    S.waterReflection.apply();
    S.requestWaterReflectionRefresh();
    S.invalidate();
  };
  S.requestWaterReflectionRefresh = () => S.waterReflection.requestRefresh();
  S.vehicles = createVehicleRuntime({
    store: S.store,
    destroyed: () => S.destroyed,
    sessionGen: () => S.session.sessionGen(),
    getScene: () => S.scene,
    getT: () => S.T,
    getData: () => S.DATA,
    quality: () => S.Q,
    teamColor: (v) => S.teamColor(v),
    classIconsVisible: () => S.labels.classIconsVisible(),
    showMarkerStatus: () => S.labels.showMarkerStatus(),
    invalidate: S.invalidate,
    onModelChanged: (eid) => S.cameraRuntime.refreshFollowMinDistance(eid),
    visibleAt: (v, t) => S.visibleAt(v, t),
    sceneLifeAt: (v, t) => S.sceneLifeAt(v, t),
    replacedAt: (eid, t) => S.replacedAt(eid, t),
    sampleHeight: (x, z) => S.mapWorld.sampleHeight(x, z),
    treadAttachVehicle: (v) => S.tread.attachVehicle(v),
    disposeObject3D,
    poseGrid: S.POSE_GRID,
    visByEid: () => S.VIS_BY_EID,
    contactShadows: () => S.contactShadowCtl.handle(),
    scopedHiddenEid: () => S.cameraRuntime.scopedHiddenEid(),
    get perfAdd() { return S.perfAddStage },
  });
  S.battleMarkers = createBattleMarkerHost({
    getScene: () => S.scene,
    mapWorld: S.mapWorld,
    vehicles: S.vehicles,
    visibleAt: (v, t) => S.visibleAt(v, t),
    replacedAt: (eid, t) => S.replacedAt(eid, t),
    getT: () => S.T,
    getData: () => S.DATA,
    invalidate: S.invalidate,
  });
  S.tread = createTreadRuntime({
    store: S.store,
    quality: () => S.Q,
    getScene: () => S.scene,
    destroyed: () => S.destroyed,
    invalidate: S.invalidate,
    getT: () => S.T,
    getStart: () => S.START,
    getData: () => S.DATA,
    getVehicles: () => S.vehicles.getVehicles(),
    vehicles: S.vehicles,
    visibleAt: (v, t) => S.visibleAt(v, t),
    heightAt: (x, z) => S.mapWorld.sampleHeight(x, z),
    heightFieldReady: () => !!S.mapWorld.heightField(),
  });

  S.battle = createBattleRuntime({
    getData: () => S.DATA,
    getT: () => S.T,
    getScene: () => S.scene,
    getCamera: () => S.camera,
    getViewportHeight: () => getViewportSize().y,
    debug: S.DEBUG,
    getVehicles: () => S.vehicles.getVehicles(),
    vehicles: S.vehicles,
    sceneLifeAt: (v, t) => S.sceneLifeAt(v, t),
    colorUnknown: COLOR_UNKNOWN,
    tracerFriendly: TRACER_FRIENDLY,
    tracerEnemy: TRACER_ENEMY,
    invalidate: S.invalidate,
    deathTimesOf: (v) => S.deathTimesOf(v),
    qualityFx: () => S.Q.fx,
    getLabelOverlay: () => S.labelOverlay,
    invalidateLabels: () => S.labels.invalidateLabels(),
  });

  S.annotationScene = createAnnotationScene({
    container: S.container,
    debug: S.DEBUG,
    perfEnabled: () => !!S.PERF,
    invalidate: S.invalidate,
    getScene: () => S.scene,
    getCamera: () => S.camera,
    getRaycaster: () => S.raycaster,
    getControls: () => S.controls,
    mapWorld: S.mapWorld,
    annotationSurfaceHeightAt: (x, z) => S.mapWorld.annotationSurfaceHeightAt(x, z),
    onAnnotationCommit: S.onAnnotationCommit,
    onAnnotationErase: S.onAnnotationErase,
  });

  S.labels = createLabelsRuntime({
    store: S.store,
    getViewportSize,
    getCamera: () => S.camera,
    getRaycaster: () => S.raycaster,
    getData: () => S.DATA,
    getT: () => S.T,
    getVehicles: () => S.vehicles.getVehicles(),
    getSessionGen: () => S.session.sessionGen(),
    getFollowEid: () => S.cameraRuntime.followEid(),
    get perfAdd() { return S.perfAddStage },
    deathAt: S.deathAt,
    hpAt: S.hpAt,
    visibleAt: S.visibleAt,
    visByEid: () => S.VIS_BY_EID,
    scopedHiddenEid: () => S.cameraRuntime.scopedHiddenEid(),
    sampleHeight: (x, z) => S.mapWorld.sampleHeight(x, z),
    heightField: () => S.mapWorld.heightField(),
    heightMeta: () => S.mapWorld.heightMeta(),
    mapScenery: () => S.mapWorld.mapScenery(),
    occlGrid: () => S.mapWorld.occlGrid(),
    transients: S.battle.transients,
    fxScale: () => S.battle.fxScale(),
    getLabelOverlay: () => S.labelOverlay,
    getMarkerLabelSources: () => S.battleMarkers.labelSources(),
    canonicalVehicles: () => S.store.playbackSession?.canonical?.dataset?.vehicles || [],
    invalidate: S.invalidate,
  });


  function teamColor(S: Host, v: { def: { team: unknown } }) {
    return teamColorOf(v.def.team as number, S.DATA.meta.friendly_team);
  }

  S.bases = createBaseMarkers({
    getScene: () => S.scene, getCamera: () => S.camera,
    getData: () => S.DATA, getMapBases: () => S.mapWorld.mapBases(),
    store: S.store, groundY: (x, z) => S.mapWorld.groundY(x, z),
  });
  function buildBases(S: Host) {
    if (S.session.sessionMode() === 'map') S.bases.buildStatic(S.MAP_BASES_KIND);
    else S.bases.build();
  }
  function clearBases(S: Host) { S.bases.clear(); }
  function regroundBases(S: Host) { S.bases.reground(); }
  function updateBases(S: Host) { S.bases.update(S.T); }

  S.spawnMarkers = createSpawnMarkers({ getScene: () => S.scene, groundY: (x, z) => S.mapWorld.groundY(x, z) });
  function buildSpawns(S: Host) { S.spawnMarkers.build(S.session.sessionMode() === 'map' ? S.MAP_SPAWN_POINTS : null); }
  function clearSpawns(S: Host) { S.spawnMarkers.clear(); }
  function regroundSpawns(S: Host) { S.spawnMarkers.reground(); }
  function refreshSpawnColors(S: Host) {
    if (S.session.sessionMode() !== 'map') return;
    S.spawnMarkers.refreshColors();
    S.invalidate();
  }

  S.cameraTerrainClamp = createCameraTerrainClamp({
    getCamera: () => S.camera,
    getControls: () => S.controls,
    cameraDriven: () => S.cameraRuntime.cameraDriven(),
    getTerrainMesh: () => S.mapWorld.terrainMesh(),
    getHeightField: () => S.mapWorld.heightField(),
    getHeightMeta: () => S.mapWorld.heightMeta(),
    sampleRenderedTerrainHeight: (x, z) => S.mapWorld.sampleRenderedTerrainHeight(x, z),
    sampleHeight: (x, z) => S.mapWorld.sampleHeight(x, z),
    clearance: CAMERA_GROUND_CLEARANCE,
    getWorldCenter: () => S.mapWorld.worldCenter(),
    isFollowing: () => !!S.cameraRuntime.followEid(),
    followMinDistance: () => S.cameraRuntime.followMinDistance(),
  });
  function applyCameraClamp(S: Host) { S.cameraTerrainClamp.applyCameraClamp(S.mapWorld.worldCenter().ext); }
  function terrainHeightForCameraClamp(S: Host, x: number, z: number) { return S.cameraTerrainClamp.terrainHeightForCameraClamp(x, z); }
  function clampOrbitCameraToTerrain(S: Host) { return S.cameraTerrainClamp.clampOrbitCameraToTerrain(); }
  function clampCameraTarget(S: Host) { S.cameraTerrainClamp.clampCameraTarget(); }

  S.cameraRuntime = createCameraRuntime({
    store: S.store,
    container: S.container,
    getViewportSize,
    debug: S.DEBUG,
    getCamera: () => S.camera,
    getRenderer: () => S.renderer,
    getControls: () => S.controls,
    getRaycaster: () => S.raycaster,
    getScene: () => S.scene,
    invalidate: S.invalidate,
    requestWaterReflectionRefresh: S.requestWaterReflectionRefresh,
    getT: () => S.T,
    getData: () => S.DATA,
    sessionEpoch: () => S.session.sessionEpoch(),
    destroyed: () => S.destroyed,
    writeHud: S.writeHud,
    updateRoster: () => S.labels.updateRoster(),
    vehicles: S.vehicles,
    mapWorld: S.mapWorld,
    annotationScene: S.annotationScene,
    deathAt: (v, t) => S.deathAt(v, t),
    deathTimesOf: (v) => S.deathTimesOf(v),
    gpu: () => S.gpu,
    perfEnabled: () => !!S.PERF,
    armorHighlightPref: () => S.ARMOR_HIGHLIGHT,
    recorderReticle: S.recorderReticle ?? null,
    clampCameraTarget: S.clampCameraTarget,
    clampOrbitCameraToTerrain: S.clampOrbitCameraToTerrain,
    baseMinDistance: () => S.cameraTerrainClamp.baseMinDistance(),
    terrainHeightForCameraClamp: S.terrainHeightForCameraClamp,
    onVehicleSelect: S.onVehicleSelect ?? null,
    pickDebug: () => S.PICK_DEBUG,
    syncContactShadow: (v) => S.vehicles.syncContactShadow(v),
    getPickDownAt: () => S.pickDownAt,
    setPickDownAt: (p) => { S.pickDownAt = p; },
    reportPick: S.reportPick,
  });
}
