// 射击复现（world 模式）射手模型摆位与加载工厂（#820 Agent A 出仓后的二次拆分）：
// poseShooterTurretGun / loadShooterModel 自 runShotReplay 闭包原样平移；
// 回放语义、镜像约定与 bake 时序保持原样（此文件只做搬运，不改数值行为）。
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { neutralizeDefaultMetalness } from '../glbRig.js'
import { poseFromYPR } from '../glbRig.js'
import { fetchTankData, assetProvider } from '../agentData.js'
import type { TankData, Vec3 } from './viewerContracts.js'
import type { ModelLifecycleHandle } from './modelLifecycle.js'

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

/** loadShooterModel 工厂闭包外的依赖面（runShotReplay 注入，语义与原闭包捕获一致）。 */
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

/** 射手模型加载工厂（原命中/脱靶两分支大段重复：并行 fetch /api/tank +
 * GLTFLoader 加载 → applyPose 摆位 → 炮闩 bake 前捕获 → 半透明材质克隆
 * → getScene().add）。resolve({ sd, sModel, breechGunLocal })；GLB 加载失败
 * resolve(null)。分支差异参数化：logTag（日志前缀）、castShadow
 * （命中分支网格投影阴影，脱靶分支不投影）、applyPose（各自位姿闭包）。
 * applyPose 必须在炮闩捕获前调用——breechGunLocal 依赖模型当前世界矩阵。 */
export function createShooterModelFactory(deps: ShooterModelFactoryDeps):
    (tid: number, opts?: LoadShooterModelOptions) => Promise<LoadedShooterModel | null> {
    const { getTankData, getShooterData, getSelectedShell, ml, getScene } = deps;
    const cloneMaterial = (m: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] =>
        Array.isArray(m) ? m.map((x) => x.clone()) : m.clone();
    return function loadShooterModel(tid: number, opts?: LoadShooterModelOptions): Promise<LoadedShooterModel | null> {
        const castShadow = !!(opts && opts.castShadow);
        const logTag = (opts && opts.logTag) || '[world]';
        // URL 前缀跟随目标模型（Web 服务挂 /armor_view/glb/...，独立 viewer 挂 /glb/...，
        // 硬编码 /glb/ 在 Web 下 404）；/api/tank 不手动拼前缀——viewer_index_html
        // 已对字面量 '/api/ 加前缀，手动拼会双重前缀 404。
        const shooterGlbUrl = assetProvider.url(getTankData().visual_model_url.replace(/\/glb\/\d+\//, '/glb/' + tid + '/'));
        // 目标重试会恢复射手模型；同一射手的车辆 JSON 已随弹药加载，直接复用。
        // 射手正在切换或本发属于另一辆车时，仍按本发车型独立获取。
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
            if (!deps.currentShot()) { ml.disposeDetachedModel(sModel); return null; }
            if (!sModel) { console.warn(logTag + ' shooter model load failed'); return null; }
            sModel.scale.setScalar(1);
            // hide_elements 拆件全部渲染（与视觉模型同规则；随父节点姿态自动跟随）
            if (opts && opts.applyPose) opts.applyPose(sModel);
            // 炮闩 gun 局部坐标——必须在炮塔/炮管 bake【之前】捕获：
            // bake 会改写 gun 节点矩阵（绕枢轴偏航/俯仰），之后无法从模型系反推。
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
                    // 炮闩标注 = 炮管枢轴 gP(models.pb 原点链)本身，不用碰撞 YAML 后伸量修正
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
            // 必须在材质 clone 之后：幽灵车与目标车同规则（老式车金属度归零）
            neutralizeDefaultMetalness(sModel);
            sModel.updateMatrixWorld(true);
            getScene().add(sModel);
            return { sd, sModel, breechGunLocal };
        });
    };
}
