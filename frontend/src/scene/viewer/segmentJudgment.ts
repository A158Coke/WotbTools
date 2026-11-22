import * as THREE from 'three'
import type { ShotReplayAnnotationCtx } from './shotReplaySeg.js'
import type { TurretRigHandle } from './turretRig.js'
import type { TrajectoryCardHandle } from './trajectoryCard.js'
import type { TankData } from './viewerContracts.js'

/** Decode a client shot-segment coordinate from its 1/255 quantization. */
export function decodeB255(b: number, min: number, size: number): number {
    return min + size * (b / 255)
}

// DecodeShotSegment ray installation. The collision-box fail-closed contract is checked
// against this owner by tankViewer.collisionBoxFailsafe.test.js.
/** DecodeShotSegment 判定安装上下文（原闭包捕获面）。 */
export interface SegmentJudgmentCtx extends Pick<ShotReplayAnnotationCtx, 's' | 'cx' | 'cy' | 'cz' | 'armorModel' | 'getScene' | 'dbgInfo' | 'fmt3'> {
    getTankData(): TankData
    rig: TurretRigHandle
    tc: Pick<TrajectoryCardHandle, 'tidyTrajectory'>
    showShotError(msg: string): void
    currentShot(): boolean
    getTurretDeg(): number
    getGunDeg(): number
}

/** ④' DecodeShotSegment 出入点标注 + 判定射线。
 * hash6 = 游戏客户端 DecodeShotSegment 两点编码：服务器命中判定
 * 时刻的入点 P1/出点 P2，部件 AABB 1/255 量化，轴序 x右←b2/b5、
 * y前←b4/b7、z高←b3/b6（b4 恒 255 = 入点钉盒前界面）。
 * 盒源：game_data collision.*_bbox（客户端 Parameters YAML 的
 * 权威部件盒，x右/y前/z上）。盒缺失 → fail-closed，不从装甲网格
 * 自算 AABB；部件帧：hull/chassis=模型原点、turret/gun=枢轴系。
 * 判定射线 __segRay = {P1−0.5·方向, P1→P2 解码弦}：raycast 与
 * 入射角同源此射线（服务器编码的位置与弹向），世界系，随位姿联动。 */
export function installSegmentJudgment(ctx: SegmentJudgmentCtx): void {
    const { s, cx, cy, cz, armorModel, getScene, dbgInfo, fmt3 } = ctx;
    const { getTankData, rig, tc, showShotError, currentShot, getTurretDeg, getGunDeg } = ctx;
    window.__worldSegMk = null;
    window.__segRay = null;
    // 判定段线组：独立于调试标注层（非调试模式也常显）
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
        // part 0（底盘/履带）在装甲模型无网格——回退 hull 装甲网格近似
        // （解码盒仍取客户端 chassis 盒，不合成）
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
        // 只用客户端权威部件盒；缺失时不解码/不判定（fail-closed），
        // 不再按装甲网格 rest 顶点自算 AABB。
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
        // turret-pivot fallback 需要权威枢轴。状态装甲网格（如
        // turret_01_state_00_armor_11）不匹配普通炮塔板正则；枢轴缺失时
        // 无法重建世界帧 → fail-closed，不用模型系伪坐标生成判定证据。
        const turretPivotMissing = !boxMissing && boxFrame === 'turret-pivot'
            && !findPartMesh(/^turret_\d+_armor/) && !rig.getArmorPivotTurret();
        if (box && partNodes.length !== 0 && !turretPivotMissing) {
            const boxMin = box.min, boxMax = box.max;
            const szv = [boxMax[0] - boxMin[0], boxMax[1] - boxMin[1], boxMax[2] - boxMin[2]];
            // 客户端 DecodeShotSegment 用 255.0f（@0x364B110）：b=0→min、
            // b=255→max，两端都可表示；不能用 /256（max 面永远差一步）。
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
            // 量化三元组 [右,前,高] → 场景世界坐标。炮塔/炮管件经部件
            // 网格世界矩阵（局部系=枢轴系，矩阵由位姿链驱动 → 标记跟随
            // 转角；勿用 Rz(getTurretDeg()) 手动组合，初始位姿时它为 0）
            const placePt = function(q: number[]): THREE.Vector3 | null {
                const pl = new THREE.Vector3(qc(q[0], 0), qc(q[1], 1), qc(q[2], 2));
                if (boxFrame === 'turret-pivot') {
                    const tm = findPartMesh(/^turret_\d+_armor/);
                    if (tm) { tm.updateWorldMatrix(true, false); return tm.localToWorld(pl); }
                    // 无状态无关炮塔网格（如 turret_01_state_00_armor_11）时按
                    // 炮塔枢轴重建帧。枢轴缺失（装配异常）返回 null，由调用方
                    // fail-closed——不得用模型系伪坐标继续生成判定证据。
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
                // 出入点标记 + 段线（P1→P2 = 游戏编码命中线段）
                const p1 = placePt([hb[0], hb[2], hb[1]]);
                const p2 = placePt([hb[3], hb[5], hb[4]]);
                if (!p1 || !p2) {
                    // 位姿竞态导致枢轴丢失时同样 fail-closed：清掉标记/段线，
                    // 禁止以模型系坐标继续生成 __segRay 判定证据。
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
                // 判定方向 = P1→P2 解码弦（世界系），经 placePt 同款部件矩阵
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
                    // P1==P2（点射终止，§2.1）：回退炮塔/模型反水平方向
                    const e = (findPartMesh(/^turret_\d+_armor/) || armorModel).matrixWorld.elements;
                    const fh = Math.hypot(e[4], e[6]) || 1;
                    dirS = new THREE.Vector3(-e[4] / fh, 0, -e[6] / fh);
                }
                // 段线入射端"无限"延长（工程取 900m，相机远平面内）：
                // 沿判定弹向 dirS（世界系，与 __segRay 同源）的反向，
                // 入射弹向一目了然；P2（穿出端）与标记保持在解码出入点。
                // 勿用未变换的 chordL 方向——部件盒带姿态时外延会指向错误方向
                const EXT = 900;
                const aPt = mkP1.position.clone().addScaledVector(dirS, -EXT);
                const bPt = mkP2.position.clone();
                segLine.geometry.setFromPoints([aPt, bPt]);
                segLine.computeLineDistances();
                // 判定射线：P1 表面外 0.5m 沿弹向进入（raycast 与入射角同源）
                window.__segRay = {
                    origin: mkP1.position.clone().addScaledVector(dirS, -0.5),
                    dir: dirS, far: 26
                };
                // 弹着点红点 = P1（服务器编码真实入点）
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
            // 初始判定统一在本发姿态、选弹和面板安装完毕后执行。
            // 诊断挂钩：盒/量化字节（静止局部），供控制台校准轴序
            window.__segDiag = {
                hb: hb, sPart: sPart2, partFallback: partFallback,
                boxFrame: boxFrame,
                boxMin: boxMin.slice(0, 3), boxMax: boxMax.slice(0, 3),
                armorModel: armorModel
            };
            // debug=1 自动开启晚于本块——延迟补一次刷新（消除加载期位姿竞态残值）
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
