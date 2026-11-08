// 模型与资源生命周期（#820 Agent A 出仓）：tankModel/armorModel 引用的唯一 owner、
// GLB 装载/卸载、模型变换与装甲标注。原 tankViewer.js 闭包内对应函数整体平移，
// 装配时序、generation guard、迟到 GLB dispose、retry 语义保持原样。
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

import type { TankArmorConfig } from './armorPlateModel.js'
import type { TankData } from './viewerContracts.js'

/** 模型装载进度聚合（kernel 创建，本模块只调用）。 */
export interface ModelProgress {
    reset(): void
    expect(key: string): void
    update(key: string, loaded: number, total: number): void
    complete(key: string): void
    snapshot(): { done: number; total: number }
}

/** 模型装载代数（迟到 GLB 丢弃 guard）。 */
export interface LoadGeneration {
    get(): number
    bump(): number
}

/** 模型与资源生命周期 owner 的显式依赖。 */
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

/** 场景模型引用（本模块唯一写入方）。 */
export interface ModelReferences {
    tankModel: THREE.Group | null
    armorModel: THREE.Group | null
}

/** 模型生命周期 owner 的公开句柄。 */
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

    // 模型引用 holder：本模块是唯一写入方；其它模块经 models.* 只读取。
    const models: ModelReferences = { tankModel: null, armorModel: null }
    let moduleMeshes: THREE.Object3D[] = [];   // 视觉车体上的外部模块（炮管/履带，tagModuleMeshes 收集）
    let worldMetersPerUnit = 1;      // 场景原生米制：1 单位 = 1 米（模型不再缩放）
    let modelMaxDim = 6;             // 模型实际最长边（米）——仅用于相机取景推算
    let _retagArmorModel: (() => THREE.Object3D | null) | null = null;     // retagSpacedSections 的宿主装甲模型解析（依赖注入后设置）

    function retagSpacedSections(model?: THREE.Object3D | null): void {
        const root = model || (_retagArmorModel ? _retagArmorModel() : null);
        const tankData = getTankData();
        if (!root || !tankData) return;
        retagSpacedPlates(root, tankData, getCurrentConfig());
    }

    function refreshConfigArmorThickness(): void {
        // 逐炮塔/逐主炮 plates 随 config 切换：tagArmorPlates 只在装甲模型加载时跑一次，
        // 之后切 stock/top 必须按当前 config 重算 turret/gun userData.armorThickness，
        // 否则热力图/点击信息仍沿用加载时那套 config 的值。
        // 炮管/炮盾是视觉车体上的外部模块，tagModuleMeshes 在加载时缓存了
        // gun_thickness；切炮后同样要刷新，否则判定仍用上一门炮的厚度。
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

    // 不缩放（场景原生米制，1 单位 = 1 米）+【模型原点 = 场景原点】：glb 原点即游戏引擎
    // 的车体锚点（= 回放 type10 位置锚点），弹着点/炮口等回放数据零偏移直通；按包围盒
    // 中心对齐会有数厘米残差且被炮管前伸拉偏。代价：OrbitControls 旋转围绕车体锚点
    // （地面高度）而非视觉中心——数据精确性优先。
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
        // 释放 GPU 资源：此前只 scene.remove + 置 null，几何/材质/贴图全留在显存里——
        // 反复切换坦克或复现射击时显存单调增长。disposeDetachedModel 是同文件既有助手
        // （此前只用于丢弃「迟到的/失败的」gltf）。
        if (models.tankModel) { scene.remove(models.tankModel); disposeDetachedModel(models.tankModel); models.tankModel = null; }
        if (models.armorModel) { scene.remove(models.armorModel); disposeDetachedModel(models.armorModel); models.armorModel = null; }
        if (window.__shooterModel) {
            scene.remove(window.__shooterModel); disposeDetachedModel(window.__shooterModel);
            window.__shooterModel = null;
        }
        rig.invalidatePrefixCache();   // 装甲模型重建后前缀缓存失效
        clearTrajectory();
        clearHeBlast();
        disposePenetrationResources();   // 叠加 clone 引用旧模型几何，卸载即整体释放；新模型装载路径按模式重建
        if (window.__hitMarker) { fxScene.remove(window.__hitMarker); window.__hitMarker = null; }
        if (window.__endMarker) { scene.remove(window.__endMarker); window.__endMarker = null; }
        if (window.__dbgGroup) { scene.remove(window.__dbgGroup); window.__dbgGroup = null; }
        releaseModuleMaterialCaches();
        // 旧模型卸载后高亮节点/点选浮层不再有效：清掉引用，加载失败也不会残留旧板信息。
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
        // XHR ProgressEvent：长度未知时 total=0，该项只在完成时计满
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
            rig.invalidatePrefixCache();   // 装甲模型重建后前缀缓存失效
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
            applyArmorStateToModel();   // 动态装甲：按当前态摘除非激活可控板（初态 = 声明 default）
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
            // hide_elements 拆件全部渲染（用户要求完整模型）。拆件位于 hull/turret_XX/gun_XX
            // 子树内，姿态矩阵随父节点自动跟随，无需额外处理。
            tankModel.traverse(function(node: THREE.Object3D) {
                const mesh = node as THREE.Mesh;
                if (mesh.isMesh) {
                    mesh.castShadow = true;
                    mesh.receiveShadow = true;
                }
            });
            // 老式车（无 metallicRoughness 贴图）的金属度会被 three.js 取 glTF 默认 1.0
            // 当全金属渲染，无环境贴图下整车发黑（见 glbRig.js）
            neutralizeDefaultMetalness(tankModel);
            // 同回放：Maus 的 mask_01 是 gun_01_mask 的几何副本，rig 不摆位它会留在原地
            dropDuplicateGunMasks(tankModel);
            scene.add(tankModel);
                // ?debug=1：标注模型原点（=车体原点=场景原点）与两个包围盒中心（验证定位）
            if (getQP().get('debug') === '1') {
                const dbg = new THREE.Group();
                // 原点：模型原点 = 车体原点 = 场景原点（三轴 RGB=XYZ）
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
            // 初始占位；applyUrlOptionsOnce 的默认分支会把目标改到炮线高度（车体居中）。
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
        /** retagSpacedSections 的装甲模型解析（宿主主闭包注入，避免循环依赖）。 */
        setArmorModelResolver: (fn: () => THREE.Object3D | null) => { _retagArmorModel = fn; },
    };
}
