import * as THREE from 'three'
import { poseFromYPR } from '../glbRig.js'
import { fetchReplayShots } from '../agentData.js'
import { poseShooterTurretGun } from './shotReplayPose.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { neutralizeDefaultMetalness } from '../glbRig.js'
import { fetchTankData, assetProvider } from '../agentData.js'
import { buildTrajectoryAnnotation, installAnchorMarkers, installShooterMuzzleMarker, placeImpactCamera } from './shotReplaySeg.js'
import { disposeOverlayObject } from './overlayStroke.js'
import { autoSelectReplayShell, buildMoveAnnotation, buildWorldPanelHtml, installMoveToggle, installViewSwitch } from './shotReplayPanel.js'
import { installTimeScrubHandler } from './shotReplayScrub.js'
import { installSegmentJudgment } from './segmentJudgment.js'
export { decodeB255 } from './segmentJudgment.js'
export interface LoadedShooterModel {
    sd: TankData | null
    sModel: THREE.Object3D
    breechGunLocal: THREE.Vector3 | null
}

export interface LoadShooterModelOptions {
    castShadow?: boolean
    logTag?: string
    applyPose?: (sModel: THREE.Object3D) => void
}

export interface ShooterModelFactoryDeps {
    getTankData(): TankData
    getShooterData(): TankData | null
    getSelectedShell(): unknown
    isShooterLoading(): boolean
    getCurrentShooterId(): number | string | null
    currentShot(): boolean
    ml: Pick<ModelLifecycleHandle, 'disposeDetachedModel'>
    getScene(): THREE.Scene
}

export function createShooterModelFactory(deps: ShooterModelFactoryDeps):
    (tid: number, opts?: LoadShooterModelOptions) => Promise<LoadedShooterModel | null> {
    const { getTankData, getShooterData, getSelectedShell, ml, getScene, currentShot } = deps;
    const cloneMaterial = (m: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] =>
        Array.isArray(m) ? m.map((x) => x.clone()) : m.clone();
    return function loadShooterModel(tid: number, opts?: LoadShooterModelOptions): Promise<LoadedShooterModel | null> {
        const castShadow = !!(opts && opts.castShadow);
        const logTag = (opts && opts.logTag) || '[world]';
        const shooterGlbUrl = assetProvider.url(getTankData().visual_model_url.replace(/\/glb\/\d+\//, '/glb/' + tid + '/'));
        const reuseShooterData = getShooterData() && getSelectedShell() && !deps.isShooterLoading()
            && String(deps.getCurrentShooterId()) === String(tid);
        return Promise.all([
            reuseShooterData ? Promise.resolve(getShooterData()) : fetchTankData(tid).catch(() => null),
            new Promise<THREE.Group | null>(function(res) {
                new GLTFLoader().load(shooterGlbUrl,
                    function(g) { res(g.scene); }, undefined, function() { res(null); });
            }),
        ]).then(function(arr): LoadedShooterModel | null {
            const sd = arr[0], sModel = arr[1];
            if (!currentShot()) { ml.disposeDetachedModel(sModel); return null; }
            if (!sModel) { console.warn(logTag + ' shooter model load failed'); return null; }
            sModel.scale.setScalar(1);
            if (opts && opts.applyPose) opts.applyPose(sModel);
            let breechGunLocal: THREE.Vector3 | null = null;
            try {
                const gunPreMatches: THREE.Object3D[] = [];
                sModel.traverse(function(n: THREE.Object3D) {
                    if (!gunPreMatches.length && /^gun_\d+$/.test(n.name || '')) gunPreMatches.push(n);
                });
                const gunPre = gunPreMatches[0] ?? null;
                const moPre = sd && sd.model_origins;
                if (gunPre && moPre) {
                    const scP = (sd.configs && sd.configs.length) ? sd.configs[sd.configs.length - 1] : null;
                    const breechModel = new THREE.Vector3(
                        moPre.track[0]+moPre.turret[0]+((scP && scP.gun_origin) ? scP.gun_origin[0] : 0),
                        moPre.track[1]+moPre.turret[1]+((scP && scP.gun_origin) ? scP.gun_origin[1] : 0),
                        moPre.track[2]+moPre.turret[2]+((scP && scP.gun_origin) ? scP.gun_origin[2] : 0));
                    sModel.updateMatrixWorld(true);
                    breechGunLocal = gunPre.worldToLocal(sModel.localToWorld(breechModel));
                }
            } catch (e) { console.warn(logTag + ' breech capture failed:', e); }
            sModel.traverse(function(node: THREE.Object3D) {
                if ((node as THREE.Mesh).isMesh) {
                    const mesh = node as THREE.Mesh;
                    if (castShadow) mesh.castShadow = true;
                    if (mesh.material) {
                        mesh.material = cloneMaterial(mesh.material);
                        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                        for (const m of mats) { m.transparent = true; m.opacity = 0.6; }
                    }
                }
            });
            neutralizeDefaultMetalness(sModel);
            sModel.updateMatrixWorld(true);
            getScene().add(sModel);
            return { sd, sModel, breechGunLocal };
        });
    };
}
import { mirrorShotData } from './viewerMath.js'
import { shotResultClass } from '../../utils/shotResultClass.js'
import { renderMissShotAnnotation } from './shotReplayMiss.js'
import type {
    ArmorStateDecl, PoseTickSample, ReplayShot, ShellSpec, TankData, Vec3,
} from './viewerContracts.js'
import type { ModelLifecycleHandle } from './modelLifecycle.js'
import type { TrajectoryCardHandle } from './trajectoryCard.js'
import type { TurretRigHandle } from './turretRig.js'

interface ShotControls {
    target: THREE.Vector3
    update(): void
    maxDistance: number
    minDistance: number
    mouseButtons: Record<string, number>
    screenSpacePanning: boolean
}

interface ShotHeatmapHandle {
    getPrimaryArmorScene(): THREE.Object3D | null
    syncHeatOverlay(): void
    updatePenetrationUniforms(shell: ShellSpec | null): void
    updateSpacedUniforms(shell: ShellSpec | null): void
}

interface ShotJudgmentHandle {
    setShotRay(origin: THREE.Vector3, target: THREE.Vector3): void
    clearShotRay(): void
    doPenetrationCheck(ndcX: number, ndcY: number): void
}

interface ShotReplayLabels {
    armorStateAutoTitle: string
    shotView: string
    relativeView: string
    worldView: string
}

export interface ShotReplayDeps {
    rig: TurretRigHandle
    hm: ShotHeatmapHandle
    tc: Pick<TrajectoryCardHandle, 'tidyTrajectory'>
    jc: ShotJudgmentHandle
    ml: ModelLifecycleHandle
    QP: URLSearchParams
    loadGen: { get(): number }
    isDestroyed(): boolean
    getTankData(): TankData
    getScene(): THREE.Scene
    getCamera(): THREE.PerspectiveCamera
    getControls(): ShotControls
    getSelectedShell(): ShellSpec | null
    setSelectedShell(shell: ShellSpec): void
    getShooterShells(): ShellSpec[]
    getShooterData(): TankData | null
    getPenetrationMode(): boolean
    getArmorStateDecl(): ArmorStateDecl | null
    getTurretDeg(): number
    getGunDeg(): number
    setWorldOverviewMode(on: boolean): void
    L: ShotReplayLabels
    syncEquipmentCheckboxes(s: ReplayShot): void
    clearShotError(): void
    showShotError(msg: string): void
    shotErrorHtml(): string
    eqBadge(equipment: unknown): string
    dbgReset(): void
    setupShotDebug(refresh: ((on: boolean) => void) | null): void
    dbgInfo(id: string, color: string, name: string, text: string): void
    fmt3(x: number, y: number, z: number): string
    decodeModules(mask: number): string[]
    shellIdParts(gid: number): { local: number; nation: number } | null
    srQualityIssues(shot: ReplayShot): string[]
    setArmorState(stateId: number): void
    syncArmorStateControl(): void
    isShooterLoading(): boolean
    getCurrentShooterId(): number | string | null
}


export function runShotReplay(deps: ShotReplayDeps): void {
    const {
        rig, hm, tc, jc, ml, QP, L, getTankData,
        getScene, getCamera, getControls,
        getSelectedShell, setSelectedShell, getShooterShells, getShooterData,
        getPenetrationMode, getArmorStateDecl, getTurretDeg, getGunDeg,
        syncEquipmentCheckboxes, clearShotError, showShotError,
        shotErrorHtml, eqBadge, dbgReset, setupShotDebug, dbgInfo, fmt3,
        decodeModules, shellIdParts, srQualityIssues,
        setArmorState, syncArmorStateControl,
    } = deps

                const shotGen = deps.loadGen.get();
                const currentShot = () => !deps.isDestroyed() && shotGen === deps.loadGen.get();
                const shotQuery = QP.get('shot') || '';
                fetchReplayShots().then(d => {
                    if (!currentShot()) return;
                    const shots = d.shots || d;
                    const s: ReplayShot | undefined = (Array.isArray(shots) ? shots : [])
                        .find((x: ReplayShot) => x.index === parseInt(shotQuery, 10));
                    if (!s) { showShotError('shot #' + parseInt(shotQuery, 10) + ' 不存在（接口返回 ' + (Array.isArray(shots) ? shots.length : 0) + ' 发）'); return; }
                    if (!rig.getArmorPivotGun()) { showShotError('炮管枢轴未安装（模型装配异常）'); return; }
                    const ta = s.target_ang || [0, 0, 0];
                    const isWorld = true;
                    if (isWorld) mirrorShotData(s);
                    let hitAtt: { pitch: number; roll: number } | null = null;
                    {
                        let pre: PoseTickSample | null = null;
                        for (const t of (s.tick_samples || [])) {
                            if ((t.dt ?? NaN) < -0.02 && (!pre || (t.dt ?? NaN) > (pre.dt ?? NaN))) pre = t;
                        }
                        if (pre && (pre.dt ?? NaN) > -0.35) hitAtt = { pitch: pre.pitch ?? 0, roll: pre.roll };
                    }
                    const taF: Vec3 = [ (ta[0]||0),
                        (hitAtt ? hitAtt.pitch : (ta[1]||0)),
                        (hitAtt ? hitAtt.roll : (ta[2]||0)) ];

                     window.__worldPenMode = false;
                     window.__segBoxMissing = false;
                     clearShotError();
                     deps.setWorldOverviewMode(false);
                     window.__shotCtx = Object.assign({}, window.__shotCtx || {}, {
                         shot: s,
                         segArmorGroup: s.armor_group || 0,
                         segShellId: s.shell_id || 0,
                         segResult: (typeof s.game_hit_result === 'number') ? s.game_hit_result : 255,
                         eqShooter: s.shooter_equipment || null,
                         eqTarget: s.target_equipment || null,
                     });
                     syncEquipmentCheckboxes(s);
                     const targetArmorState = s.target_armor_state;
                     if (typeof targetArmorState === 'number' && Number.isInteger(targetArmorState)) {
                         setArmorState(targetArmorState);
                     }
                     const stOpt = document.getElementById('armor-state-opt');
                     const stBox = document.getElementById('armor-state-toggle') as HTMLInputElement | null;
                     if (stOpt && stBox) {
                         const dynamic = !!getArmorStateDecl();
                         stOpt.style.display = dynamic ? '' : 'none';
                         const replayAuto = typeof targetArmorState === 'number' && Number.isInteger(targetArmorState);
                         stBox.disabled = !dynamic || replayAuto;
                         stBox.title = replayAuto ? L.armorStateAutoTitle : '';
                         if (dynamic) syncArmorStateControl();
                     }
                    const loadShooterModel = createShooterModelFactory({
                        getTankData, getShooterData, getSelectedShell,
                        isShooterLoading: () => deps.isShooterLoading(),
                        getCurrentShooterId: () => deps.getCurrentShooterId(),
                        currentShot,
                        ml,
                        getScene,
                    });
                        getControls().maxDistance = 1e6;
                        getControls().minDistance = 0.5;
                        getControls().mouseButtons.RIGHT = THREE.MOUSE.PAN;
                        getControls().screenSpacePanning = false;
                        window.__worldPan = true;
                        const isMiss = !s.target_name;
                        if (isMiss) {
                            const missDeps = deps as ShotReplayDeps & {
                                ml: { models: { tankModel: THREE.Object3D; armorModel: THREE.Object3D } };
                            };
                            renderMissShotAnnotation(missDeps, { s, currentShot, QP, loadShooterModel, poseShooterTurretGun });
                        }
                        if (!isMiss) {
                        dbgReset();
                        const tPos = s.target_pos;
                        if (!tPos) { showShotError('受击弹缺少目标位置（target_pos），射击复现已阻断'); return; }
                        const tankModel = ml.models.tankModel, armorModel = ml.models.armorModel;
                        if (!tankModel || !armorModel) {
                            showShotError('目标模型未就绪（模型装配异常），射击复现已阻断');
                            return;
                        }
                        const sTS = s.shooter_tick_samples || [];
                        const sHit = sTS.reduce((a, b) =>
                            (Math.abs(b.dt ?? NaN) < Math.abs(a.dt ?? NaN)) ? b : a,
                            sTS[0] as PoseTickSample);
                        const shooterWorld = s.shooter_render ? s.shooter_render.pos
                            : (sHit ? sHit.pos : s.shooter_pos);
                        if (!shooterWorld) { showShotError('受击弹缺少射手位置（shooter_pos），射击复现已阻断'); return; }

                        const cx = (tPos[0] + shooterWorld[0]) / 2;
                        const cy = (tPos[1] + shooterWorld[1]) / 2;
                        const cz = (tPos[2] + shooterWorld[2]) / 2;

                        const rt = s.target_render;
                        const baseT = rt ? rt.pos : tPos;
                        const angT = rt ? rt.ang : taF;
                        tankModel.position.set(baseT[0] - cx, baseT[1] - cy, baseT[2] - cz);
                        const qT = poseFromYPR(angT[0], angT[1], angT[2]);
                        tankModel.quaternion.copy(qT);
                        armorModel.position.copy(tankModel.position);
                        armorModel.quaternion.copy(qT);
                        tankModel.updateMatrixWorld(true);
                        armorModel.updateMatrixWorld(true);

                        let turretDegT = ((s.target_turret_yaw || 0) - ta[0]) * 180 / Math.PI;
                        turretDegT = ((turretDegT + 180) % 360 + 360) % 360 - 180;
                        window.__fireGunDegT = (s.target_gun_pitch || 0) * 180 / Math.PI;
                        rig.updateTurretGun(turretDegT, window.__fireGunDegT);

                        const shooterTid = parseInt(QP.get('shooter') || '', 10);
                        if (shooterTid > 0) {
                            loadShooterModel(shooterTid, {
                                castShadow: true,
                                logTag: '[world]',
                                applyPose: function(sModel) {
                                    const sR = s.shooter_render;
                                    const sYaw = sR ? sR.ang[0] : (sHit ? sHit.yaw : 0);
                                    sModel.quaternion.copy(poseFromYPR(sYaw,
                                        sR ? sR.ang[1] : (sHit ? (sHit.pitch ?? 0) : 0),
                                        sR ? sR.ang[2] : (sHit ? sHit.roll : 0)));
                                    sModel.position.set(shooterWorld[0] - cx, shooterWorld[1] - cy, shooterWorld[2] - cz);
                                    window.__shooterFix = new THREE.Vector3(0, 0, 0);
                                },
                            }).then(function(res) {
                                if (!res || !currentShot()) return;
                                const sd = res.sd, sModel = res.sModel, breechGunLocal = res.breechGunLocal;
                                const sR2 = s.shooter_render;
                                const sYaw = sR2 ? sR2.ang[0] : (sHit ? sHit.yaw : 0);
                                const sgp = (s.quality && s.quality.gun_pitch_degraded &&
                                    s.quality.gun_pitch_degraded.indexOf('shooter') >= 0)
                                    ? null : (s.shooter_gun_pitch != null ? s.shooter_gun_pitch : null);
                                const sRel = (s.shooter_turret_yaw || 0) - (s.shooter_ang ? s.shooter_ang[0] : 0);
                                poseShooterTurretGun(sModel, sd, s.shooter_turret_yaw, s.launch_velocity, sYaw,
                                    sR2 ? sR2.ang[1] : (sHit ? (sHit.pitch ?? 0) : 0),
                                    sR2 ? sR2.ang[2] : (sHit ? sHit.roll : 0), sgp, sRel, s.shooter_config_idx);
                                installShooterMuzzleMarker(sModel, breechGunLocal,
                                    { cx, cy, cz, getScene, dbgInfo, fmt3 });
                                window.__shooterModel = sModel;
                                window.__shooterData = sd;
                                if (window.__updateAnchorMarkers) window.__updateAnchorMarkers();
                            });
                        }

                        const ba = s.ball_a, bb = s.ball_b;
                        installAnchorMarkers({ cx, cy, cz, getScene, dbgInfo, fmt3 }, tankModel);
                        if (window.__worldAnno) { getScene().remove(window.__worldAnno); disposeOverlayObject(window.__worldAnno); }
                        window.__worldImpactMk = null;
                        window.__worldAnno = new THREE.Group();
                        const SHOW_TRAJ_ANNO = (shotResultClass(s) === 'MISS');
                        const trajCtx = buildTrajectoryAnnotation(
                            { s, cx, cy, cz, armorModel, dbgInfo, fmt3 }, ba ?? undefined, bb ?? undefined, SHOW_TRAJ_ANNO);
                        const ctxLaunch = trajCtx.ctxLaunch;
                        const ctxLvDir = trajCtx.ctxLvDir;
                        const ctxLvSpd = trajCtx.ctxLvSpd, ctxRayFar = trajCtx.ctxRayFar;
                        if (ba && bb) {
                                installSegmentJudgment({
                                    s, cx, cy, cz, armorModel, getScene, dbgInfo, fmt3,
                                    getTankData, rig, tc, showShotError, currentShot,
                                    getTurretDeg, getGunDeg,
                                });
                        }
                        placeImpactCamera({ cx, cy, cz, getCamera, getControls },
                            ba ?? undefined, bb ?? undefined, ctxLaunch, tPos, shooterWorld!);
                        getControls().update();

                        getScene().add(window.__worldAnno);

                        window.__worldPenMode = true;
                        deps.setWorldOverviewMode(true);
                        window.__shotIsHit = true;
                        buildMoveAnnotation({ s, tPos, cx, cy, cz, getScene });

                        window.__worldTickCtx = {
                            launch: ctxLaunch, lvDir: ctxLvDir, lvSpd: ctxLvSpd, rayFar: ctxRayFar,
                        };
                        const st = document.getElementById('turret-controls');
                        if ((s.tick_samples || []).length > 1) autoSelectReplayShell({
                            s, QP, getShooterShells, getShooterData, setSelectedShell,
                            getSelectedShell, getPenetrationMode, hm,
                        });
                        if (st) st.innerHTML = buildWorldPanelHtml({
                            s, shotErrorHtml, eqBadge, shellIdParts, decodeModules,
                            srQualityIssues, sTS,
                        });
                        installMoveToggle();
                        const stEl = document.getElementById('turret-controls');
                        if (stEl) stEl.style.display = 'none';
                        setupShotDebug(function() {
                            if (window.__updateAnchorMarkers) window.__updateAnchorMarkers();
                        });
                        installViewSwitch({ QP, L, tankModel, armorModel, getCamera, getControls,
                            setWorldOverviewMode: (on) => deps.setWorldOverviewMode(on) });
                        installTimeScrubHandler({
                            s, QP, L, cx, cy, cz, tPos, tankModel, armorModel, rig, jc,
                            getScene, getCamera, getControls, currentShot, dbgInfo, fmt3,
                        });
                        if (ctxLvDir && ctxLaunch) {
                            jc.setShotRay(ctxLaunch.clone(), ctxLaunch.clone().addScaledVector(ctxLvDir, ctxRayFar));
                            jc.doPenetrationCheck(0, 0);
                            jc.clearShotRay();
                        }
                        return;
                    }
                }).catch(e => { console.error('[shot-replay] load chain error:', e); if (currentShot()) showShotError('射击复现数据加载失败: ' + e); });
}
