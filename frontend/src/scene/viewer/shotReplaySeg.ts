import * as THREE from 'three'
import { createScreenSpacePolyline } from './overlayStroke.js'
import { ANNOTATION_COLORS, cssHex } from './shotResultPalette.js'
import type { ReplayShot, Vec3 } from './viewerContracts.js'

export interface ShotReplayAnnotationCtx {
    s: ReplayShot
    cx: number
    cy: number
    cz: number
    armorModel: THREE.Object3D | null
    getScene(): THREE.Scene
    dbgInfo(id: string, color: string, name: string, text: string): void
    fmt3(x: number, y: number, z: number): string
}

export function installShooterMuzzleMarker(
    sModel: THREE.Object3D,
    breechGunLocal: THREE.Vector3 | null,
    ctx: Pick<ShotReplayAnnotationCtx, 'cx' | 'cy' | 'cz' | 'getScene' | 'dbgInfo' | 'fmt3'>,
): void {
    const { cx, cy, cz, getScene, dbgInfo, fmt3 } = ctx;
    try {
        if (breechGunLocal) {
            let gunNode: THREE.Object3D | null = null;
            sModel.traverse(function(n: THREE.Object3D) {
                if (!gunNode && /^gun_\d+$/.test(n.name || '')) gunNode = n;
            });
            if (gunNode) {
                window.__shooterGunNode = gunNode;
                window.__updateMuzzleMarker = function() {
                    const g = window.__shooterGunNode, mk = window.__shooterMuzzleMk;
                    if (!g || !mk) return;
                    g.updateMatrixWorld(true);
                    mk.position.copy(breechGunLocal.clone().applyMatrix4(g.matrixWorld));
                    const on = !!window.__debugOn;
                    mk.visible = on;
                    if (window.__shooterMuzzleLine && window.__launchPointMk) {
                        const lgeo = window.__shooterMuzzleLine.geometry;
                        lgeo.setFromPoints([mk.position, window.__launchPointMk.position]);
                        window.__shooterMuzzleLine.computeLineDistances();
                        window.__shooterMuzzleLine.visible = on;
                    }
                    dbgInfo('dbg-breech', cssHex(ANNOTATION_COLORS.breech), '炮闩',
                        fmt3(mk.position.x + cx, mk.position.y + cy, mk.position.z + cz));
                };
                const mk = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10),
                    new THREE.MeshBasicMaterial({ color: ANNOTATION_COLORS.breech, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false }));
                mk.renderOrder = 998;
                getScene().add(mk);
                window.__shooterMuzzleMk = mk;
                const dline = new THREE.Line(
                    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
                    new THREE.LineDashedMaterial({
                        color: ANNOTATION_COLORS.deviation, transparent: true, opacity: 0.8,
                        dashSize: 0.35, gapSize: 0.25, depthTest: false, toneMapped: false }));
                dline.renderOrder = 996;
                getScene().add(dline);
                window.__shooterMuzzleLine = dline;
                window.__updateMuzzleMarker();
                console.log('[world] shooter breech(gun-local) @', breechGunLocal.toArray().map(v => +v.toFixed(2)).join(','));
            }
        }
    } catch (e) { console.warn('[world] muzzle marker failed:', e); }
}

export function installAnchorMarkers(
    ctx: Pick<ShotReplayAnnotationCtx, 'cx' | 'cy' | 'cz' | 'getScene' | 'dbgInfo' | 'fmt3'>,
    tankModel: THREE.Object3D,
): void {
    const { cx, cy, cz, getScene, dbgInfo, fmt3 } = ctx;
    function makeAnchorMarker(colorCss: string): { mk: THREE.Mesh; color: string } {
        const mk = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(colorCss), transparent: true, opacity: 0.95, depthTest: false, toneMapped: false }));
        mk.renderOrder = 998;
        mk.visible = false;
        getScene().add(mk);
        return { mk: mk, color: colorCss };
    }
    window.__victimAnchor = makeAnchorMarker(cssHex(ANNOTATION_COLORS.victimAnchor));
    window.__shooterAnchor = makeAnchorMarker(cssHex(ANNOTATION_COLORS.shooterAnchor));
    window.__updateAnchorMarkers = function() {
        const on = !!window.__debugOn;
        const upd = function(a: { mk: THREE.Mesh; color: string } | null | undefined,
            model: THREE.Object3D | null | undefined, rowId: string, name: string): void {
            if (!a) return;
            if (!model) { a.mk.visible = false; return; }
            a.mk.position.copy(model.position);
            a.mk.visible = on;
            dbgInfo(rowId, a.color, name,
                fmt3(model.position.x + cx, model.position.y + cy, model.position.z + cz));
        };
        upd(window.__victimAnchor, tankModel, 'dbg-anchor-victim', '基准点·受击');
        upd(window.__shooterAnchor, window.__shooterModel, 'dbg-anchor-shooter', '基准点·射手');
    };
    window.__updateAnchorMarkers();
}

export interface TrajectoryCtxResult {
    ctxLaunch: THREE.Vector3 | null
    ctxLvDir: THREE.Vector3 | null
    ctxLvSpd: number
    ctxRayFar: number
}

export function buildTrajectoryAnnotation(
    ctx: Pick<ShotReplayAnnotationCtx, 's' | 'cx' | 'cy' | 'cz' | 'armorModel' | 'dbgInfo' | 'fmt3'>,
    ba: Vec3 | undefined,
    bb: Vec3 | undefined,
    showTrajAnno: boolean,
): TrajectoryCtxResult {
    const { s, cx, cy, cz, armorModel, dbgInfo, fmt3 } = ctx;
    let ctxLaunch: THREE.Vector3 | null = null;
    let ctxLvDir: THREE.Vector3 | null = null;
    let ctxLvSpd = 0, ctxRayFar = 100;
    if (ba && bb) {
        const chordLen = Math.sqrt(
            (bb[0]-ba[0])**2 + (bb[1]-ba[1])**2 + (bb[2]-ba[2])**2);
        const chordDir = new THREE.Vector3(
            (bb[0]-ba[0])/chordLen, (bb[1]-ba[1])/chordLen, (bb[2]-ba[2])/chordLen);
        ctxLvDir = chordDir;
        ctxRayFar = Math.max(chordLen * 1.1, 20);
        const trajLine = createScreenSpacePolyline([
            new THREE.Vector3(ba[0] - cx, ba[1] - cy, ba[2] - cz),
            new THREE.Vector3(bb[0] - cx, bb[1] - cy, bb[2] - cz),
        ], {
            color: ANNOTATION_COLORS.chord,
            widthPx: 2,
            haloWidthPx: 4,
            haloColor: 0x05070a,
            haloOpacity: 0.5,
            opacity: 0.95,
            renderOrder: 997,
        });
        if (trajLine) {
            trajLine.visible = showTrajAnno;
            window.__worldAnno!.add(trajLine);
        }
        const lpM = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10),
            new THREE.MeshBasicMaterial({ color: ANNOTATION_COLORS.launch, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false }));
        lpM.position.set(ba[0] - cx, ba[1] - cy, ba[2] - cz);
        lpM.renderOrder = 998;
        lpM.visible = showTrajAnno;
        window.__worldAnno!.add(lpM);
        window.__launchPointMk = lpM;
        const lv0 = s.launch_velocity || [0, 0, 0];
        const lvSpd = Math.sqrt(lv0[0]*lv0[0] + lv0[1]*lv0[1] + lv0[2]*lv0[2]);
        ctxLaunch = lpM.position.clone();
        ctxLvSpd = lvSpd;
        if (showTrajAnno) dbgInfo('dbg-launch', cssHex(ANNOTATION_COLORS.launch), '发射点',
            fmt3(ba[0], ba[1], ba[2]) + ' · ' + lvSpd.toFixed(0) + ' m/s');
        if (lvSpd > 1) {
            const dir = new THREE.Vector3(lv0[0], lv0[1], lv0[2]).normalize();
            const vl = createScreenSpacePolyline([
                lpM.position.clone(),
                lpM.position.clone().addScaledVector(dir, Math.max(chordLen * 1.3, 10)),
            ], {
                color: ANNOTATION_COLORS.velocity,
                widthPx: 1.5,
                haloWidthPx: 3,
                haloColor: 0x05070a,
                haloOpacity: 0.45,
                dashed: true,
                dashSize: 1.2,
                gapSize: 0.8,
                opacity: 0.9,
                renderOrder: 997,
            });
            if (vl) {
                vl.visible = showTrajAnno;
                window.__worldAnno!.add(vl);
            }
        }
        const eg = new THREE.SphereGeometry(0.15, 12, 10);
        const em = new THREE.MeshBasicMaterial({ color: ANNOTATION_COLORS.endpoint, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false });
        const emk = new THREE.Mesh(eg, em);
        emk.position.set(bb[0] - cx, bb[1] - cy, bb[2] - cz);
        emk.renderOrder = 998;
            emk.visible = showTrajAnno;
        window.__worldAnno!.add(emk);
            if (showTrajAnno) dbgInfo('dbg-end', cssHex(ANNOTATION_COLORS.endpoint), '服务器终点', fmt3(bb[0], bb[1], bb[2]));
        if (armorModel) {
            const sPart = (typeof s.server_part_index === 'number') ? s.server_part_index : null;
            const partOf = (o: THREE.Object3D): number => { const u = o.userData || {}; const sec = u.armorSectionOrig || u.armorSection;
                return sec === 'chassis' ? 0 : sec === 'hull' ? 1 : (sec === 'turret' || sec === 'gun') ? 2 : sec === 'gunBarrel' ? 3 : -1; };
            const rc2 = new THREE.Raycaster();
            rc2.set(lpM.position.clone(), chordDir);
            rc2.far = Math.max(chordLen * 1.1, 20);
            const allHits = rc2.intersectObject(armorModel, true)
                .filter(h => h.object.userData.armorSection !== 'deco');
            let iHits = allHits;
            let partConstrained = false;
            if (sPart != null) {
                const inPart = allHits.filter(h => partOf(h.object) === sPart);
                if (inPart.length) { iHits = inPart; partConstrained = true; }
            }
            if (iHits.length > 0) {
                const imk = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10),
                    new THREE.MeshBasicMaterial({ color: ANNOTATION_COLORS.impact, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false }));
                imk.position.copy(iHits[0].point);
                imk.renderOrder = 998;
                window.__worldAnno!.add(imk);
                window.__worldImpactMk = imk;
                dbgInfo('dbg-impact', cssHex(ANNOTATION_COLORS.impact), '弹着点',
                    fmt3(iHits[0].point.x + cx, iHits[0].point.y + cy, iHits[0].point.z + cz)
                    + (partConstrained ? ' · 部件P' + sPart : ''));
            } else {
                console.warn('[world] impact raycast: 0 hits（弹道未交装甲——几何/位姿错位）');
            }
        }
    }
    return { ctxLaunch, ctxLvDir, ctxLvSpd, ctxRayFar };
}

export function placeImpactCamera(
    ctx: Pick<ShotReplayAnnotationCtx, 'cx' | 'cy' | 'cz'> & {
        getCamera(): THREE.PerspectiveCamera
        getControls(): { target: THREE.Vector3; update(): void }
    },
    ba: Vec3 | undefined,
    bb: Vec3 | undefined,
    ctxLaunch: THREE.Vector3 | null,
    tPos: Vec3,
    shooterWorld: Vec3,
): void {
    const { cx, cy, cz, getCamera, getControls } = ctx;
    if (ba && bb && ctxLaunch) {
        const dirTraj = new THREE.Vector3(bb[0]-ba[0], 0, bb[2]-ba[2]);
        const lenH = dirTraj.length();
        if (lenH > 1) {
            dirTraj.divideScalar(lenH);
            const perp = new THREE.Vector3(-dirTraj.z, 0, dirTraj.x);
            getCamera().position.copy(ctxLaunch)
                .addScaledVector(perp, Math.max(lenH * 0.3, 6))
                .add(new THREE.Vector3(0, Math.max(lenH * 0.22, 4), 0));
        } else {
            getCamera().position.copy(ctxLaunch).add(new THREE.Vector3(0, 6, 8));
        }
        getControls().target.set((ba[0]+bb[0])/2 - cx, (ba[1]+bb[1])/2 - cy, (ba[2]+bb[2])/2 - cz);
    } else {
        const camDist = Math.max(20, Math.sqrt(
            (tPos[0]-shooterWorld[0])**2 + (tPos[2]-shooterWorld[2])**2) * 0.4);
        const aimYaw = Math.atan2(tPos[0]-shooterWorld[0], tPos[2]-shooterWorld[2]);
        getCamera().position.set(
            shooterWorld[0] - cx + Math.sin(aimYaw) * camDist * 0.3,
            shooterWorld[1] - cy + camDist * 0.3,
            shooterWorld[2] - cz + Math.cos(aimYaw) * camDist * 0.3
        );
        getControls().target.set(0, 1, 0);
    }
}
