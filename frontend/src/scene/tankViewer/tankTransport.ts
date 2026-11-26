import * as THREE from 'three'
import { pitchAtBearing } from '../../replay-local/compute/tankSetup'
import { shotBallisticLength } from '../agentData.js'
import { applyArmorConfigVisible as applyArmorPrefixVisibility } from '../viewer/armorPlateModel.js'
import { armorCameraPreset, armorPresetGunPitch, armorPresetViewPlacement } from '../viewer/cameraPresets.js'
import { runShotReplay } from '../viewer/shotReplay.js'
import type { Host } from '../tankViewer.js'
import { bind } from '../hostBind.ts'
import { byId } from './domById.ts'

function requestedShellIndex(_S: Host) {
            return parseInt(new URLSearchParams(location.search).get('shell') ?? '', 10);
        }

function reportDistance(S: Host) {
            const recorded = S.QP.has('shot');
            const shot = window.__shotCtx?.shot;
            const raw = recorded
                ? (shot ? shotBallisticLength(shot) * (S.ml.getWorldMetersPerUnit() || 1) : NaN)
                : S.camera.position.distanceTo(S.controls.target) * (S.ml.getWorldMetersPerUnit() || 1);
            // exactDistance 保留弹道长度原值供分段/穿深计算；distance 只用于显示。
            // 二者都进去重键：整数相同但小数跨界（50.4 → 50.6）时仍需刷新。
            const exactDistance = S.ml.models.tankModel && S.ml.models.armorModel && !S.contextLost && Number.isFinite(raw) && raw > 0
                ? raw : null;
            const distance = exactDistance == null ? null : Math.round(exactDistance);
            const distanceKey = exactDistance == null ? 'null' : `${distance}:${exactDistance.toFixed(3)}`;
            if (distanceKey === S.lastReportedDistance) return;
            S.lastReportedDistance = distanceKey;
            S.onDistanceChange?.(exactDistance == null ? null : {
                distance, exactDistance, min: S.controls.minDistance, max: S.controls.maxDistance, readOnly: recorded,
            });
        }

function setDistance(S: Host, value: number) {
            if (S.destroyed || S.contextLost || !S.ml.models.tankModel || !S.ml.models.armorModel || S.QP.has('shot')
                || typeof value !== 'number' || !Number.isFinite(value)) return false;
            const target = S.controls.target.clone();
            const offset = S.camera.position.clone().sub(target);
            if (offset.lengthSq() === 0) return false;
            const damping = S.controls.enableDamping;
            S.controls.enableDamping = false;
            S.controls.update();
            S.controls.target.copy(target);
            const distance = THREE.MathUtils.clamp(value, S.controls.minDistance, S.controls.maxDistance);
            S.camera.position.copy(target).add(offset.setLength(distance / (S.ml.getWorldMetersPerUnit() || 1)));
            S.controls.update();
            S.controls.enableDamping = damping;
            S.applyLongRangeCompensation(!S.worldOverviewMode);
            S.reportDistance();
            return true;
        }

function setCameraPreset(S: Host, kind: 'front' | 'hull_down', { preserveView = false }: { preserveView?: boolean } = {}) {
            if (S.destroyed || S.contextLost || !S.ml.models.tankModel || !S.ml.models.armorModel || S.QP.get('shot')) return false;
            if (kind !== 'front' && kind !== 'hull_down') return false;
            const pitch = S.currentConfig()?.pitch_limits;
            const limits = pitch ? pitchAtBearing(pitch, 0,
                S.eqs.effectivePitchDevice() ? S.eqs.getPitchDeviceBonusValue() : null) : { down: 0, up: 0 };
            if (!Number.isFinite(limits.down) || !Number.isFinite(limits.up)) return false;
            S.currentTurretDeg = 0;
            S.currentGunDeg = armorPresetGunPitch(kind, limits);
            S.rig.updateTurretGun(S.currentTurretDeg, S.currentGunDeg);
            const pose = armorCameraPreset(S.rig.getArmorPivotGun() || new THREE.Vector3(0, 0, 2),
                new THREE.Matrix4().copy(S.ml.models.tankModel.matrixWorld).multiply(S.rig.gunPoseMatrix), S.ARMOR_REF_DIST);
            S.lastPresetTarget = pose.target.clone();
            const userView = preserveView
                ? { target: S.controls.target.clone(), position: S.camera.position.clone() }
                : null;
            const damping = S.controls.enableDamping;
            S.controls.enableDamping = false;
            S.controls.update();
            const placement = userView
                ? armorPresetViewPlacement(userView.target, userView.position, pose, S.controls.maxDistance)
                : pose;
            S.controls.target.copy(placement.target);
            S.camera.position.copy(placement.position);
            S.controls.update();
            S.controls.enableDamping = damping;
            byId('turret-val').textContent = '0°';
            byId('gun-val').textContent = S.currentGunDeg.toFixed(0) + '°';
            S.tc.tidyTrajectory();
            return true;
        }

function applyUrlOptionsOnce(S: Host) {
            if (S.urlApplied || !S.ml.models.tankModel || !S.ml.models.armorModel) return;
            S.urlApplied = true;
            if (!S.QP.get('shot')) {
                S.dl.populateShellSelector(S.dl.getShooterShells(), S.requestedShellIndex());
                if (S.penetrationMode && S.selectedShell) {
                    S.hm.updatePenetrationUniforms(S.selectedShell);
                    S.hm.updateSpacedUniforms(S.selectedShell);
                }
            }
            const num = (k: string) => { const v = parseFloat(S.QP.get(k)); return isNaN(v) ? null : v; };
            const yaw = num('yaw'), pitch = num('pitch');
            function restoreUrlPose() {
                if (yaw !== null || pitch !== null) {
                    if (yaw !== null) S.currentTurretDeg = Math.max(-179, Math.min(179, yaw));
                    if (pitch !== null) S.currentGunDeg = pitch;
                    byId('turret-val').textContent = S.currentTurretDeg.toFixed(0) + '°';
                    byId('gun-val').textContent = S.currentGunDeg.toFixed(0) + '°';
                    S.rig.updateTurretGun(S.currentTurretDeg, S.currentGunDeg);
                }
            }
            restoreUrlPose();
            const view = S.QP.get('view');
            const CAMERA_VIEW_PRESETS = new Set(['front', 'rear', 'left', 'right', 'hull_down', 'top', 'front_left', 'front_right', 'rear_left', 'rear_right']);
            const camView = S.QP.get('camview') || (CAMERA_VIEW_PRESETS.has(view) ? view : null);
            const azOv = num('az'), distOv = num('dist'), hOv = num('h');
            const gunLine = (S.rig.getArmorPivotGun() ? S.rig.getArmorPivotGun().z : 2.0);
            if ((camView === 'front' || camView === 'hull_down') && azOv === null && hOv === null && distOv === null && !S.QP.get('shot')) {
                S.setCameraPreset(camView);
                restoreUrlPose();
            } else if (camView || azOv !== null || hOv !== null || distOv !== null) {
                const PRESETS: Record<string, { az: number; h: number; ty: number; d: number }> = {
                    front:       {az:0,   h:gunLine,     ty:gunLine,      d:0.80*S.ml.getModelMaxDim()},
                    rear:        {az:180, h:gunLine,     ty:gunLine,      d:0.80*S.ml.getModelMaxDim()},
                    left:        {az:90,  h:gunLine,     ty:gunLine,      d:0.80*S.ml.getModelMaxDim()},
                    right:       {az:270, h:gunLine,     ty:gunLine,      d:0.80*S.ml.getModelMaxDim()},
                    hull_down:   {az:0,   h:1.1,         ty:gunLine+0.3,  d:0.83*S.ml.getModelMaxDim()},
                    top:         {az:0,   h:gunLine+2.0*S.ml.getModelMaxDim(), ty:0.1*S.ml.getModelMaxDim(), d:1.17*S.ml.getModelMaxDim()},
                    front_left:  {az:45,  h:gunLine,     ty:gunLine,      d:0.87*S.ml.getModelMaxDim()},
                    front_right: {az:315, h:gunLine,     ty:gunLine,      d:0.87*S.ml.getModelMaxDim()},
                    rear_left:   {az:135, h:gunLine,     ty:gunLine,      d:0.87*S.ml.getModelMaxDim()},
                    rear_right:  {az:225, h:gunLine,     ty:gunLine,      d:0.87*S.ml.getModelMaxDim()},
                };
                const P = (camView ? PRESETS[camView] : undefined) || {az:0, h:gunLine, ty:gunLine, d:0.80*S.ml.getModelMaxDim()};
                const d = distOv !== null ? distOv : P.d;
                const a = (azOv !== null ? azOv : P.az) * Math.PI / 180;
                const h = hOv !== null ? hOv : P.h;
                S.camera.position.set(Math.sin(a) * d, h, -Math.cos(a) * d);
                S.controls.target.set(0, P.ty, 0);
            } else {
                const aimModel = S.ml.models.armorModel || S.ml.models.tankModel;
                aimModel.updateWorldMatrix(true, true);
                const aimBox = new THREE.Box3().setFromObject(aimModel);
                if (!aimBox.isEmpty()) {
                    const aimCenter = aimBox.getCenter(new THREE.Vector3());
                    S.controls.target.set(aimCenter.x, aimCenter.y, aimCenter.z);
                    S.camera.position.set(aimCenter.x, aimCenter.y, aimCenter.z - S.ARMOR_REF_DIST);
                } else {
                    S.controls.target.set(0, gunLine, 0);
                    S.camera.position.set(0, gunLine, -S.ARMOR_REF_DIST);
                }
            }
            S.controls.update();
            if (S.QP.get('heatmap') !== '0' && !S.penetrationMode && !S.collisionMode) {
                S.penetrationMode = true;
                const btn = byId('penetration-btn');
                btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
                S.hm.applyPenetrationMode(true);
                S.hm.refreshPenetrationResolution();
            }
            const shotNo = parseInt(S.QP.get('shot'), 10);
            const isShotReplay = !isNaN(shotNo);
            if (isShotReplay) {
                runShotReplay({
                    rig: S.rig, hm: S.hm, tc: S.tc, jc: S.jc, ml: S.ml,
                    QP: S.QP,
                    loadGen: { get: () => S.loadGen },
                    isDestroyed: () => S.destroyed,
                    L: S.L,
                    getScene: () => S.scene,
                    getCamera: () => S.camera,
                    getControls: () => S.controls,
                    getSelectedShell: () => S.selectedShell,
                    setSelectedShell: (v) => { S.selectedShell = v; },
                    getShooterShells: () => S.dl.getShooterShells(),
                    getShooterData: () => S.dl.getShooterData(),
                    isShooterLoading: () => S.dl.isShooterLoading(),
                    getTankData: () => S.tankData,
                    getCurrentShooterId: () => S.dl.getCurrentShooterId(),
                    getPenetrationMode: () => S.penetrationMode,
                    getArmorStateDecl: () => S.cvs.getArmorStateDecl(),
                    getTurretDeg: () => S.currentTurretDeg,
                    getGunDeg: () => S.currentGunDeg,
                    setWorldOverviewMode: (v) => { S.worldOverviewMode = v; },
                    syncEquipmentCheckboxes: (...a) => S.eqs.syncEquipmentCheckboxes(...a),
                    clearShotError: S.du.clearShotError,
                    showShotError: S.du.showShotError,
                    shotErrorHtml: S.du.shotErrorHtml,
                    eqBadge: S.eqs.eqBadge,
                    dbgReset: S.du.dbgReset,
                    setupShotDebug: S.du.setupShotDebug,
                    dbgInfo: S.du.dbgInfo,
                    fmt3: S.du.fmt3,
                    decodeModules: S.du.decodeModules,
                    shellIdParts: S.du.shellIdParts,
                    srQualityIssues: S.du.srQualityIssues,
                    setArmorState: (...a) => S.cvs.setArmorState(...a),
                    syncArmorStateControl: () => S.cvs.syncArmorStateControl(),
                });
            }
            if (S.QP.get('clean') === '1' && !isShotReplay) {
                ['info-panel','shell-selector','view-toggle','tank-selectors','turret-controls','controls-hint','loading'].forEach(id => {
                    const el = document.getElementById(id); if (el) el.style.display = 'none';
                });
            }
        }

function currentConfig(S: Host) {
            return (S.tankData && S.tankData.configs && S.tankData.configs[S.dl.getCurrentConfigIdx()]) || null;
        }

function applyArmorConfigVisible(S: Host, cfg: Parameters<typeof applyArmorPrefixVisibility>[1]) {
            if (!S.ml.models.armorModel) { return; }
            applyArmorPrefixVisibility(S.ml.models.armorModel, cfg, S.rig.collectArmorPrefixes());
        }

export function bindTankTransport(S: Host) {
  Object.assign(S, {
    requestedShellIndex: bind(S, requestedShellIndex),
    reportDistance: bind(S, reportDistance),
    setDistance: bind(S, setDistance),
    setCameraPreset: bind(S, setCameraPreset),
    applyUrlOptionsOnce: bind(S, applyUrlOptionsOnce),
    currentConfig: bind(S, currentConfig),
    applyArmorConfigVisible: bind(S, applyArmorConfigVisible),
  })
}

export function initTankTransport(S: Host) {
S.urlApplied = false;
        
        S.lastReportedDistance = undefined;

S.activeGunNumber = () => {
            const cfg = S.currentConfig();
            if (!cfg) return null;
            const gunGroups = S.rig.getConfigGunGroups();
            const grp = gunGroups[cfg.gun_index % Math.max(1, gunGroups.length)];
            if (!grp) return null;
            for (const n of grp) {
                const m = (n.name || '').match(/^gun_(\d+)$/);
                if (m) return parseInt(m[1], 10);
            }
            return null;
        };

        S.configUiHidden = false;
        S.shellUiHidden = false;
}
