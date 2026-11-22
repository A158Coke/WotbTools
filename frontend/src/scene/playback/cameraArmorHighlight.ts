import * as THREE from 'three'
import type { PerspectiveCamera } from 'three'
import { assetProvider } from '../assetProvider.js'
import { aimedVehicle, armorEquipmentCoeffs, armorHighlightBlock, authorShellAt, createArmorHighlight, mountedShell, reticleAimDirection } from './armorHighlight.js'
import type { AimedVehicleCandidate, ArmorHighlightPerfStats, HighlightConfig } from './armorHighlight.js'
import { resolveExactMountedConfig } from '../reloadBar.js'
import type { MountedConfigEvidence, TankJsonLike } from '../reloadBar.js'
import type { RuntimeVehicle } from './vehicleRuntime.js'
import type { CameraRuntimeDeps, ArmorHighlightInstance } from './cameraRuntimeTypes.js'
import type { RecorderCameraSample } from './cameraRig.js'

export function createCameraArmorHighlight(deps: CameraRuntimeDeps, state: {
  cam: () => string; scopedHiddenEid: () => number; cameraBlend: () => unknown
  recorderVehicle: () => RuntimeVehicle | undefined
  recorderAimPoint: (sample: RecorderCameraSample, out: THREE.Vector3) => THREE.Vector3
  recorderSample: RecorderCameraSample
}) {
  const { recorderVehicle, recorderAimPoint, recorderSample } = state
  // ---------- Sniper 穿深着色 ----------
  let armorHighlight: ArmorHighlightInstance | null = null;
  const _armorAimPoint = new THREE.Vector3();
  const _armorAimDir = new THREE.Vector3();
  /** 当前时刻可被准星选中的敌车（可见、复活/存活、真实车模）。 */
  function highlightEnemies(): AimedVehicleCandidate[] {
    const data = deps.getData();
    if (!data?.meta) return [];
    const friendlyTeam = data.meta.friendly_team;
    return deps.vehicles.getVehicles()
      .filter((v): v is RuntimeVehicle & { glb: THREE.Group } => !!(v.glb?.visible && v.group.visible && v.tankData
        && (v.def.team === 1 || v.def.team === 2) && v.def.team !== friendlyTeam && !deps.deathAt(v, deps.getT())))
      .map((v) => v as AimedVehicleCandidate);
  }
  function ensureArmorHighlight() {
    armorHighlight ??= createArmorHighlight({ renderer: deps.getRenderer()!, assetProvider });   // 相机域入口都在 initScene 之后
    return armorHighlight;
  }
  const armorStats = { pickMs: 0, stateMs: 0, thicknessMs: 0, occluderMs: 0, colorMs: 0, calls: 0, _t0: 0 } as ArmorHighlightPerfStats;
  const _occluderRoots: THREE.Object3D[] = [];
  function occluderRoots(targetEid: number) {
    _occluderRoots.length = 0;
    for (const root of [deps.mapWorld.terrainMesh(), deps.mapWorld.mapScenery(), deps.mapWorld.mapPlane(), deps.mapWorld.groundMesh()]) {
      if (root) _occluderRoots.push(root);
    }
    for (const v of deps.vehicles.getVehicles()) {
      if (v.def.eid === targetEid) continue;
      if (v.group) _occluderRoots.push(v.group);
      if (v.glb) _occluderRoots.push(v.glb);
      for (const head of v.detachedTurrets || []) _occluderRoots.push(head.root);
    }
    return _occluderRoots;
  }
  /**
   * 主渲染之后的叠加 pass：只有录像者开镜才可能运行，其余路径没有任何额外 render。
   * 进入录像者的过渡期相机还没到炮位，距离衰减和入射角都不对，不着色。
   */
  function renderArmorHighlight() {
    const camera = deps.getCamera();
    const PERF = deps.perfEnabled();
    if (PERF) {
      armorStats.pickMs = 0; armorStats.stateMs = 0; armorStats.thicknessMs = 0;
      armorStats.occluderMs = 0; armorStats.colorMs = 0; armorStats.calls = 0;
      armorStats.stateCalls = 0; armorStats.thicknessCalls = 0; armorStats.occluderCalls = 0; armorStats.colorCalls = 0;
    }
    if (!deps.armorHighlightPref() || state.cam() !== 'recorder' || !state.scopedHiddenEid() || state.cameraBlend()) return;
    const author = recorderVehicle();
    if (!author?.tankData) return;
    const tPick0 = PERF ? performance.now() : 0;
    const enemies = highlightEnemies();
    const aimDir = reticleAimDirection(camera, recorderAimPoint(recorderSample, _armorAimPoint), _armorAimDir);
    let target: AimedVehicleCandidate | null = null;
    if (aimDir) target = aimedVehicle(camera.position, aimDir, enemies, camera);
    const shellId = target == null ? null : authorShellAt(deps.getData()!.author_shell_timeline, deps.getT());
    const config = target == null ? null : resolveExactMountedConfig(target.def as MountedConfigEvidence, target.tankData as TankJsonLike) as HighlightConfig | null;
    const authorConfig = target == null ? null : resolveExactMountedConfig(author.def as MountedConfigEvidence, author.tankData as TankJsonLike) as HighlightConfig | null;
    const blocked = target == null ? 'no_target' : armorHighlightBlock({
      targetTankId: target.def.tank_id, targetConfig: config, authorConfig, shellId,
      targetEquipment: target.def.equipment as MountedConfigEvidence, authorEquipment: author.def.equipment as MountedConfigEvidence,
    });
    if (PERF) {
      armorStats.pickMs = performance.now() - tPick0;
      if (blocked) return;
    } else if (blocked) return;
    if (!target) return;   // TS 收窄：target 为空时 blocked === 'no_target'，上方已 return（原语义不可达分支）
    const { shell, caliber } = mountedShell(authorConfig, shellId)!;
    ensureArmorHighlight().render({
      scene: deps.getScene(), camera, vehicle: target as AimedVehicleCandidate & { def: { eid: number; tank_id?: number | null; equipment?: unknown } }, tankData: target.tankData as { model_url?: string | null; [key: string]: unknown }, config, shell, caliber,
      ...armorEquipmentCoeffs(shell, author.def.equipment, target.def.equipment),
      onReady: deps.invalidate,
      occluderRoots: occluderRoots(target.def.eid as number),
      stats: PERF ? armorStats : undefined,
      gpu: deps.gpu() ?? undefined,
    });
  }
  /** 穿深着色开启路径共用（enterRecorderView / setArmorHighlight-on）：预编译 + 预取。 */
  function prewarmArmorHighlight(camera: PerspectiveCamera) {
    const highlight = ensureArmorHighlight();
    highlight.prewarm(camera);
    highlight.prefetch(highlightEnemies());
  }
  return { ensureArmorHighlight, renderArmorHighlight, prewarmArmorHighlight, armorStats: () => armorStats,
    release: () => { armorHighlight?.releaseRenderTargets?.() },
    dispose: () => { armorHighlight?.dispose(); armorHighlight = null } }
}
