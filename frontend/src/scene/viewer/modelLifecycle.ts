import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { neutralizeDefaultMetalness, dropDuplicateGunMasks } from '../glbRig.js'
import { assetProvider } from '../agentData.js'
import {
    useFaceNormals,
    tagArmorPlates as tagArmorPlateNodes, tagModuleMeshes as tagModuleNodes,
    retagSpacedSections as retagSpacedPlates,
} from './armorPlateModel.js'
import { replaceArmorMaterial } from './armorMeshState.js'
import { disposeHitMarker } from './overlayStroke.js'

import type { TankArmorConfig } from './armorPlateModel.js'
import type { TankData } from './viewerContracts.js'

export interface ModelProgress {
    reset(): void
    expect(key: string): void
    update(key: string, loaded: number, total: number): void
    complete(key: string): void
    snapshot(): { done: number; total: number }
}

export interface LoadGeneration {
    get(): number
    bump(): number
}

export interface ModelLifecycleDeps {
    rig: {
        collectConfigNodes(model: THREE.Object3D): void
        alignArmorModules(): void
        invalidatePrefixCache(): void
        reset(): void
    }
    isDestroyed: () => boolean
    isContextLost: () => boolean
    loadGen: LoadGeneration
    modelProgress: ModelProgress
    reportLoad: (state: { state: string; progress?: number; message?: string }) => void
    errorMessage: (error: unknown) => string
    L_loading: string
    loadFailed: (phase: string, msg: string) => string
    getTankData: () => TankData
    getCurrentConfigIdx: () => number
    getScene: () => THREE.Scene
    getControls: () => { target: THREE.Vector3; update(): void } | null
    getFxScene: () => THREE.Scene
    getQP: () => URLSearchParams
    getPlateThickness: (section: string, plateId: string) => number | null
    getCurrentConfig: () => TankArmorConfig | null
    applyConfig: (configIdx: number) => void
    applyArmorStateToModel: () => void
    applyUrlOptionsOnce: () => void
    clearTrajectory: () => void
    clearHeBlast: () => void
    disposePenetrationResources: () => void
    clearHighlight: () => void
    releaseModuleMaterialCaches: () => void
}

export interface ModelReferences {
    tankModel: THREE.Group | null
    armorModel: THREE.Group | null
}

export interface ModelLifecycleHandle {
    models: ModelReferences
    loadModels(): void
    clearModels(): void
    disposeDetachedModel(root: THREE.Object3D | null | undefined): void
    syncTransforms(): void
    applyModelTransforms(model: THREE.Object3D): void
    tagArmorPlates(model: THREE.Object3D): void
    tagModuleMeshes(model: THREE.Object3D): void
    retagSpacedSections(model?: THREE.Object3D | null): void
    refreshConfigArmorThickness(): void
    getModuleMeshes(): THREE.Object3D[]
    setModuleMeshes(list: THREE.Object3D[]): void
    getWorldMetersPerUnit(): number
    getModelMaxDim(): number
    setArmorModelResolver(fn: () => THREE.Object3D | null): void
}

export function createModelLifecycle(deps: ModelLifecycleDeps): ModelLifecycleHandle {
    const {
        rig, isDestroyed, isContextLost, loadGen, modelProgress, reportLoad,
        errorMessage, L_loading, loadFailed, getTankData, getCurrentConfigIdx,
        getScene, getControls, getFxScene, getQP, getPlateThickness, getCurrentConfig,
        applyConfig, applyArmorStateToModel, applyUrlOptionsOnce,
        clearTrajectory, clearHeBlast, disposePenetrationResources, clearHighlight,
        releaseModuleMaterialCaches,
    } = deps

    const models: ModelReferences = { tankModel: null, armorModel: null }
    let moduleMeshes: THREE.Object3D[] = [];
    let worldMetersPerUnit = 1;
    let modelMaxDim = 6;
    let _retagArmorModel: (() => THREE.Object3D | null) | null = null;

    function retagSpacedSections(model?: THREE.Object3D | null): void {
        const root = model || (_retagArmorModel ? _retagArmorModel() : null);
        const tankData = getTankData();
        if (!root || !tankData) return;
        retagSpacedPlates(root, tankData, getCurrentConfig());
    }

    function refreshConfigArmorThickness(): void {
        const gunBarrelThickness = getPlateThickness('gunBarrel', 'gun');
        moduleMeshes.forEach(function(node) {
            if (node.userData.armorSection === 'gunBarrel') {
                node.userData.armorThickness = gunBarrelThickness;
            }
        });
        const armorModel = models.armorModel;
        if (!armorModel) return;
        armorModel.traverse(function(node: THREE.Object3D) {
            if (!(node instanceof THREE.Mesh)) return;
            const section = node.userData.armorSectionOrig;
            if (section !== 'turret' && section !== 'gun') return;
            const plateId = node.userData.armorPlateId;
            if (!plateId) return;
            node.userData.armorThickness = getPlateThickness(section, plateId);
        });
    }

    function tagArmorPlates(model: THREE.Object3D): void {
        tagArmorPlateNodes(model, getPlateThickness);
        retagSpacedSections(model);
    }

    function tagModuleMeshes(model: THREE.Object3D): void {
        moduleMeshes = tagModuleNodes(model, getPlateThickness);
    }

    function applyModelTransforms(model: THREE.Object3D): void {
        model.rotation.x = -Math.PI / 2;
        model.scale.setScalar(1);
        worldMetersPerUnit = 1;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        modelMaxDim = Math.max(size.x, size.y, size.z);
        model.position.set(0, 0, 0);
    }

    function syncTransforms(): void {
        const tankModel = models.tankModel, armorModel = models.armorModel;
        if (!tankModel || !armorModel) return;
        armorModel.rotation.copy(tankModel.rotation);
        armorModel.scale.copy(tankModel.scale);
        armorModel.position.copy(tankModel.position);
        rig.collectConfigNodes(tankModel);
        rig.alignArmorModules();
    }

    function disposeDetachedModel(root: THREE.Object3D | null | undefined): void {
        if (!root) return;
        root.traverse(function(node: THREE.Object3D) {
            const mesh = node as THREE.Mesh;
            if (mesh.geometry && typeof mesh.geometry.dispose === 'function') mesh.geometry.dispose();
            const materials: THREE.Material[] = Array.isArray(mesh.material) ? mesh.material : (mesh.material ? [mesh.material] : []);
            materials.forEach(function(material: THREE.Material) {
                if (!material) return;
                for (const value of Object.values(material)) {
                    const texture = value as THREE.Texture;
                    if (texture && texture.isTexture && typeof texture.dispose === 'function') texture.dispose();
                }
                if (typeof material.dispose === 'function') material.dispose();
            });
        });
    }

    function clearModels(): void {
        const scene = getScene(), fxScene = getFxScene();
        if (models.tankModel) { scene.remove(models.tankModel); disposeDetachedModel(models.tankModel); models.tankModel = null; }
        if (models.armorModel) { scene.remove(models.armorModel); disposeDetachedModel(models.armorModel); models.armorModel = null; }
        if (window.__shooterModel) {
            scene.remove(window.__shooterModel); disposeDetachedModel(window.__shooterModel);
            window.__shooterModel = null;
        }
        rig.invalidatePrefixCache();
        clearTrajectory();
        clearHeBlast();
        disposePenetrationResources();
        disposeHitMarker(fxScene);
        if (window.__endMarker) { scene.remove(window.__endMarker); window.__endMarker = null; }
        if (window.__dbgGroup) { scene.remove(window.__dbgGroup); window.__dbgGroup = null; }
        releaseModuleMaterialCaches();
        clearHighlight();
        const staleClickInfo = document.getElementById('click-info');
        if (staleClickInfo) staleClickInfo.style.display = 'none';
        moduleMeshes = [];
        rig.reset();
    }

    function loadModels(): void {
        if (isDestroyed() || isContextLost()) return;
        const loadingEl = document.getElementById('loading') as HTMLElement | null;
        if (loadingEl) loadingEl.style.display = 'block';
        if (loadingEl) loadingEl.textContent = L_loading;
        window.__LOAD__ = 'start';
        const scene = getScene();
        clearModels();
        const gen = loadGen.bump();
        const current = () => !isDestroyed() && gen === loadGen.get();
        let failed = false;
        const tankData = getTankData();
        modelProgress.reset();
        modelProgress.expect('armor');
        modelProgress.expect('visual');
        const onBytes = (key: string) => (e: ProgressEvent | null) => {
            if (current() && e) modelProgress.update(key, e.loaded, e.lengthComputable ? e.total : 0);
        };
        const finish = (key: string) => {
            if (!current()) return;
            modelProgress.complete(key);
            const snap = modelProgress.snapshot();
            if (snap.done === snap.total && !failed) reportLoad({ state: 'ready', progress: 1 });
        };
        const loader = new GLTFLoader();
        const fail = (phase: string) => (error: unknown) => {
            if (!current()) return;
            const msg = errorMessage(error);
            window.__LOAD__ = 'fail:' + phase + ':' + msg;
            console.error('Failed to load ' + phase + ':', error);
            if (loadingEl) loadingEl.textContent = loadFailed(phase, msg);
            failed = true;
            reportLoad({ state: 'error', message: loadFailed(phase, msg) });
        };

        loader.load(assetProvider.url(tankData.model_url!), function(gltf) {
            if (!current() || isDestroyed()) {
                disposeDetachedModel(gltf?.scene);
                return;
            }
            const armorModel = gltf.scene;
            models.armorModel = armorModel;
            rig.invalidatePrefixCache();
            tagArmorPlates(armorModel);
            useFaceNormals(armorModel);
            armorModel.traverse(function(node: THREE.Object3D) {
                const mesh = node as THREE.Mesh;
                if (mesh.isMesh) {
                    if (mesh.userData.armorSection === 'deco') { mesh.visible = false; return; }
                    replaceArmorMaterial(mesh, new THREE.MeshStandardMaterial({
                        color: 0x444444, metalness: 0.3, roughness: 0.8,
                        transparent: true, opacity: 0, depthWrite: false,
                    }));
                }
            });
            scene.add(armorModel);
            syncTransforms();
            applyConfig(getCurrentConfigIdx());
            applyArmorStateToModel();
            applyUrlOptionsOnce();
            finish('armor');
        }, onBytes('armor'), fail('armor model'));

        loader.load(assetProvider.url(tankData.visual_model_url), function(gltf) {
            if (!current() || isDestroyed()) {
                disposeDetachedModel(gltf?.scene);
                return;
            }
            const tankModel = gltf.scene;
            models.tankModel = tankModel;
            applyModelTransforms(tankModel);
            tagModuleMeshes(tankModel);
            tankModel.traverse(function(node: THREE.Object3D) {
                const mesh = node as THREE.Mesh;
                if (mesh.isMesh) {
                    mesh.castShadow = true;
                    mesh.receiveShadow = true;
                }
            });
            neutralizeDefaultMetalness(tankModel);
            dropDuplicateGunMasks(tankModel);
            scene.add(tankModel);
            if (getQP().get('debug') === '1') {
                const dbg = new THREE.Group();
                dbg.add(new THREE.AxesHelper(0.8));
                const mk = (color: number) => new THREE.Mesh(
                    new THREE.SphereGeometry(0.09, 12, 10),
                    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }));
                let sum = new THREE.Vector3(); let cnt = 0;
                tankModel.updateWorldMatrix(true, true);
                tankModel.traverse(function(node: THREE.Object3D) {
                    if (!(node instanceof THREE.Mesh) || !node.geometry || !node.geometry.attributes.position) return;
                    const pos = node.geometry.attributes.position;
                    for (let i = 0; i < pos.count; i++) {
                        sum.add(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld));
                        cnt++;
                    }
                });
                const vC = cnt > 0 ? sum.divideScalar(cnt)
                    : new THREE.Box3().setFromObject(tankModel).getCenter(new THREE.Vector3());
                const vM = mk(0x00ffff); vM.position.copy(vC); vM.renderOrder = 997; dbg.add(vM);
                const armorModel = models.armorModel;
                if (armorModel) {
                    const aC = new THREE.Box3().setFromObject(armorModel).getCenter(new THREE.Vector3());
                    const aM = mk(0x2b7bff); aM.position.copy(aC); aM.renderOrder = 997; dbg.add(aM);
                }
                window.__dbgGroup = dbg;
                scene.add(dbg);
            }
            if (loadingEl) loadingEl.style.display = 'none';
            window.__LOAD__ = 'ok:' + tankData.tank_id;
            const controls = getControls();
            if (controls) {
                controls.target.set(0, 0, 0);
                controls.update();
            }
            syncTransforms();
            applyConfig(getCurrentConfigIdx());
            applyUrlOptionsOnce();
            window.__DBG__ = { scene, tankModel, armorModel: models.armorModel, tankData, THREE, controls };
            finish('visual');
        }, onBytes('visual'), fail('tank model'));
    }

    return {
        models,
        loadModels,
        clearModels,
        disposeDetachedModel,
        syncTransforms,
        applyModelTransforms,
        tagArmorPlates,
        tagModuleMeshes,
        retagSpacedSections,
        refreshConfigArmorThickness,
        getModuleMeshes: () => moduleMeshes,
        setModuleMeshes: (list: THREE.Object3D[]) => { moduleMeshes = list; },
        getWorldMetersPerUnit: () => worldMetersPerUnit,
        getModelMaxDim: () => modelMaxDim,
        setArmorModelResolver: (fn: () => THREE.Object3D | null) => { _retagArmorModel = fn; },
    };
}
