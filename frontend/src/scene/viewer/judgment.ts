import * as THREE from 'three'
import { isPrimary, withGapOrigin } from '../penetration.js'
import { judgePenetration, shotBallisticLength, type PenetrationRequest } from '../agentData.js'
import { renderJudgmentResult } from './judgmentResult.js'
import { createJudgmentClick } from './judgmentClick.js'
import { createJudgmentHits, type JudgmentHit } from './judgmentHits.js'
import { createScreenSpaceDot, disposeHitMarker } from './overlayStroke.js'
import { OVERLAY_METRICS } from './shotResultPalette.js'
import { shellTypeOf } from './armorPlateModel.js'
import type { TankArmorConfig } from './armorPlateModel.js'
import type { ModelReferences } from './modelLifecycle.js'
import type { TrajectoryCardHandle } from './trajectoryCard.js'
import type { CollisionViewHandle } from './collisionView.js'
import type { createHeatmapPipeline } from './heatmap.js'
import type { ShellSpec, TankData } from './viewerContracts.js'
import { sampleHeSplash, HE_SAMPLE } from '../heSplash.js'
import type { HeSplashResult } from '../heSplash.js'

export interface JudgmentDeps {
    models: ModelReferences
    hm: ReturnType<typeof createHeatmapPipeline>
    tc: TrajectoryCardHandle
    cvs: CollisionViewHandle
    getRenderer: () => THREE.WebGLRenderer
    getCamera: () => THREE.Camera
    getControls: () => { target: THREE.Vector3 }
    getRaycaster: () => THREE.Raycaster
    getMouse: () => THREE.Vector2
    getFxScene: () => THREE.Scene
    getCurrentConfigIdx: () => number | null
    getCollisionMode: () => boolean
    getPenetrationMode: () => boolean
    getWorldOverviewMode: () => boolean
    getTankData: () => TankData | null
    getCurrentConfig: () => TankArmorConfig | null
    getActiveGunNumber: () => number | null
    getSelectedShell: () => ShellSpec | null
    getShooterShells: () => ShellSpec[]
    getShooterCaliber: () => number | null
    getShooterData: () => { caliber?: number | null } | null
    isDestroyed: () => boolean
    isShooterLoading: () => boolean
    isShotReplay: () => boolean
    armorDebug: () => boolean
    getModuleMeshes: () => THREE.Mesh[]
    getWorldMetersPerUnit: () => number | null
    getPlateThickness: (section: string, plateId: string | number) => number
    equipmentCoeffs: () => { penMul: number; thickMul: number }
    effectiveCalibrated: (shell: ShellSpec | null) => number
    effectiveEnhanced: (shell: ShellSpec | null) => number
    shellPenMul: (shell: ShellSpec | null) => number
    L: { partName?: (name: string) => string; shellUnavailable: string }
    showShotError: (msg: string) => void
}

export function faceAngleAndEffective(
    thickness: number,
    normal: { x: number, y: number, z: number } | null | undefined,
    dir: { x: number, y: number, z: number } | null | undefined,
): { angleDeg: number | null, effective: number | null } {
    if (!normal || !dir || !Number.isFinite(thickness)) return { angleDeg: null, effective: null }
    const cosRaw = Math.abs(normal.x * dir.x + normal.y * dir.y + normal.z * dir.z)
    if (!Number.isFinite(cosRaw)) return { angleDeg: null, effective: null }
    const cos = Math.min(1, Math.max(0, cosRaw))
    const angleDeg = (Math.acos(cos) * 180) / Math.PI
    const effective = thickness / Math.max(0.05, Math.cos((angleDeg * Math.PI) / 180))
    return { angleDeg, effective: Number.isFinite(effective) ? effective : null }
}

export function createJudgment(deps: JudgmentDeps) {
    const {
        models, hm, tc,
        getCamera, getControls, getRaycaster, getMouse, getFxScene,
        getCurrentConfigIdx, getPenetrationMode, getWorldOverviewMode,
        getTankData, getCurrentConfig, getActiveGunNumber,
        getSelectedShell, getShooterCaliber, getShooterData,
        isDestroyed, isShooterLoading, armorDebug,
        getModuleMeshes, getWorldMetersPerUnit,
        equipmentCoeffs, effectiveCalibrated, effectiveEnhanced, shellPenMul,
        L, showShotError,
    } = deps
    let __shotRayOrigin: THREE.Vector3 | null = null;
    let __shotRayTarget: THREE.Vector3 | null = null;
    let __penCheckSeq = 0;
    let judgmentCount = 0;
const { isEffectivelyVisible, classifyHit, intersectArmorDoubleSidedSpaced, collectJudgmentHits } = createJudgmentHits(deps)
const { onClick, showArmorPartInfo, getLastClickNdc, setLastClickNdc, clearLastClickNdc } = createJudgmentClick(deps, classifyHit, faceAngleAndEffective, doPenetrationCheck)

function resolveCaliberFor(shell: ShellSpec | null): number {
            const candidates: Array<number | null | undefined> = [
                shell && shell.caliber,
                getShooterCaliber(),
                getShooterData()?.caliber,
            ];
            for (const value of candidates) {
                if (value != null && Number.isFinite(value) && value > 0) return value;
            }
            return 0;
        }

function resolveShotCaliber() {
            return resolveCaliberFor(getSelectedShell());
        }

function doPenetrationCheck(ndcX: number, ndcY: number): void {
            if (isDestroyed() || !models.armorModel || isShooterLoading()) return;
            if (window.__worldPenMode === true && window.__segBoxMissing === true) {
                tc.tidyTrajectory();
                return;
            }
            const shellForGuard = getSelectedShell();
            const shellTypeNow = shellForGuard ? shellTypeOf(shellForGuard) : null;
            if (!shellForGuard || !shellTypeNow
                || !Number.isFinite(shellForGuard.penetration) || !(shellForGuard.damage != null && shellForGuard.damage > 0)
                || !(resolveShotCaliber() > 0)
                || ((shellTypeNow === 'ap' || shellTypeNow === 'apcr')
                    && !Number.isFinite(shellForGuard.normalization))) {
                showShotError(L.shellUnavailable);
                return;
            }
            hm.updateCollisionWorldMatrices();
            judgmentCount++;
            const penSeq = ++__penCheckSeq;

            models.armorModel!.traverse(function(node) {
                if (!(node as THREE.Mesh).isMesh) return;
                if (node.userData.configHidden) return;
                if (node.userData.armorSection === 'deco') { node.visible = false; return; }
                if (node.visible === false) node.visible = true;
            });
            const activeGun = getActiveGunNumber();
            const cfgForGun = getCurrentConfig();
            const gunHasMask = cfgForGun && typeof cfgForGun.gun_mask === 'number' && cfgForGun.gun_mask !== 0;
            hm.computeGunClipPlane();
            const activeModules = activeGun == null
                ? getModuleMeshes()
                : getModuleMeshes().filter(m => {
                    if (m.userData.gunConfig != null) return m.userData.gunConfig === activeGun;
                    return true;
                }).filter(m => !(m.userData.gunMaskPart && !gunHasMask));
            for (const mesh of activeModules) {
                if (mesh.visible === false) mesh.visible = true;
            }

            if (window.__segRay) {
                getRaycaster().set(window.__segRay.origin.clone(), window.__segRay.dir);
            } else if (__shotRayOrigin && __shotRayTarget) {
                const dir = __shotRayTarget.clone().sub(__shotRayOrigin).normalize();
                getRaycaster().set(__shotRayOrigin.clone(), dir);
            } else {
                getMouse().x = ndcX;
                getMouse().y = ndcY;
                getRaycaster().setFromCamera(getMouse(), getCamera());
            }
            const objects = [models.armorModel, ...activeModules];
            const intersects = intersectArmorDoubleSidedSpaced(objects, getRaycaster());
            const { hits: armorHits, firstContact } = collectJudgmentHits(intersects, getRaycaster().ray.direction);

            const isCameraClick = !window.__segRay && !(__shotRayOrigin && __shotRayTarget);
            if (isCameraClick && shellTypeNow !== 'he' && armorHits.length > 0
                && !armorHits.some(h => isPrimary(h.section))) {
                disposeHitMarker(getFxScene());
                document.getElementById('traj-info')!.style.display = 'none';
                tc.clearTrajInfoPos();
                tc.clearTrajGroup()
                return;
            }

            if (armorHits.length === 0) {
                console.warn('[shot-replay] check: 0 armor hits, intersects=' + intersects.length);
                tc.tidyTrajectory();
                disposeHitMarker(getFxScene());
                if (window.__shotIsHit) {
                    if (window.__worldPenMode) {
                        const div = document.getElementById('traj-info');
                        div!.innerHTML = '<div style="background:var(--tooltip-bg);border-radius:10px;'
                            + 'border-left:4px solid #ffcf5c;padding:10px 16px;font-size:13px;color:var(--yellow);'
                            + 'white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,0.5);">'
                            + '当前 tick 位姿与弹道弦不相交（命中前采样，坦克未到命中点）— 切换 tick 查看命中判定</div>';
                        tc.setTrajInfoPos(getControls().target.clone());
                    } else {
                        showShotError('服务器判定命中但射线未命中任何装甲板——弹道/模型几何错位');
                    }
                }
                return;
            }

            const first = firstContact || armorHits[0];
            const checkHits: JudgmentHit[] = shellTypeNow === 'heat'
                ? withGapOrigin(armorHits, firstContact)
                : armorHits;
            const hitsForCheck: JudgmentHit[] = shellTypeNow === 'he' ? [first] : checkHits;
            const point = first.point;
            const segCtx = window.__shotCtx || {};
            let fragOk = null;
            if ((segCtx.segArmorGroup ?? 0) > 0) {
                const pid = parseInt(String(first.plateId), 10);
                fragOk = (!isNaN(pid)) && pid === segCtx.segArmorGroup;
            }
            disposeHitMarker(getFxScene());
            const marker = createScreenSpaceDot(
                point, OVERLAY_METRICS.markerPendingColor, OVERLAY_METRICS.markerSizePx,
                { renderOrder: OVERLAY_METRICS.markerRenderOrder },
            );
            getFxScene().add(marker);
            window.__hitMarker = marker;
            if (window.__shotCtx) {
                window.__shotCtx.fragValidated = fragOk;
                if (fragOk !== null) {
                    console.log('[shot-replay] 片元验证:', fragOk ? '✓ 一致' : '✗ 不一致',
                        'raycast=' + first.section + '#' + first.plateId, 'segment_group=' + segCtx.segArmorGroup);
                }
            }
            const worldPen = window.__worldPenMode === true && !!models.armorModel.parent;
            const toLocalPt = (p: THREE.Vector3) => (worldPen ? models.armorModel!.worldToLocal(p.clone()) : p.clone());
            const viewDir = (window.__segRay)
                ? window.__segRay.dir.clone()
                : (__shotRayOrigin && __shotRayTarget)
                    ? __shotRayOrigin.clone().sub(point).normalize()
                    : getCamera().position.clone().sub(point).normalize();
            const incomingDirection = getRaycaster().ray.direction.clone();
            const shotRayO = (window.__segRay || __shotRayOrigin)
                ? getRaycaster().ray.origin.clone() : null;

            const shotLenForDist = (window.__shotCtx && window.__shotCtx.shot)
                ? shotBallisticLength(window.__shotCtx.shot) * (getWorldMetersPerUnit() || 1) : 0;
            const dist = shotLenForDist > 0
                ? shotLenForDist
                : point.distanceTo(getCamera().position) * (getWorldMetersPerUnit() || 1);

            const shellType = shellTypeOf(getSelectedShell()!);
            const pen = getSelectedShell() ? (getSelectedShell()!.penetration || 0) : 0;
            const dmg = getSelectedShell() ? (getSelectedShell()!.damage || 0) : 0;
            const modDmg = getSelectedShell() ? (getSelectedShell()!.module_damage || 0) : 0;
            const caliber = resolveShotCaliber();
            const isHE = shellType === 'he';
            const eqCal = effectiveCalibrated(null);
            const eqEnh = effectiveEnhanced(null);
            const effDistM = dist;
            const penDisp = pen * shellPenMul(getSelectedShell());
            const mpu = getWorldMetersPerUnit() || 1;
            const shellNormDeg = (getSelectedShell() && getSelectedShell()!.normalization != null) ? getSelectedShell()!.normalization : null;
            const shellRicoDeg = (getSelectedShell() && (getSelectedShell()!.ricochet ?? 0) > 0) ? (getSelectedShell()!.ricochet ?? null) : null;

            const heRadius = isHE ? ((getSelectedShell() && getSelectedShell()!.explosion_radius) || 0) : 0;
            let heSplash: HeSplashResult | null = null;
            let heSplashError: string | null = null;
            const heOutsideDir = isHE
                ? (window.__segRay ? window.__segRay.dir.clone().negate() : viewDir.clone())
                : null;
            if (heOutsideDir && heOutsideDir.lengthSq() < 1e-12) heOutsideDir.copy(first.normal);
            if (isHE) {
                if (!(heRadius > 0) || !(dmg > 0)) {
                    heSplashError = 'shell-data:explosion-radius-or-damage';
                    console.error('[he-splash] shell data incomplete — splash sampling unavailable:', heSplashError);
                } else {
                    const splashGeo = hm.buildSplashGeometry();
                    const hePack = splashGeo.pack;
                    const heGrid = splashGeo.grid;
                    if (!hePack.ok) {
                        heSplashError = 'collision-pack:' + (hePack.reason || 'unknown');
                        console.error('[he-splash] collision pack failed — splash sampling unavailable:', heSplashError);
                    } else {
                        if (!heGrid || !heGrid.ok) {
                            heSplashError = 'collision-grid:' + ((heGrid && heGrid.reason) || 'missing');
                            console.error('[he-splash] collision grid failed — splash sampling unavailable:', heSplashError);
                        } else {
                            heSplash = sampleHeSplash(hePack, point, {
                                originDir: heOutsideDir,
                                normal: first.normal,
                                damage: dmg,
                                explosionRadius: heRadius,
                                liningFactor: equipmentCoeffs().thickMul,
                                grid: heGrid,
                                clipPlane: hm.getGunClipPlane(),
                            });
                            if (!heSplash) {
                                heSplashError = 'sampler:invalid-input';
                                console.error('[he-splash] sampler rejected its inputs:', heSplashError);
                            }
                        }
                    }
                }
            }
            if (isHE && heRadius > 0) {
                const heCenter = (heSplash && Array.isArray(heSplash.origin))
                    ? new THREE.Vector3(heSplash.origin[0], heSplash.origin[1], heSplash.origin[2])
                    : point.clone().addScaledVector(heOutsideDir || first.normal, HE_SAMPLE.ORIGIN_OFFSET);
                hm.setHeHeatmapCenter(heCenter);
                hm.updateHeHeatmapUniforms();
                hm.updateHeSplashVisual(heCenter, heRadius);
            } else {
                hm.clearHeBlast();
            }
            hm.syncHeatOverlay();

            const requirePrimary = window.__worldPenMode === true;
            const req: PenetrationRequest = {
                shell_type: shellType, shell_type_id: getSelectedShell() ? (getSelectedShell()!.type_id ?? null) : null,
                penetration: pen,
                caliber: caliber,
                damage: dmg,
                explosion_radius: isHE ? heRadius : 0,
                calibrated_shells: eqCal,
                enhanced_armor: eqEnh,
                normalization_deg: shellNormDeg,
                ricochet_deg: shellRicoDeg,
                allow_ricochet: true,
                require_primary: requirePrimary,
                distance_m: effDistM > 0 ? effDistM : undefined,
                penetration_far: (getSelectedShell() && (getSelectedShell()!.penetration_far ?? 0) > 0)
                    ? (getSelectedShell()!.penetration_far ?? undefined)
                    : undefined,
                he_splash: heSplash,
                he_splash_error: heSplashError,
                view_dir: [viewDir.x, viewDir.y, viewDir.z],
                hits: hitsForCheck.map(ah => {
                    const lp = toLocalPt(ah.point);
                    return {
                        section: ah.section,
                        plate_id: ah.plateId,
                        thickness: ah.thickness,
                        normal: [ah.normal.x, ah.normal.y, ah.normal.z],
                        point: [lp.x * mpu, lp.y * mpu, lp.z * mpu],
                        part_name: ah.partName,
                        ...(ah.contact_normal ? {
                            contact_normal: [ah.contact_normal.x, ah.contact_normal.y, ah.contact_normal.z],
                            contact_point: (() => {
                                const cp = toLocalPt(ah.contact_point!);
                                return [cp.x * mpu, cp.y * mpu, cp.z * mpu];
                            })(),
                            contact_thickness: ah.contact_thickness,
                            contact_part_name: ah.contact_part_name || null,
                        } : {}),
                    };
                }),
            };

            judgePenetration(req).then(res => renderJudgmentResult(res, {
                tc, armorDebug, getCurrentConfig, getTankData, getCurrentConfigIdx, getSelectedShell, equipmentCoeffs, getCamera, getControls,
                getWorldOverviewMode, getPenetrationMode, isStale: () => isDestroyed() || penSeq !== __penCheckSeq,
                hitsForCheck, point, isHE, pen, dmg, first, heRadius, eqCal, eqEnh, dist, viewDir, incomingDirection,
                intersectArmorDoubleSidedSpaced, collectJudgmentHits, objects, shellType, shellNormDeg, shellRicoDeg,
                requirePrimary, mpu, penDisp, modDmg, shotRayO, caliber, ndcX, ndcY,
            })).catch(err => {
                if (isDestroyed() || penSeq !== __penCheckSeq) return;
                console.error('Penetration API error:', err);
                tc.showTrajectory(point, 'ERROR', 0, [], penDisp, dmg, modDmg, dist, shotRayO, 0, null, null, false);
            });
        }
    return {
        onClick, showArmorPartInfo, classifyHit, intersectArmorDoubleSidedSpaced,
        collectJudgmentHits, resolveCaliberFor, doPenetrationCheck, isEffectivelyVisible,
        resolveShotCaliber: () => resolveCaliberFor(getSelectedShell()),
        setShotRay(origin: THREE.Vector3 | null, target: THREE.Vector3 | null) { __shotRayOrigin = origin; __shotRayTarget = target; },
        clearShotRay() { __shotRayOrigin = null; __shotRayTarget = null; },
        bumpPenSeq() { __penCheckSeq++; },
        getJudgmentCount: () => judgmentCount,
        getLastClickNdc, setLastClickNdc, clearLastClickNdc,
    };
}

export { installSegmentJudgment } from './segmentJudgment.js'
export type { SegmentJudgmentCtx } from './segmentJudgment.js'
