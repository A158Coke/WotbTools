import * as THREE from 'three'
import type { ShotReplayAnnotationCtx } from './shotReplaySeg.js'
import type { TurretRigHandle } from './turretRig.js'
import type { TrajectoryCardHandle } from './trajectoryCard.js'
import type { TankData } from './viewerContracts.js'

export function decodeB255(b: number, min: number, size: number): number {
    return min + size * (b / 255)
}

export interface SegmentJudgmentCtx extends Pick<ShotReplayAnnotationCtx, 's' | 'cx' | 'cy' | 'cz' | 'armorModel' | 'getScene' | 'dbgInfo' | 'fmt3'> {
    getTankData(): TankData
    rig: TurretRigHandle
    tc: Pick<TrajectoryCardHandle, 'tidyTrajectory'>
    showShotError(msg: string): void
    currentShot(): boolean
    getTurretDeg(): number
    getGunDeg(): number
}

export function installSegmentJudgment(ctx: SegmentJudgmentCtx): void {
    const { s, cx, cy, cz, armorModel, getScene, dbgInfo, fmt3 } = ctx;
    const { getTankData, rig, tc, showShotError, currentShot, getTurretDeg, getGunDeg } = ctx;
    window.__worldSegMk = null;
    window.__segRay = null;
    if (window.__worldSegGroup) { getScene().remove(window.__worldSegGroup); window.__worldSegGroup = null; }
    if (!armorModel) return;
    if (s.hit_token && /^[0-9a-f]{12}$/i.test(s.hit_token)) {
        const hb: number[] = [];
        for (let hi = 0; hi < 6; hi++) hb.push(parseInt(s.hit_token.substr(hi * 2, 2), 16));
        const partOfS = (o: THREE.Object3D): number => { const nm = o.name || '';
            if (/^turret_\d+_armor_/.test(nm)) return 2;
            if (/^gun_\d+_armor_/.test(nm)) return 3;
            const u = o.userData || {};
            const sec = u.armorSectionOrig || u.armorSection;
            return sec === 'chassis' ? 0 : sec === 'hull' ? 1 : (sec === 'turret' || sec === 'gun') ? 2 : sec === 'gunBarrel' ? 3 : -1; };
        const sPart2 = (typeof s.server_part_index === 'number') ? s.server_part_index : null;
        const partNodes: THREE.Object3D[] = [];
        armorModel.traverse(function(n: THREE.Object3D) {
            if (!(n as THREE.Mesh).isMesh) return;
            const u = n.userData || {};
            if (u.armorSection === 'deco') return;
            if (sPart2 != null && partOfS(n) !== sPart2) return;
            partNodes.push(n);
        });
        const partFallback = partNodes.length === 0 && sPart2 === 0;
        if (partFallback) {
            armorModel.traverse(function(n: THREE.Object3D) {
                if (!(n as THREE.Mesh).isMesh) return;
                const u = n.userData || {};
                if (u.armorSection === 'deco') return;
                if (partOfS(n) === 1) partNodes.push(n);
            });
        }
        const cdBoxes = (getTankData() && getTankData().collision_boxes) || null;
        const gameBoxRaw = cdBoxes ? (sPart2 === 0 ? cdBoxes.chassis
            : sPart2 === 1 ? cdBoxes.hull : sPart2 === 2 ? cdBoxes.turret
            : sPart2 === 3 ? cdBoxes.gun : null) : null;
        const box = (gameBoxRaw && gameBoxRaw.min && gameBoxRaw.max) ? gameBoxRaw : null;
        const boxMissing = !box || partNodes.length === 0;
        const boxFrame = (sPart2 === 2) ? 'turret-pivot' : (sPart2 === 3) ? 'gun-pivot' : 'model';
        const findPartMesh = function(re: RegExp): THREE.Object3D | null {
            let found: THREE.Object3D | null = null;
            armorModel.traverse(function(n: THREE.Object3D) {
                if (!found && (n as THREE.Mesh).isMesh && re.test(n.name || '')) found = n;
            });
            return found;
        };
        const turretPivotMissing = !boxMissing && boxFrame === 'turret-pivot'
            && !findPartMesh(/^turret_\d+_armor/) && !rig.getArmorPivotTurret();
        if (box && partNodes.length !== 0 && !turretPivotMissing) {
            const boxMin = box.min, boxMax = box.max;
            const szv = [boxMax[0] - boxMin[0], boxMax[1] - boxMin[1], boxMax[2] - boxMin[2]];
            const qc = (b: number, ax: number): number => decodeB255(b, boxMin[ax], szv[ax]);
            const mkP1 = new THREE.Mesh(new THREE.OctahedronGeometry(0.12),
                new THREE.MeshBasicMaterial({ color: 0xffa500, transparent: true, opacity: 0.95, depthTest: false }));
            const mkP2 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10),
                new THREE.MeshBasicMaterial({ color: 0x22ff88, wireframe: true, transparent: true, opacity: 0.95, depthTest: false }));
            const segLine = new THREE.Line(new THREE.BufferGeometry(),
                new THREE.LineDashedMaterial({ color: 0xffa500, transparent: true, opacity: 0.85, dashSize: 0.25, gapSize: 0.15, depthTest: false }));
            mkP1.renderOrder = 998; mkP2.renderOrder = 998; segLine.renderOrder = 997;
            window.__worldSegGroup = new THREE.Group();
            window.__worldSegGroup.add(mkP1);
            window.__worldSegGroup.add(mkP2);
            window.__worldSegGroup.add(segLine);
            getScene().add(window.__worldSegGroup);
            const placePt = function(q: number[]): THREE.Vector3 | null {
                const pl = new THREE.Vector3(qc(q[0], 0), qc(q[1], 1), qc(q[2], 2));
                if (boxFrame === 'turret-pivot') {
                    const tm = findPartMesh(/^turret_\d+_armor/);
                    if (tm) { tm.updateWorldMatrix(true, false); return tm.localToWorld(pl); }
                    const pvT = rig.getArmorPivotTurret();
                    if (!pvT) return null;
                    const yaw = THREE.MathUtils.degToRad(getTurretDeg());
                    pl.applyMatrix4(new THREE.Matrix4().makeRotationZ(yaw)
                        .setPosition(pvT.x, pvT.y, pvT.z));
                    return armorModel.localToWorld(pl);
                }
                if (boxFrame === 'gun-pivot') {
                    const gm = findPartMesh(/^gun_\d+_armor/);
                    if (gm) { gm.updateWorldMatrix(true, false); return gm.localToWorld(pl); }
                    const pitch = THREE.MathUtils.degToRad(getGunDeg());
                    pl.applyMatrix4(new THREE.Matrix4().makeRotationX(pitch));
                    const pvT = rig.getArmorPivotTurret(), pvG = rig.getArmorPivotGun();
                    if (pvG && pvT) {
                        pl.add(pvG.clone().sub(pvT));
                        pl.applyMatrix4(new THREE.Matrix4().makeRotationZ(
                            THREE.MathUtils.degToRad(getTurretDeg()))
                            .setPosition(pvT.x, pvT.y, pvT.z));
                    }
                    return armorModel.localToWorld(pl);
                }
                return armorModel.localToWorld(pl);
            };
            const updSeg = function(visible: boolean): void {
                const p1 = placePt([hb[0], hb[2], hb[1]]);
                const p2 = placePt([hb[3], hb[5], hb[4]]);
                if (!p1 || !p2) {
                    window.__segRay = null;
                    window.__segBoxMissing = true;
                    window.__worldSegMk = null;
                    tc.tidyTrajectory();
                    if (window.__worldSegGroup) {
                        getScene().remove(window.__worldSegGroup);
                        window.__worldSegGroup = null;
                    }
                    showShotError('炮塔枢轴未安装（模型装配异常），射击复现已阻断');
                    return;
                }
                mkP1.position.copy(p1);
                mkP2.position.copy(p2);
                const chordL = new THREE.Vector3(
                    qc(hb[3], 0) - qc(hb[0], 0),
                    qc(hb[5], 1) - qc(hb[2], 1),
                    qc(hb[4], 2) - qc(hb[1], 2));
                let dirS: THREE.Vector3 | null = null;
                if (chordL.lengthSq() > 1e-9) {
                    let m: THREE.Matrix4 | null = null;
                    if (boxFrame === 'turret-pivot') {
                        const tm = findPartMesh(/^turret_\d+_armor/);
                        if (tm) { tm.updateWorldMatrix(true, false); m = tm.matrixWorld; }
                    } else if (boxFrame === 'gun-pivot') {
                        const gm = findPartMesh(/^gun_\d+_armor/);
                        if (gm) { gm.updateWorldMatrix(true, false); m = gm.matrixWorld; }
                    } else {
                        m = armorModel.matrixWorld;
                    }
                    if (m) dirS = chordL.clone().transformDirection(m).normalize();
                }
                if (!dirS) {
                    const e = (findPartMesh(/^turret_\d+_armor/) || armorModel).matrixWorld.elements;
                    const fh = Math.hypot(e[4], e[6]) || 1;
                    dirS = new THREE.Vector3(-e[4] / fh, 0, -e[6] / fh);
                }
                const EXT = 900;
                const aPt = mkP1.position.clone().addScaledVector(dirS, -EXT);
                const bPt = mkP2.position.clone();
                segLine.geometry.setFromPoints([aPt, bPt]);
                segLine.computeLineDistances();
                window.__segRay = {
                    origin: mkP1.position.clone().addScaledVector(dirS, -0.5),
                    dir: dirS, far: 26
                };
                if (window.__worldImpactMk) {
                    window.__worldImpactMk.position.copy(mkP1.position);
                    if (visible) {
                        dbgInfo('dbg-impact', '#ff2222', '弹着点',
                            fmt3(mkP1.position.x + cx, mkP1.position.y + cy, mkP1.position.z + cz)
                            + ' · DecodeShotSegment P1' + (sPart2 != null ? ' · 部件P' + sPart2 : ''));
                    }
                }
                if (visible) {
                    dbgInfo('dbg-seg', '#ffa500', 'DecodeShotSegment',
                        'P1 ' + fmt3(mkP1.position.x + cx, mkP1.position.y + cy, mkP1.position.z + cz) +
                        ' · P2 ' + fmt3(mkP2.position.x + cx, mkP2.position.y + cy, mkP2.position.z + cz) +
                        ' · 俯仰' + (THREE.MathUtils.radToDeg(Math.asin(
                            chordL.clone().normalize().z)).toFixed(2)) + '°（炮塔系）' +
                        ' · 客户端部件盒');
                }
            };
            window.__worldSegMk = { update: updSeg, p1: mkP1, p2: mkP2 };
            updSeg(!!window.__debugOn);
            window.__segDiag = {
                hb: hb, sPart: sPart2, partFallback: partFallback,
                boxFrame: boxFrame,
                boxMin: boxMin.slice(0, 3), boxMax: boxMax.slice(0, 3),
                armorModel: armorModel
            };
            setTimeout(function() {
                if (!currentShot()) return;
                if (!window.__worldSegMk) return;
                window.__worldSegMk.update(!!window.__debugOn);
                if (window.__worldImpactMk) {
                    const pp = window.__worldSegMk.p1.position;
                    window.__worldImpactMk.position.copy(pp);
                    dbgInfo('dbg-impact', '#ff2222', '弹着点',
                        fmt3(pp.x + cx, pp.y + cy, pp.z + cz) + ' · DecodeShotSegment P1'
                        + (sPart2 != null ? ' · 部件P' + sPart2 : ''));
                }
            }, 1500);
        } else if (!boxMissing) {
            window.__segBoxMissing = true;
            tc.tidyTrajectory();
            showShotError('炮塔枢轴未安装（模型装配异常），射击复现已阻断');
        } else {
            window.__segBoxMissing = true;
            tc.tidyTrajectory();
            showShotError('缺少客户端部件盒（part ' + sPart2 + '），射击复现已阻断');
        }
    }
}
