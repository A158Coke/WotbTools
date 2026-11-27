import * as THREE from 'three'
import {
    shellTypeOf, shellAngles,
    partitionArmorMeshes, selectExternalMeshes, gunMaskOriginModel,
    populateSpacedArmorScene, populateSpacedStateScene, populatePrimaryArmorScene,
} from './armorPlateModel.js'
import { createHeatmapMaterialDisposal } from './heatmapMaterialDisposal.js'
import { createHeSplashVisual } from './heSplashVisual.js'
import { createHeatmapPasses } from './heatmapPasses.js'
import { createHeatmapRicochet } from './heatmapRicochet.js'
import { createArmorShaderContext, createDepthStencilTexture } from './armorShaders.js'
import type { TankArmorConfig } from './armorPlateModel.js'
import type { ModelReferences } from './modelLifecycle.js'
import type { TurretRigHandle } from './turretRig.js'
import type { ShellSpec, TankData } from './viewerContracts.js'

/**
 * @param {object} deps composition root 注入的显式接口
 * @param {object} deps.models { tankModel, armorModel }（modelLifecycle owner 的只读引用）
 * @param {object} deps.rig 炮塔/炮管姿态 owner（gun_mask 裁切矩阵来源）
 * @param {() => number|null} deps.getWorldMetersPerUnit 场景米制换算（modelLifecycle owner）
 * @param {() => object|null} deps.getModuleMeshes 外部模块网格列表（modelLifecycle owner）
 * @param {() => object|null} deps.getRenderer / getCamera
 * @param {() => object} deps.getTankData / getCurrentConfig / getActiveGunNumber
 * @param {() => object|null} deps.getSelectedShell / getShooterShells
 * @param {() => boolean} deps.getPenetrationMode / getCollisionMode 视图模式旗标（composition root）
 * @param {() => object} deps.equipmentCoeffs 装备系数（equipment owner）
 * @param {() => number} deps.resolveCaliberFor 判定口径解析（judgment owner）
 * @param {(collision: boolean) => void} deps.applyArmorViewStyle 装甲视图样式（collision view owner）
 */

interface HeatmapEquipmentCoeffs {
    thickMul: number;
    penMul: number;
}

interface HeUniforms {
    heActive?: { value: boolean };
    heCenter?: { value: THREE.Vector3 };
}

export interface HeatmapDeps {
    models: ModelReferences;
    rig: TurretRigHandle;
    getWorldMetersPerUnit: () => number | null;
    getModuleMeshes: () => THREE.Object3D[];
    getRenderer: () => THREE.WebGLRenderer;
    getCamera: () => THREE.Camera;
    getTankData: () => TankData;
    getCurrentConfig: () => TankArmorConfig | null;
    getActiveGunNumber: () => number | null;
    getSelectedShell: () => ShellSpec | null;
    getShooterShells: () => ShellSpec[];
    getPenetrationMode: () => boolean;
    getCollisionMode: () => boolean;
    equipmentCoeffs: () => HeatmapEquipmentCoeffs;
    resolveCaliberFor: (shell: ShellSpec | null | undefined) => number;
    applyArmorViewStyle: (collision: boolean) => void;
    getFxScene: () => THREE.Scene;
    getScene: () => THREE.Scene;
    applyCategoryFilters: () => void;
}

export function createHeatmapPipeline(deps: HeatmapDeps) {
    const {
        models, rig, getWorldMetersPerUnit, getModuleMeshes, getRenderer, getCamera,
        getTankData, getCurrentConfig, getActiveGunNumber,
        getSelectedShell, getShooterShells, getPenetrationMode, getCollisionMode,
        equipmentCoeffs, resolveCaliberFor, applyArmorViewStyle,
        applyCategoryFilters: applyCategoryFiltersFn,
    } = deps
    const armorShaders = createArmorShaderContext();
    const {
        rcUniforms,
        penetrationMaterial, externalMaterial, spacedMaterial, spacedStateMaterial, moduleStateMaterial,
        emptySpacedTexture,
    } = armorShaders;
    let heHeatmapCenter: THREE.Vector3 | null = null;
    const { disposeSceneMaterials } = createHeatmapMaterialDisposal(emptySpacedTexture)
    const heVisual = createHeSplashVisual(deps)
    const { disposeHeSplashVisual, updateHeSplashVisual } = heVisual
    let penetrationRT: THREE.WebGLRenderTarget | null = null;
    let spacedStateRT: THREE.WebGLRenderTarget | null = null;
    let primaryMeshes: THREE.Mesh[] = [], spacedMeshes: THREE.Mesh[] = [], externalMeshes: THREE.Mesh[] = [];
    let gunClipPlane: THREE.Plane | null = null;
    const _gunClipPlaneObj = new THREE.Plane();
    const _gunClipMatrix = new THREE.Matrix4();
    let spacedArmorScene: THREE.Scene | null = null;
    let primaryArmorScene: THREE.Scene | null = null;
    let spacedStateScene: THREE.Scene | null = null;
    const ricochet = createHeatmapRicochet(deps, rcUniforms)
    const { rebuildRicochetPack, prepareRicochetFrame, updateCollisionWorldMatrices, syncRicochetEnabled, collectRicochetEntries } = ricochet
    const omitMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true });
    const spacedOmitMaterial = new THREE.MeshBasicMaterial({
        colorWrite: false, depthTest: true, depthWrite: true, side: THREE.DoubleSide,
    });
    const excludeMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true });
    const externalDepthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true });

function applyHeUniforms(u: HeUniforms) {
            if (!u) return;
            const active = !!(heHeatmapCenter && getSelectedShell() && shellTypeOf(getSelectedShell()) === 'he');
            if (u.heActive) u.heActive.value = active;
            if (u.heCenter && heHeatmapCenter) u.heCenter.value.copy(heHeatmapCenter);
        }

function updateHeHeatmapUniforms() {
            const apply = (obj: THREE.Object3D | null) => obj && obj.traverse((node) => {
                const mesh = node as THREE.Mesh;
                const mat = mesh.material as THREE.ShaderMaterial | undefined;
                if (!mesh.isMesh || !mat || !mat.uniforms) return;
                applyHeUniforms(mat.uniforms);
            });
            apply(primaryArmorScene);
        }

function spacedRTFloatCapable() {
            return getRenderer().extensions.has('EXT_color_buffer_float')
                || getRenderer().extensions.has('EXT_color_buffer_half_float');
        }

function ensurePenetrationRT() {
            const rtType = spacedRTFloatCapable() ? THREE.HalfFloatType : THREE.UnsignedByteType;
            if (!penetrationRT) {
                const c = getRenderer().domElement;
                penetrationRT = new THREE.WebGLRenderTarget(c.width, c.height, {
                    type: rtType,
                    depthTexture: createDepthStencilTexture(c.width, c.height),
                    stencilBuffer: true,
                });
            }
            if (!spacedStateRT) {
                const c = getRenderer().domElement;
                spacedStateRT = new THREE.WebGLRenderTarget(c.width, c.height, {
                    type: rtType,
                    depthTexture: new THREE.DepthTexture(c.width, c.height),
                });
            }
            const cx = getRenderer().domElement;
            penetrationRT.setSize(cx.width, cx.height);
            spacedStateRT.setSize(cx.width, cx.height);
            return penetrationRT;
        }

function ensureSpacedStateRT() {
            ensurePenetrationRT();
            return spacedStateRT;
        }

function syncPenetrationRT() {
            const rt = ensurePenetrationRT();
            const c = getRenderer().domElement;
            const w = c.width, h = c.height;
            if (!rt.depthTexture || rt.depthTexture.width !== w || rt.depthTexture.height !== h) {
                if (rt.depthTexture) rt.depthTexture.dispose();
                rt.depthTexture = createDepthStencilTexture(w, h);
            }
            rt.setSize(w, h);
            const srt = spacedStateRT;
            if (srt) {
                if (!srt.depthTexture || srt.depthTexture.width !== w || srt.depthTexture.height !== h) {
                    if (srt.depthTexture) srt.depthTexture.dispose();
                    srt.depthTexture = new THREE.DepthTexture(w, h);
                }
                srt.setSize(w, h);
            }
            return rt;
        }

function computeGunClipPlane() {
            gunClipPlane = null;
            const cfg = getCurrentConfig();
            if (!models.tankModel) return;
            const maskOriginModel = gunMaskOriginModel(getTankData(), cfg);
            if (maskOriginModel == null) return;
            models.tankModel.updateMatrixWorld(true);
            const plane = _gunClipPlaneObj.setFromNormalAndCoplanarPoint(
                new THREE.Vector3(0, 1, 0),
                new THREE.Vector3(0, maskOriginModel / (getWorldMetersPerUnit() || 1), 0));
            _gunClipMatrix.copy(models.tankModel.matrixWorld).multiply(rig.gunPoseMatrix);
            plane.applyMatrix4(_gunClipMatrix);
            gunClipPlane = plane;
        }

function collectPenetrationMeshes() {
            if (models.armorModel) {
                ({ primary: primaryMeshes, spaced: spacedMeshes } = partitionArmorMeshes(models.armorModel));
            }
            computeGunClipPlane();
            externalMeshes = selectExternalMeshes(getModuleMeshes() as THREE.Mesh[], getActiveGunNumber(), getCurrentConfig());
        }

function updateHeatmapThickness() {
            const { thickMul } = equipmentCoeffs();
            rcUniforms.rcThickMul.value = thickMul;
            const apply = function(obj: THREE.Object3D | null) {
                if (!obj) return;
                obj.traverse(function(node){
                    const mesh = node as THREE.Mesh;
                    const mat = mesh.material as THREE.ShaderMaterial | undefined;
                    if (!mesh.isMesh || !mat || !mat.uniforms) return;
                    const u = mat.uniforms;
                    if (u.thickness && node.userData._baseThickness != null) {
                        u.thickness.value = node.userData._baseThickness * thickMul;
                    }
                });
            };
            apply(spacedArmorScene); apply(spacedStateScene); apply(primaryArmorScene);
        }

function heatMeshes() {
            return { primary: primaryMeshes, spaced: spacedMeshes, external: externalMeshes };
        }

function heatMaterials() {
            return {
                omit: omitMaterial, spacedOmit: spacedOmitMaterial, exclude: excludeMaterial,
                externalDepth: externalDepthMaterial, externalMaterial, moduleStateMaterial,
                spacedMaterial, spacedStateMaterial, penetrationMaterial,
            };
        }

function buildSpacedArmorScene() {
            if (!models.armorModel) return;
            if (spacedArmorScene) spacedArmorScene.clear();
            else spacedArmorScene = new THREE.Scene();
            const shell = getSelectedShell();
            const pen = ((shell && shell.penetration) || 200) * equipmentCoeffs().penMul;
            populateSpacedArmorScene(spacedArmorScene, heatMeshes(), heatMaterials(), pen, gunClipPlane);
        }

function buildSpacedStateScene() {
            if (!models.armorModel) return;
            if (spacedStateScene) spacedStateScene.clear();
            else spacedStateScene = new THREE.Scene();
            const shell = getSelectedShell();
            const pen = ((shell && shell.penetration) || 200) * equipmentCoeffs().penMul;
            populateSpacedStateScene(spacedStateScene, heatMeshes(), heatMaterials(), pen, gunClipPlane);
        }

function buildPrimaryArmorScene() {
            if (!models.armorModel) return;
            if (primaryArmorScene) primaryArmorScene.clear();
            else primaryArmorScene = new THREE.Scene();
            populatePrimaryArmorScene(primaryArmorScene, heatMeshes(), heatMaterials());
        }

function syncCloneMatrices(obj: THREE.Object3D | null) {
            if (!obj) return;
            obj.traverse(function(node){
                const src = node.userData._src as THREE.Object3D | null | undefined;
                if (src) {
                    src.updateWorldMatrix(true, false);
                    node.matrix.copy(src.matrixWorld);
                }
            });
        }

function updateSpacedUniforms(sh: ShellSpec) {
            if (!spacedArmorScene) return;
            const t = shellTypeOf(sh);
            const isExplosive = t === 'he' || t === 'heat';
            const { penMul } = equipmentCoeffs();
            const pen = (sh.penetration || 0) * penMul;
            const cal = resolveCaliberFor(sh);
            const { norm, rico } = shellAngles(sh, isExplosive);
            [spacedArmorScene, spacedStateScene].forEach(function(scene){
                if (!scene) return;
                scene.traverse(function(node){
                    const mesh = node as THREE.Mesh;
                    const mat = mesh.material as THREE.ShaderMaterial | undefined;
                    if (!mesh.isMesh || !mat || !mat.uniforms) return;
                    const u = mat.uniforms;
                    if (u.penetration) u.penetration.value = pen;
                    if (u.caliber) u.caliber.value = cal;
                    if (u.ricochet) u.ricochet.value = rico;
                    if (u.normalization) u.normalization.value = norm;
                });
            });
        }

function applyArmorStateToHeatmapClones(activeSet: ReadonlySet<string>) {
            const apply = (scene: THREE.Scene | null) => {
                if (!scene) return;
                scene.traverse(function(node) {
                    const key = node.userData._armorStateKey;
                    if (!key) return;
                    node.visible = activeSet.has(key);
                    const src = node.userData._src as THREE.Object3D | null | undefined;
                    if (src && typeof src.userData.armorThickness === 'number') {
                        node.userData._baseThickness = src.userData.armorThickness;
                        const mesh = node as THREE.Mesh;
                        const mat = mesh.material as THREE.ShaderMaterial | undefined;
                        if (mat && mat.uniforms && mat.uniforms.thickness) {
                            mat.uniforms.thickness.value = src.userData.armorThickness;
                        }
                    }
                });
            };
            apply(primaryArmorScene);
            apply(spacedArmorScene);
            apply(spacedStateScene);
            const sh = getSelectedShell() || (getShooterShells()[0]) || null;
            if (sh) {
                updatePenetrationUniforms(sh);
                updateSpacedUniforms(sh);
            }
            updateHeatmapThickness();
        }                

function disposePenetrationResources() {
            disposeSceneMaterials(primaryArmorScene);
            disposeSceneMaterials(spacedArmorScene);
            disposeSceneMaterials(spacedStateScene);
            primaryArmorScene = null;
            spacedArmorScene = null;
            spacedStateScene = null;
            if (spacedStateRT) {
                if (spacedStateRT.depthTexture) spacedStateRT.depthTexture.dispose();
                spacedStateRT.dispose();
                spacedStateRT = null;
            }
            if (penetrationRT) {
                if (penetrationRT.depthTexture) penetrationRT.depthTexture.dispose();
                penetrationRT.dispose();
                penetrationRT = null;
            }
            ricochet.reset();
        }

function rebuildHeatmapScenes() {
            disposePenetrationResources();
            collectPenetrationMeshes();
            rebuildRicochetPack();
            buildSpacedArmorScene();
            buildSpacedStateScene();
            buildPrimaryArmorScene();
            const sh = getSelectedShell() || (getShooterShells()[0]) || null;
            if (sh) { updatePenetrationUniforms(sh); updateSpacedUniforms(sh); }
            updateHeatmapThickness();
            refreshPenetrationResolution();
            updateHeHeatmapUniforms();
            updateHeatMaskUniforms(getPenetrationMode());
        }

function heGradientWanted() {
            return !getPenetrationMode() && !getCollisionMode() && !!models.armorModel
                && !!getSelectedShell() && shellTypeOf(getSelectedShell()) === 'he' && !!heHeatmapCenter;
        }

function syncHeatOverlay() {
            if (getPenetrationMode()) return;
            if (heGradientWanted()) {
                if (primaryArmorScene) updateHeatMaskUniforms(false);
                else rebuildHeatmapScenes();
            } else if (primaryArmorScene) {
                disposePenetrationResources();
                getRenderer().autoClear = true;
                getRenderer().setRenderTarget(null);
            }
        }

function applyPenetrationMode(on: boolean) {
            if (!models.armorModel) return;
            if (!on) {
                if (heVisual.getGroup()) heVisual.getGroup()!.visible = false;
                models.armorModel.visible = true;
                applyArmorViewStyle(getCollisionMode());
                getRenderer().autoClear = true;
                getRenderer().setRenderTarget(null);
                syncHeatOverlay();
                return;
            }
            if (models.tankModel) models.tankModel.visible = true;
            rebuildHeatmapScenes();
            models.armorModel.visible = true;
            externalMeshes.forEach(function(node){ node.visible = true; });
            applyCategoryFiltersFn();
            if (heVisual.getGroup()) heVisual.getGroup()!.visible = true;
        }

function updatePenetrationUniforms(sh: ShellSpec) {
            const t = shellTypeOf(sh);
            const isHE = t === 'he';
            const isExplosive = isHE || t === 'heat';
            excludeMaterial.visible = true;
            syncRicochetEnabled(sh);
            const cal = resolveCaliberFor(sh);
            const { penMul } = equipmentCoeffs();
            const pen = (sh.penetration || 0) * penMul;
            const { norm, rico } = shellAngles(sh, isExplosive);
            const applyTo = (node: THREE.Object3D) => {
                const mesh = node as THREE.Mesh;
                if (!mesh.isMesh || mesh.visible === false) return;
                const mat = mesh.material as THREE.ShaderMaterial | undefined;
                if (!mat || !mat.uniforms) return;
                const u = mat.uniforms;
                if (u.penetration) u.penetration.value = pen;
                if (u.caliber) u.caliber.value = cal;
                if (u.ricochet) u.ricochet.value = rico;
                if (u.normalization) u.normalization.value = norm;
                if (u.isExplosive) u.isExplosive.value = isExplosive;
                if (u.canSplash) u.canSplash.value = isHE;
                if (u.damage) u.damage.value = sh.damage || 0;
                if (u.explosionRadius) u.explosionRadius.value = sh.explosion_radius || 0;
                if (u.heActive) u.heActive.value = isHE && !!heHeatmapCenter;
                if (u.heCenter && heHeatmapCenter) u.heCenter.value.copy(heHeatmapCenter);
            };
            if (primaryArmorScene) primaryArmorScene.traverse(function(node){ if ((node as THREE.Mesh).isMesh) applyTo(node); });
            if (!isHE) {
                heHeatmapCenter = null;
                disposeHeSplashVisual();
                updateHeHeatmapUniforms();
            } else {
                const nextRadius = sh.explosion_radius || 0;
                if (heVisual.getGroup() && heHeatmapCenter && nextRadius > 0
                    && heVisual.getGroup()!.userData.radius !== nextRadius) {
                    updateHeSplashVisual(heHeatmapCenter, nextRadius);
                } else if (heVisual.getGroup() && !(nextRadius > 0)) {
                    disposeHeSplashVisual();
                } else if (heVisual.getGroup()) {
                    heVisual.getGroup()!.visible = getPenetrationMode();
                }
            }
        }

    const { refreshPenetrationResolution, updatePenetrationDistanceUniforms, renderSpacedArmorPass, updateHeatMaskUniforms } = createHeatmapPasses({
        getRenderer, getCamera, getSelectedShell, equipmentCoeffs, getWorldMetersPerUnit,
        getPrimaryArmorScene: () => primaryArmorScene, getSpacedArmorScene: () => spacedArmorScene,
        getSpacedStateScene: () => spacedStateScene, syncPenetrationRT, ensureSpacedStateRT,
        syncCloneMatrices, computeGunClipPlane, getGunClipPlane: () => gunClipPlane, spacedRTFloatCapable, rcUniforms,
    })
    return {
        armorShaders,
        rcUniforms,
        updateHeHeatmapUniforms, updateHeSplashVisual, disposeHeSplashVisual,
        updateHeatMaskUniforms, computeGunClipPlane, getGunClipPlane: () => gunClipPlane,
        updateHeatmapThickness, updateSpacedUniforms, updatePenetrationUniforms,
        disposePenetrationResources, rebuildHeatmapScenes, syncHeatOverlay, applyPenetrationMode,
        refreshPenetrationResolution, updatePenetrationDistanceUniforms,
        prepareRicochetFrame, renderSpacedArmorPass, updateCollisionWorldMatrices,
        rebuildRicochetPack, collectRicochetEntries,
        heGradientWanted, applyArmorStateToHeatmapClones, syncCloneMatrices,
        getHeHeatmapCenter: () => heHeatmapCenter,
        setHeHeatmapCenter: (v: THREE.Vector3 | null) => { heHeatmapCenter = v; },
        clearHeBlast: () => { heHeatmapCenter = null; updateHeHeatmapUniforms(); disposeHeSplashVisual(); },
        getPrimaryArmorScene: () => primaryArmorScene,
        getRicochetPack: ricochet.getRicochetPack,
        getRicochetGrid: ricochet.getRicochetGrid,
        isRicochetPoseDirty: ricochet.isRicochetPoseDirty,
        getRicochetGridGeneration: ricochet.getRicochetGridGeneration,
        getRicochetPackReason: ricochet.getRicochetPackReason,
        getRicochetPoseSnapshot: ricochet.getRicochetPoseSnapshot,
        getPenetrationRT: () => penetrationRT,
        invalidateRicochetPose: ricochet.invalidateRicochetPose,
        buildSplashGeometry: ricochet.buildSplashGeometry,
    };
}
