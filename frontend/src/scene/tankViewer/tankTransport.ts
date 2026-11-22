// 距离/炮塔/相机预设/URL 选项/配置可见性 owner（2026-11-22 自 tankViewer.js 闭包出仓，纯搬移）。
// 依赖读取统一经宿主对象 S。
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
            const distance = S.ml.models.tankModel && S.ml.models.armorModel && !S.contextLost && Number.isFinite(raw) && raw > 0
                ? Math.round(raw) : null;
            if (distance === S.lastReportedDistance) return;
            S.lastReportedDistance = distance;
            S.onDistanceChange?.(distance == null ? null : {
                distance, min: S.controls.minDistance, max: S.controls.maxDistance, readOnly: recorded,
            });
        }

function setDistance(S: Host, value: number) {
            if (S.destroyed || S.contextLost || !S.ml.models.tankModel || !S.ml.models.armorModel || S.QP.has('shot')
                || typeof value !== 'number' || !Number.isFinite(value)) return false;
            // 无阻尼 update 会先应用残余旋转/平移，再清空惯性；必须先保存当前姿态。
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
            // 炮轴基准点 = 炮线枢轴（pose.target）：门禁量"炮管指向镜头"以它为基准——
            // placement.target 是（不动的）轨道中心，不是炮线上的点。
            S.lastPresetTarget = pose.target.clone();
            // preserveView 在清惯性**之前**取景快照：无阻尼 update 会把残余 panOffset 一次性
            // 应用（target 跳到平移终点），与 setDistance 同口径——快照 → 清惯性 → 用快照摆位。
            // 按钮（preserveView）的两个约束（2026-11-13 反馈定稿）：旋转中心保持
            // 默认/用户当前值**不得移动**；同时机位移到炮轴线上（距中心 = 用户距离），
            // 炮管正对镜头。URL 首载路径没有用户取景，仍由预设完整摆位（15m 基准）。
            const userView = preserveView
                ? { target: S.controls.target.clone(), position: S.camera.position.clone() }
                : null;
            // 先清除轨道惯性，再设置预设；后续拖动仍由 OrbitControls 正常接管。
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
            // 普通检视两个模型都完成后再恢复 URL 下标，避免任一模型回调重建下拉框
            // 把选弹重置；手动切配置不重套 URL。
            // 射击复现的弹表/选弹由射手 scfg 与回放 shell_id 所有，不在此覆盖。
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
            // `view` 同时是 SPA 路由 id（agent-armor）。只有已知相机预设才按预设处理；
            // 否则 ?view=agent-armor 会命中 fallback（0.8×模型尺寸）覆盖默认 15m 相机距离。
            // 显式相机预设优先用 ?camview=front|top|...，兼容旧的 ?view=<preset>。
            const CAMERA_VIEW_PRESETS = new Set(['front', 'rear', 'left', 'right', 'hull_down', 'top', 'front_left', 'front_right', 'rear_left', 'rear_right']);
            const camView = S.QP.get('camview') || (CAMERA_VIEW_PRESETS.has(view) ? view : null);
            const azOv = num('az'), distOv = num('dist'), hOv = num('h');
            // 炮线高度（米）：gun 枢轴的 glb z（场景原生米制，无缩放）。默认目标也用它，
            // 让车体垂直居中（地面原点会让坦克落在屏幕上半）。
            const gunLine = (S.rig.getArmorPivotGun() ? S.rig.getArmorPivotGun().z : 2.0);
            if ((camView === 'front' || camView === 'hull_down') && azOv === null && hOv === null && distOv === null && !S.QP.get('shot')) {
                S.setCameraPreset(camView);
                // 预设只给默认姿态，显式 URL 角度仍然优先。
                restoreUrlPose();
            } else if (camView || azOv !== null || hOv !== null || distOv !== null) {
                // 视角预设（对齐 BlitzKit 语义）：front/rear/left/right = 炮线高度水平视角；
                // hull_down = 低机位仰视炮塔；top = 俯视。机位距离 = 模型最长边倍数
                //（取景需要，与数据无关）：水平 0.80×、斜角 0.87×、顶视 1.17×；顶视高度 = 炮线 + 2×模型长
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
                S.controls.target.set(0, P.ty, 0);   // 预设目标高度（炮线/顶视），不再回地面原点
            } else {
                // 默认目标 = 装甲模型包围盒中心（车体视觉中心）；包围盒为空时退回炮线高度。
                // 同时把默认相机距离归一到 15m，保持 Armor Inspector 的 18.75° 基准。
                const aimModel = S.ml.models.armorModel || S.ml.models.tankModel;
                aimModel.updateWorldMatrix(true, true);
                const aimBox = new THREE.Box3().setFromObject(aimModel);
                if (!aimBox.isEmpty()) {
                    const aimCenter = aimBox.getCenter(new THREE.Vector3());
                    S.controls.target.set(aimCenter.x, aimCenter.y, aimCenter.z);
                    // 默认正对车头（-Z）且平视：与目标同高，距离 15m；tank 在屏幕中心。
                    S.camera.position.set(aimCenter.x, aimCenter.y, aimCenter.z - S.ARMOR_REF_DIST);
                } else {
                    S.controls.target.set(0, gunLine, 0);
                    S.camera.position.set(0, gunLine, -S.ARMOR_REF_DIST);
                }
            }
            S.controls.update();
            // 击穿视图默认开启；?heatmap=0 显式关闭。换目标重载时若用户已选厚度视图，
            // 不能把击穿视图再打开成“双模式”（厚度点选与热力图会同时生效）。
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
                // 射击复现（world 模式）可视化：owner = viewer/shotReplay.js（#820 Agent A 出仓）
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
        /** shell 的权威 owner 是 URL：换目标/重载后按当前 location 恢复，不能用初始化时的 QP 快照。 */
        
        // 场景独占距离；Vue 只接收按显示精度去重的快照。回放长度不能被相机缩放覆盖。
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

        /** 宿主（装甲页）有了图形化装配编辑器时隐藏原生配置下拉；仍是场景的配置状态源。 */
        S.configUiHidden = false;
        /** 射击复现的图形面板就绪后隐藏原生弹种下拉（仍是场景的弹种状态源）。 */
        S.shellUiHidden = false;
}
