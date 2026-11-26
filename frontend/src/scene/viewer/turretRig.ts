import * as THREE from 'three'
import {
    armorPivots, installArmorPivots,
    collectArmorPrefixes as scanArmorPrefixes,
} from './armorPlateModel.js'
import type { TankArmorConfig } from './armorPlateModel.js'
import type { TankData } from './viewerContracts.js'

export interface TurretRigDeps {
    getTankModel: () => THREE.Object3D | null
    getArmorModel: () => THREE.Object3D | null
    getTankData: () => TankData
    getConfig: () => TankArmorConfig | null
    updateCollisionWorldMatrices: () => void
    getCollisionMode: () => boolean
    computeGunClipPlane: () => void
    syncModuleClipPlanes: () => void
    invalidateRicochetPose?: () => void
}

export interface TurretRigHandle {
    collectConfigNodes(model: THREE.Object3D | null): void
    applyConfigVisible(model: THREE.Object3D | null, gi: number, ti: number): void
    collectTurretGunNodes(): void
    collectArmorNodes(): void
    collectArmorPrefixes(): { gun: string[]; turret: string[] }
    updateTurretGun(turretDeg: number, gunDeg: number): void
    alignArmorModules(): void
    invalidatePoseCaches(): void
    reset(): void
    invalidatePrefixCache(): void
    getLastAppliedTurretDeg(): number
    getLastAppliedGunDeg(): number
    getTurretNode(): THREE.Object3D | null
    getConfigGunGroups(): THREE.Object3D[][]
    getGunBarrelNodes(): THREE.Object3D[]
    getGunNodesList(): THREE.Object3D[]
    getArmorOrigMatrices(): Map<THREE.Object3D, THREE.Matrix4> | null
    getArmorPivotTurret(): THREE.Vector3 | null
    getArmorPivotGun(): THREE.Vector3 | null
    gunPoseMatrix: THREE.Matrix4
}

export function createTurretRig({ getTankModel, getArmorModel, getTankData, getConfig,
    updateCollisionWorldMatrices, getCollisionMode, computeGunClipPlane, syncModuleClipPlanes,
    invalidateRicochetPose }: TurretRigDeps): TurretRigHandle {
    let turretNode: THREE.Object3D | null = null, gunNodesList: THREE.Object3D[] = [];
    let gunBarrelNodes: THREE.Object3D[] = [];
    let origMatrices: Map<THREE.Object3D, THREE.Matrix4> | null = null;
    let lastAppliedTurretDeg = 0, lastAppliedGunDeg = 0;
    let configGunGroups: THREE.Object3D[][] = [];
    let configTurretNodes: THREE.Object3D[] = [];
    let armorOrigMatrices: Map<THREE.Object3D, THREE.Matrix4> | null = null;
    let _armorPrefixCache: { gun: string[]; turret: string[] } | null = null;
    let armorPivotTurret: THREE.Vector3 | null = null, armorPivotGun: THREE.Vector3 | null = null;
    const gunPoseMatrix = new THREE.Matrix4();
    const _aimPivotT = new THREE.Vector3();
    const _aimPivotG = new THREE.Vector3();
    const _aimTurretRot = new THREE.Matrix4();
    const _aimItrEuler = new THREE.Euler();
    const _aimMTurret = new THREE.Matrix4();
    const _aimMGun = new THREE.Matrix4();
    const _aimMAT = new THREE.Matrix4();
    const _aimMAG = new THREE.Matrix4();
    const _aimMNode = new THREE.Matrix4();

    function collectConfigNodes(model: THREE.Object3D | null): void {
        configGunGroups = [];
        configTurretNodes = [];
        if (!model) return;
        const byGroup = new Map<number, THREE.Object3D[]>();
        const turrets: THREE.Object3D[] = [];
        model.traverse(function(n: THREE.Object3D) {
            const nm = n.name || '';
            const gm = nm.match(/^gun_(\d+)/);
            const tm = nm.match(/^turret_(\d+)$/);
            if (gm) {
                const g = parseInt(gm[1], 10);
                if (!byGroup.has(g)) byGroup.set(g, []);
                byGroup.get(g)!.push(n);
            } else if (tm) {
                turrets.push(n);
            }
        });
        const keys = Array.from(byGroup.keys()).sort((a, b) => a - b);
        for (const k of keys) {
            const arr = byGroup.get(k)!.sort((a, b) => ((a.name||'') < (b.name||'') ? -1 : 1));
            configGunGroups.push(arr);
        }
        configTurretNodes = turrets.sort((a, b) => Number(a.name.match(/\d+/)?.[0] ?? 0) - Number(b.name.match(/\d+/)?.[0] ?? 0));
    }

    function applyConfigVisible(model: THREE.Object3D | null, gi: number, ti: number): void {
        if (!model) return;
        const gCount = Math.max(1, configGunGroups.length);
        const tCount = Math.max(1, configTurretNodes.length);
        configGunGroups.forEach((grp, i) => { grp.forEach(n => { n.visible = (i === (gi % gCount)); }); });
        configTurretNodes.forEach((n, i) => { n.visible = (i === (ti % tCount)); });
    }

    function collectTurretGunNodes(): void {
        const tankModel = getTankModel();
        if (!tankModel || (!configTurretNodes.length && !configGunGroups.length)) return;
        const cfg = getConfig()!;
        turretNode = configTurretNodes.length
            ? configTurretNodes[cfg.turret_index! % configTurretNodes.length] || null
            : null;
        if (configGunGroups.length) {
            const grp = configGunGroups[cfg.gun_index! % configGunGroups.length];
            gunNodesList = grp || [];
        } else {
            gunNodesList = [];
        }
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

    function updateTurretGun(turretDeg: number, gunDeg: number): void {
        const tankModel = getTankModel();
        if (!tankModel) return;
        if (!origMatrices) collectTurretGunNodes();
        if (!origMatrices) return;
        lastAppliedTurretDeg = turretDeg;
        lastAppliedGunDeg = gunDeg;

        const tPivot = armorPivotTurret ? _aimPivotT.copy(armorPivotTurret) : _aimPivotT.set(0, 0, 1.7);
        const gPivot = armorPivotGun ? _aimPivotG.copy(armorPivotGun) : _aimPivotG.set(0, 0, 2.0);

        const tr = THREE.MathUtils.degToRad(turretDeg);
        const gr = THREE.MathUtils.degToRad(gunDeg);

        const tankData = getTankData();
        const itr = tankData.initial_turret_rotation;
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
        gunPoseMatrix.copy(mGun);

        if (turretNode) {
            const orig = origMatrices.get(turretNode)!;
            turretNode.matrix.copy(_aimMNode.copy(mTurret).multiply(orig));
            turretNode.matrixWorldNeedsUpdate = true;
        }
        const barrelNodes = gunBarrelNodes.length ? gunBarrelNodes : gunNodesList;
        for (const gn of barrelNodes) {
            const orig = origMatrices.get(gn)!;
            gn.matrix.copy(_aimMNode.copy(mGun).multiply(orig));
            gn.matrixWorldNeedsUpdate = true;
        }

        const armorModel = getArmorModel();
        if (armorModel) {
            if (!armorOrigMatrices) collectArmorNodes();
            if (armorOrigMatrices) {
                const mAT = _aimMAT;
                mAT.makeTranslation(tPivot.x, tPivot.y, tPivot.z);
                mAT.multiply(turretRot);
                mAT.multiply(_aimMNode.makeTranslation(-tPivot.x, -tPivot.y, -tPivot.z));

                const mAG = _aimMAG.copy(mAT);
                mAG.multiply(_aimMNode.makeTranslation(gPivot.x, gPivot.y, gPivot.z));
                mAG.multiply(_aimMNode.makeRotationX(gr));
                mAG.multiply(_aimMNode.makeTranslation(-gPivot.x, -gPivot.y, -gPivot.z));

                for (const [node, orig] of armorOrigMatrices) {
                    const name = node.name || '';
                    if (/^gun_\d+(?:_state_\d+)?_armor_/.test(name)) {
                        node.matrix.copy(_aimMNode.copy(mAG).multiply(orig));
                    } else {
                        node.matrix.copy(_aimMNode.copy(mAT).multiply(orig));
                    }
                    node.matrixWorldNeedsUpdate = true;
                }
            }
        }

        updateCollisionWorldMatrices();
        if (invalidateRicochetPose) invalidateRicochetPose();
        if (getCollisionMode()) { computeGunClipPlane(); syncModuleClipPlanes(); }
    }

    function collectArmorNodes(): void {
        const armorModel = getArmorModel();
        if (!armorModel) return;
        const cfg = getConfig();
        let gunPrefix: string | null = null, turretPrefix: string | null = null;
        if (cfg) {
            const pk = collectArmorPrefixes();
            const gunPk = pk.gun, turPk = pk.turret;
            if (gunPk.length) gunPrefix = gunPk[cfg.gun_index! % gunPk.length];
            if (turPk.length) turretPrefix = turPk[cfg.turret_index! % turPk.length];
        }
        armorOrigMatrices = new Map();
        armorModel.traverse(function(node: THREE.Object3D) {
            const mesh = node as THREE.Mesh;
            if (!mesh.isMesh) return;
            const name = mesh.name || '';
            const gm = name.match(/^(gun_\d+)(?:_state_\d+)?_armor_/);
            const tm = name.match(/^(turret_\d+)(?:_state_\d+)?_armor_/);
            const isGun = gm && (!gunPrefix || gm[1] === gunPrefix);
            const isTurret = tm && (!turretPrefix || tm[1] === turretPrefix);
            if (isGun || isTurret) {
                mesh.updateMatrix();
                armorOrigMatrices!.set(mesh, mesh.matrix.clone());
                mesh.matrixAutoUpdate = false;
            }
        });
    }

    function collectArmorPrefixes(): { gun: string[]; turret: string[] } {
        if (_armorPrefixCache) return _armorPrefixCache;
        const armorModel = getArmorModel();
        _armorPrefixCache = armorModel ? scanArmorPrefixes(armorModel) : { gun: [], turret: [] };
        return _armorPrefixCache;
    }

    function alignArmorModules(): void {
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
        invalidatePoseCaches() {
            origMatrices = null;
            armorOrigMatrices = null;
        },
        reset() {
            turretNode = null; gunNodesList = [];
            gunBarrelNodes = [];
            configGunGroups = []; configTurretNodes = [];
            origMatrices = null; armorOrigMatrices = null;
            _armorPrefixCache = null;
        },
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
