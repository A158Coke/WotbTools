import * as THREE from 'three'
import { poseFromYPR } from '../glbRig.js'
import type { TankData, Vec3 } from './viewerContracts.js'

export { poseFromYPR }

export function poseShooterTurretGun(sModel: THREE.Object3D | null, sd: TankData | null,
    turretAbsYaw: number | null | undefined, lv: Vec3 | null | undefined,
    hullYawS: number, hullPitchS: number, hullRollS: number,
    gunPitchRad: number | null, turretRelOverride: number | null,
    cfgIdx: number | null | undefined): void {
    if (!sModel || !sd) return;
    const turrets: THREE.Object3D[] = [];
    const gunGroups = new Map<number, THREE.Object3D[]>();
    sModel.traverse(function(n: THREE.Object3D) {
        const nm = n.name || '';
        const gm = nm.match(/^gun_(\d+)/);
        const tm = nm.match(/^turret_(\d+)$/);
        if (gm) {
            const g = parseInt(gm[1], 10);
            const group = gunGroups.get(g);
            if (group) group.push(n); else gunGroups.set(g, [n]);
        } else if (tm) turrets.push(n);
    });
    turrets.sort(function(a, b) {
        const ai = parseInt((a.name.match(/\d+/) || ['0'])[0], 10);
        const bi = parseInt((b.name.match(/\d+/) || ['0'])[0], 10);
        return ai - bi;
    });
    const gKeys = Array.from(gunGroups.keys()).sort(function(a, b) { return a - b; });
    const cfgArr = sd.configs || null;
    const nCfg = (cfgArr && cfgArr.length) || 1;
    const cfgSel = (typeof cfgIdx === 'number' && Number.isInteger(cfgIdx) && cfgIdx >= 0 && cfgIdx < nCfg)
        ? cfgIdx : nCfg - 1;
    const selCfg = cfgArr ? cfgArr[cfgSel] : null;
    const selTi = selCfg ? (selCfg.turret_index ?? 0) : 0;
    const selGi = selCfg ? (selCfg.gun_index ?? 0) : 0;
    turrets.forEach(function(n: THREE.Object3D, i: number) { n.visible = (i === (selTi % turrets.length)); });
    gKeys.forEach(function(k: number, i: number) {
        (gunGroups.get(k) || []).forEach(function(n: THREE.Object3D) { n.visible = (i === (selGi % gKeys.length)); });
    });
    const turretNode: THREE.Object3D | null = turrets.length ? turrets[selTi % turrets.length] : null;
    const gunNodes: THREE.Object3D[] = gKeys.length ? (gunGroups.get(gKeys[selGi % gKeys.length]) || []) : [];
    const mo = sd.model_origins;
    if (!turretNode || !(mo && mo.track && mo.turret)) {
        console.warn('[world] shooter turret/gun pose skipped:',
            !turretNode ? 'no turret node' : 'no model_origins');
        return;
    }
    const cfg = selCfg;
    const tP: number[] = [mo.track[0]+mo.turret[0], mo.track[1]+mo.turret[1], mo.track[2]+mo.turret[2]];
    let gP: number[] = tP.slice();
    if (cfg && cfg.gun_origin) gP = [tP[0]+cfg.gun_origin[0], tP[1]+cfg.gun_origin[1], tP[2]+cfg.gun_origin[2]];
    const tr = (turretRelOverride != null) ? turretRelOverride : ((turretAbsYaw ?? 0) - hullYawS);
    let gr = 0;
    if (gunPitchRad != null) {
        gr = gunPitchRad;
    } else if (lv) {
        const qH = poseFromYPR(hullYawS, hullPitchS || 0, hullRollS || 0);
        const llv = Math.hypot(lv[0], lv[1], lv[2]);
        if (llv > 0.1) {
            const lvB = new THREE.Vector3(lv[0], lv[1], lv[2]).applyQuaternion(qH.clone().invert());
            const cT = Math.cos(tr), sT = Math.sin(tr);
            const lvT = new THREE.Vector3(
                lvB.x*cT + lvB.y*sT, -lvB.x*sT + lvB.y*cT, lvB.z);
            gr = Math.atan2(lvT.z, lvT.y);
        }
    }
    let turretRot = new THREE.Matrix4().makeRotationZ(tr);
    const itr = sd.initial_turret_rotation;
    if (itr) {
        turretRot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
            -THREE.MathUtils.degToRad(itr.pitch), -THREE.MathUtils.degToRad(itr.roll),
            tr - THREE.MathUtils.degToRad(itr.yaw), 'XYZ'));
    }
    const mT = new THREE.Matrix4().makeTranslation(tP[0], tP[1], tP[2]).multiply(turretRot)
        .multiply(new THREE.Matrix4().makeTranslation(-tP[0], -tP[1], -tP[2]));
    const mG = mT.clone().multiply(new THREE.Matrix4().makeTranslation(gP[0], gP[1], gP[2]))
        .multiply(new THREE.Matrix4().makeRotationX(gr))
        .multiply(new THREE.Matrix4().makeTranslation(-gP[0], -gP[1], -gP[2]));
    turretNode.updateMatrix(); turretNode.matrixAutoUpdate = false;
    if (!turretNode.userData.__poseBaked) {
        turretNode.userData.__poseBaked = turretNode.matrix.clone();
        for (const gn of gunNodes) {
            gn.userData.__poseBaked = gn.matrix.clone();
            gn.matrixAutoUpdate = false;
        }
    }
    turretNode.matrix.copy(mT.clone().multiply(turretNode.userData.__poseBaked));
    for (const gn of gunNodes) {
        gn.matrix.copy(mG.clone().multiply(gn.userData.__poseBaked));
    }
    sModel.updateMatrixWorld(true);
    console.log('[world] shooter turret/gun posed: turretRel=' +
        (-((turretAbsYaw ?? 0) - hullYawS) * 180 / Math.PI).toFixed(1) + '° gunPitch=' +
        (gr * 180 / Math.PI).toFixed(1) + '° gunNodes=' + gunNodes.length);
}
