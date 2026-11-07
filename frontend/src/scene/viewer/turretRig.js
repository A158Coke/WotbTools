// 炮塔/炮管姿态 rig（#820 Agent A 出仓）：视觉车体与装甲模型共用的枢轴/姿态矩阵
// 单一 owner。原 tankViewer.js 闭包内 collectConfigNodes / applyConfigVisible /
// collectTurretGunNodes / updateTurretGun / collectArmorNodes / collectArmorPrefixes /
// alignArmorModules 整体平移；装配语义与注释保持原样。
import * as THREE from 'three'
import {
    armorPivots, installArmorPivots,
    collectArmorPrefixes as scanArmorPrefixes,
} from './armorPlateModel.js'

/**
 * @param {object} deps 模型与配置的显式取值接口（由 composition root 注入）
 * @param {() => object|null} deps.getTankModel 视觉车体根节点
 * @param {() => object|null} deps.getArmorModel 装甲模型根节点
 * @param {() => object} deps.getTankData 目标坦克数据
 * @param {() => object|null} deps.getConfig 当前配置
 */
export function createTurretRig({ getTankModel, getArmorModel, getTankData, getConfig,
    updateCollisionWorldMatrices, getCollisionMode, computeGunClipPlane, syncModuleClipPlanes }) {
    let turretNode = null, gunNodesList = [];
    let gunBarrelNodes = [];   // 精确名 gun_XX = 炮管本体（随炮塔+俯仰）
    let origMatrices = null;
    let lastAppliedTurretDeg = 0, lastAppliedGunDeg = 0;
    let configGunGroups = [];
    let configTurretNodes = [];// all turret_0X root nodes (visual model), sorted by number
    let armorOrigMatrices = null;
    // 炮管/炮塔装甲前缀收集（原两函数各自全树 traverse，合并为一次遍历同时收集）。
    // 缓存到模块级：armorModel 未变时直接复用，applyArmorConfigVisible 与
    // collectArmorNodes 的重复遍历只发生一次
    let _armorPrefixCache = null;   // { gun: [...], turret: [...] }
    // 装甲旋转枢轴（alignArmorModules 按 models.pb 原点写入：track+turret / track+turret+gun）。
    // updateTurretGun 以此为炮塔/炮管的旋转中心（对齐 BlitzKit 旋转语义）。
    let armorPivotTurret = null, armorPivotGun = null;
    // 炮塔/炮管姿态矩阵（模型系，绕 models.pb 枢轴；与 gun 节点 matrix 同源）。
    // BlitzKit 把 gun_mask 裁切面定义在 gun 局部系、随姿态重算；这里复用同一姿态矩阵。
    const gunPoseMatrix = new THREE.Matrix4();
    // 炮塔/炮管姿态草稿（复用对象）：updateTurretGun 由 pointermove/滑块逐输入事件驱动，
    // 此前每次调用 new 6~8 个 Matrix4 + 每块装甲板 1~2 个 clone（数百板 × 60Hz 输入
    // = 纯 GC 压力）。草稿只在函数内同步消费，不跨调用持有。
    const _aimPivotT = new THREE.Vector3();
    const _aimPivotG = new THREE.Vector3();
    const _aimTurretRot = new THREE.Matrix4();
    const _aimItrEuler = new THREE.Euler();
    const _aimMTurret = new THREE.Matrix4();
    const _aimMGun = new THREE.Matrix4();
    const _aimMAT = new THREE.Matrix4();
    const _aimMAG = new THREE.Matrix4();
    const _aimMNode = new THREE.Matrix4();

    function collectConfigNodes(model) {
        configGunGroups = [];
        configTurretNodes = [];
        if (!model) return;
        const byGroup = new Map(); // groupNum -> nodes[]
        const turrets = [];
        model.traverse(function(n) {
            const nm = n.name || '';
            const gm = nm.match(/^gun_(\d+)/);
            const tm = nm.match(/^turret_(\d+)$/);
            if (gm) {
                const g = parseInt(gm[1], 10);
                if (!byGroup.has(g)) byGroup.set(g, []);
                byGroup.get(g).push(n);
            } else if (tm) {
                turrets.push(n);
            }
        });
        const keys = Array.from(byGroup.keys()).sort((a, b) => a - b);
        for (const k of keys) {
            const arr = byGroup.get(k).sort((a, b) => ((a.name||'') < (b.name||'') ? -1 : 1));
            configGunGroups.push(arr);
        }
        configTurretNodes = turrets.sort((a, b) => (a.name.match(/\d+/)?.[0]|0) - (b.name.match(/\d+/)?.[0]|0));
    }

    function applyConfigVisible(model, gi, ti) {
        if (!model) return;
        const gCount = Math.max(1, configGunGroups.length);
        const tCount = Math.max(1, configTurretNodes.length);
        configGunGroups.forEach((grp, i) => { grp.forEach(n => { n.visible = (i === (gi % gCount)); }); });
        configTurretNodes.forEach((n, i) => { n.visible = (i === (ti % tCount)); });
    }

    function collectTurretGunNodes() {
        // 固定战斗室车辆（歼击车）的 GLB 没有 turret_NN 实体，炮管组直接挂在车体上；
        // 只要存在炮管组就必须建立姿态表，横转由炮管组吃 mG = mT·Rx(gr)（与回放同一语义）。
        const tankModel = getTankModel();
        if (!tankModel || (!configTurretNodes.length && !configGunGroups.length)) return;
        const cfg = getConfig();
        turretNode = configTurretNodes.length
            ? configTurretNodes[cfg.turret_index % configTurretNodes.length] || null
            : null;
        if (configGunGroups.length) {
            const grp = configGunGroups[cfg.gun_index % configGunGroups.length];
            gunNodesList = grp || [];
        } else {
            gunNodesList = [];
        }
        // 游戏装配语义【用户实证】：炮盾（gun_XX_mask）**随炮管俯仰**（焊在炮管摇篮上），
        // 与炮管本体同链。group 内其余节点 = 状态拆件（hide_elements 等），不参与姿态。
        gunBarrelNodes = gunNodesList.filter(n => /^gun_\d+(_mask)?$/.test(n.name || ''));
        origMatrices = new Map();
        if (turretNode) {
            turretNode.updateMatrix();
            origMatrices.set(turretNode, turretNode.matrix.clone());
            turretNode.matrixAutoUpdate = false;
        }
        for (const gn of gunNodesList) {
            gn.updateMatrix();
            origMatrices.set(gn, gn.matrix.clone());
            gn.matrixAutoUpdate = false;
        }
    }

    function updateTurretGun(turretDeg, gunDeg) {
        const tankModel = getTankModel();
        if (!tankModel) return;
        if (!origMatrices) collectTurretGunNodes();
        if (!origMatrices) return;
        lastAppliedTurretDeg = turretDeg;
        lastAppliedGunDeg = gunDeg;

        // 旋转枢轴 = models.pb 原点链（alignArmorModules 写入：track+turret / track+turret+gun）
        const tPivot = armorPivotTurret ? _aimPivotT.copy(armorPivotTurret) : _aimPivotT.set(0, 0, 1.7);
        const gPivot = armorPivotGun ? _aimPivotG.copy(armorPivotGun) : _aimPivotG.set(0, 0, 2.0);

        const tr = THREE.MathUtils.degToRad(turretDeg);
        const gr = THREE.MathUtils.degToRad(gunDeg);

        const tankData = getTankData();
        const itr = getTankData().initial_turret_rotation;
        let turretRot = _aimTurretRot;
        if (itr) {
            turretRot.makeRotationFromEuler(_aimItrEuler.set(
                -THREE.MathUtils.degToRad(itr.pitch),
                -THREE.MathUtils.degToRad(itr.roll),
                tr - THREE.MathUtils.degToRad(itr.yaw),
                'XYZ'));
        } else {
            turretRot.makeRotationZ(tr);
        }
        const mTurret = _aimMTurret;
        mTurret.makeTranslation(tPivot.x, tPivot.y, tPivot.z);
        mTurret.multiply(turretRot);
        mTurret.multiply(_aimMNode.makeTranslation(-tPivot.x, -tPivot.y, -tPivot.z));

        const mGun = _aimMGun.copy(mTurret);
        mGun.multiply(_aimMNode.makeTranslation(gPivot.x, gPivot.y, gPivot.z));
        mGun.multiply(_aimMNode.makeRotationX(gr));
        mGun.multiply(_aimMNode.makeTranslation(-gPivot.x, -gPivot.y, -gPivot.z));
        // gun_mask 裁切面与 gun 节点共用同一姿态矩阵（BlitzKit 的 gun 局部系平面）
        gunPoseMatrix.copy(mGun);

        if (turretNode) {
            const orig = origMatrices.get(turretNode);
            turretNode.matrix.copy(_aimMNode.copy(mTurret).multiply(orig));
            turretNode.matrixWorldNeedsUpdate = true;
        }
        // 炮管本体 + 炮盾：炮塔旋转 × 俯仰（炮盾焊在炮管摇篮上，同链）
        const barrelNodes = gunBarrelNodes.length ? gunBarrelNodes : gunNodesList;
        for (const gn of barrelNodes) {
            const orig = origMatrices.get(gn);
            gn.matrix.copy(_aimMNode.copy(mGun).multiply(orig));
            gn.matrixWorldNeedsUpdate = true;
        }

        const armorModel = getArmorModel();
        if (armorModel) {
            if (!armorOrigMatrices) collectArmorNodes();
            if (armorOrigMatrices) {
                // 装甲侧与视觉侧同一枢轴（此前的 aTP/aGP 克隆与 tPivot/gPivot 逐值相等）
                const mAT = _aimMAT;
                mAT.makeTranslation(tPivot.x, tPivot.y, tPivot.z);
                // 与视觉炮塔同一旋转（含 initial_turret_rotation）——4 辆意大利固定战斗室 TD
                // 依赖 itr 定型，漏叠会让装甲板与外观炮塔差 3~6.5° 俯仰
                mAT.multiply(turretRot);
                mAT.multiply(_aimMNode.makeTranslation(-tPivot.x, -tPivot.y, -tPivot.z));

                const mAG = _aimMAG.copy(mAT);
                mAG.multiply(_aimMNode.makeTranslation(gPivot.x, gPivot.y, gPivot.z));
                mAG.multiply(_aimMNode.makeRotationX(gr));
                mAG.multiply(_aimMNode.makeTranslation(-gPivot.x, -gPivot.y, -gPivot.z));

                for (const [node, orig] of armorOrigMatrices) {
                    const name = node.name || '';
                    // 正则容忍动态装甲的 state_XX 段（gun_01_state_00_armor_11 等）——
                    // 否则状态炮盾走 mAT（仅炮塔旋转）漏掉炮管俯仰 mAG（review P2-3）
                    if (/^gun_\d+(?:_state_\d+)?_armor_/.test(name)) {
                        node.matrix.copy(_aimMNode.copy(mAG).multiply(orig));
                    } else {
                        node.matrix.copy(_aimMNode.copy(mAT).multiply(orig));
                    }
                    node.matrixWorldNeedsUpdate = true;
                }
            }
        }

        // 上面只写局部 matrix（matrixWorldNeedsUpdate）；世界矩阵要到下一帧 render 才传播。
        // 射击复现的首次取景（setImpactView）、弹着点标注与滑块重算都在同一任务内立即
        // raycast——不先传播就会按旧姿态（炮塔/炮管未转）求交：弦擦过炮管落空 → 取景
        // 回退车体原点，坦克整体出现在画面上半部；下一帧后再点「查看弹着点」才恢复。
        // 与 doPenetrationCheck 的首帧约定一致（判定前调用同一助手）。
        updateCollisionWorldMatrices();
        // 姿态变化后重算 gun_mask 裁切面（材质持有同一个 Plane 对象，原地更新即可；
        // 热力图路径每帧自算，这里补齐厚度视图的姿态驱动路径）。
        if (getCollisionMode()) { computeGunClipPlane(); syncModuleClipPlanes(); }
    }

    function collectArmorNodes() {
        const armorModel = getArmorModel();
        if (!armorModel) return;
        const cfg = getConfig();
        let gunPrefix = null, turretPrefix = null;
        if (cfg) {
            const pk = collectArmorPrefixes();
            const gunPk = pk.gun, turPk = pk.turret;
            if (gunPk.length) gunPrefix = gunPk[cfg.gun_index % gunPk.length];
            if (turPk.length) turretPrefix = turPk[cfg.turret_index % turPk.length];
        }
        armorOrigMatrices = new Map();
        armorModel.traverse(function(node) {
            if (!node.isMesh) return;
            const name = node.name || '';
            const gm = name.match(/^(gun_\d+)(?:_state_\d+)?_armor_/);
            const tm = name.match(/^(turret_\d+)(?:_state_\d+)?_armor_/);
            const isGun = gm && (!gunPrefix || gm[1] === gunPrefix);
            const isTurret = tm && (!turretPrefix || tm[1] === turretPrefix);
            if (isGun || isTurret) {
                node.updateMatrix();
                armorOrigMatrices.set(node, node.matrix.clone());
                node.matrixAutoUpdate = false;
            }
        });
    }

    function collectArmorPrefixes() {
        if (_armorPrefixCache) return _armorPrefixCache;
        const armorModel = getArmorModel();
        _armorPrefixCache = armorModel ? scanArmorPrefixes(armorModel) : { gun: [], turret: [] };
        return _armorPrefixCache;
    }

    // models.pb 权威原点装配（对齐 BlitzKit SpacedArmorScene 的 hull/turret/gunOrigin 分组）。
    function alignArmorModules() {
        const armorModel = getArmorModel();
        const tankModel = getTankModel();
        if (!armorModel || !tankModel) return;
        armorModel.position.copy(tankModel.position);
        armorModel.updateMatrixWorld(true);
        tankModel.updateMatrixWorld(true);

        const pivots = armorPivots(getTankData(), getConfig());
        if (!pivots) return;
        armorPivotTurret = pivots.turret.clone();
        armorPivotGun = pivots.gun.clone();
        installArmorPivots(armorModel, pivots);
        armorModel.updateMatrixWorld(true);
    }

    return {
        collectConfigNodes,
        applyConfigVisible,
        collectTurretGunNodes,
        collectArmorNodes,
        collectArmorPrefixes,
        updateTurretGun,
        alignArmorModules,
        /** 配置/模型重建后失效姿态表（applyConfig 语义：下次 updateTurretGun 重新收集）。 */
        invalidatePoseCaches() {
            origMatrices = null;
            armorOrigMatrices = null;
        },
        /** 模型卸载（clearModels）：全部节点引用与姿态表复位。 */
        reset() {
            turretNode = null; gunNodesList = [];
            gunBarrelNodes = [];
            configGunGroups = []; configTurretNodes = [];
            origMatrices = null; armorOrigMatrices = null;
            _armorPrefixCache = null;
        },
        /** 装甲模型重建后前缀缓存失效（clearModels / armor 回调）。 */
        invalidatePrefixCache() { _armorPrefixCache = null; },
        getLastAppliedTurretDeg: () => lastAppliedTurretDeg,
        getLastAppliedGunDeg: () => lastAppliedGunDeg,
        getTurretNode: () => turretNode,
        getConfigGunGroups: () => configGunGroups,
        getGunBarrelNodes: () => gunBarrelNodes,
        getGunNodesList: () => gunNodesList,
        getArmorOrigMatrices: () => armorOrigMatrices,
        getArmorPivotTurret: () => armorPivotTurret,
        getArmorPivotGun: () => armorPivotGun,
        gunPoseMatrix,
    };
}
