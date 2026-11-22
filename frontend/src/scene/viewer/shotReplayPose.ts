// 射击复现（world 模式）射手模型摆位与加载工厂（#820 Agent A 出仓后的二次拆分）：
// poseShooterTurretGun / loadShooterModel 自 runShotReplay 闭包原样平移；
// 回放语义、镜像约定与 bake 时序保持原样（此文件只做搬运，不改数值行为）。
import * as THREE from 'three'
import { poseFromYPR } from '../glbRig.js'
import type { TankData, Vec3 } from './viewerContracts.js'

/** poseShooterTurretGun 闭包外的唯一依赖面（type10 原始欧拉 → 场景四元数共用 rig 工具）。 */
export { poseFromYPR }

/**
 * 射手炮塔/炮管姿态（回放原始数据）：炮塔 = type7 prop2 绝对朝向 − 模型偏航；
 * 炮管俯仰 = launch_velocity 垂直分量反解（prop9 实测与真实弹道无关，弃用）。
 * cfgIdx = 射手实际搭载配置下标（build_configs 数组序，回放数据注入）；
 * 多配置坦克按其选炮塔/主炮变体（applyConfigVisible 同式），null = 默认顶级
 */
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
    // cfgIdx = configs 数组下标；越界/缺失 → 顶级（末位）
    const cfgArr = sd.configs || null;
    const nCfg = (cfgArr && cfgArr.length) || 1;
    const cfgSel = (typeof cfgIdx === 'number' && Number.isInteger(cfgIdx) && cfgIdx >= 0 && cfgIdx < nCfg)
        ? cfgIdx : nCfg - 1;
    const selCfg = cfgArr ? cfgArr[cfgSel] : null;
    const selTi = selCfg ? (selCfg.turret_index ?? 0) : 0;
    const selGi = selCfg ? (selCfg.gun_index ?? 0) : 0;
    // 未选变体隐藏（含子树）；选中的炮塔/主炮参与摆位
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
    // 炮塔相对角：优先用显式 rel（镜像系 = −rel；避免"判定层绝对角 −
    // 渲染层 hull yaw"往返在移动转向时混入转向率×滤波延迟的角度误差）；
    // 未提供时退回绝对角相减（旧路径）
    const tr = (turretRelOverride != null) ? turretRelOverride : ((turretAbsYaw ?? 0) - hullYawS);
    // lv → 射手车体系：undo 完整车体姿态（yaw/pitch/roll）。仅 undo 偏航时
    // 坡地射击会带上车体俯仰的假俯仰（shot3 T110 实测渲染 +6.5°、真值 −0.1°）。
    // 注意 poseFromYPR 含 qFrame（z-up→y-up 帧变换），其逆作用得到的是帧前
    // 中间系，还需转回 glb 车体系（+Y 前/+Z 上）；等价做法：仰角 = asin(lv·upWorld/|lv|)。
    let gr = 0;
    if (gunPitchRad != null) {
        // 回放时序驱动（与客户端一致）：炮管俯仰 = type=10 pitch 时序插值
        gr = gunPitchRad;
    } else if (lv) {
        const qH = poseFromYPR(hullYawS, hullPitchS || 0, hullRollS || 0);
        const llv = Math.hypot(lv[0], lv[1], lv[2]);
        if (llv > 0.1) {
            // 炮管运动学：模型系炮管方向 = Rz(炮塔rel)·Rx(俯仰)·(0,1,0)。
            // 反解：①世界→车体(qH⁻¹)消地形俯仰/侧倾 → ②车体→炮塔系(Rz(−rel))消
            // 水平偏航 → ③仰角 = atan2(z, y)。未消炮塔偏航时 roll 混入俯仰
            // (GB109 shot2:炮塔 rel −67°,解出 +22.8°,真值 +9.5°,差 13°)。
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
    // 首次调用缓存各节点烘焙矩阵；后续调用基于烘焙矩阵重摆
    //（幂等——否则滑块每次输入都会累乘旋转，炮塔越转越乱）
    if (!turretNode.userData.__poseBaked) {
        turretNode.userData.__poseBaked = turretNode.matrix.clone();
        for (const gn of gunNodes) {
            gn.userData.__poseBaked = gn.matrix.clone();
            // 必须关自动合成：否则 updateMatrixWorld 用未修改的
            // quaternion 重写 matrix，炮管姿态被静默丢弃（渲染在车体正前向）
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
