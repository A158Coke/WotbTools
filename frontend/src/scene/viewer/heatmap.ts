// 穿透热力图 / 装甲渲染管线（#820 Agent A 出仓）：RT 机械、间隙甲/主装甲/状态通道
// 场景、跳弹续飞网格、HE 溅射可视化与逐帧渲染 pass 的唯一 owner。
// 原 tankViewer.js 闭包内对应函数整体平移；材质语义注释见 viewer/armorShaders.ts。
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
    // 穿透材质族的**每实例**运行态（分辨率/跳弹 uniforms/占位纹理 + 绑定它们的材质工厂）。
    // 不能是模块单例：两个 viewer 生命周期重叠时，A 的更新/重建/清理会直接改到 B 的 uniforms
    //（评审 P1）。解构命名与拆分前一致，消费点零改动。
    const armorShaders = createArmorShaderContext();
    const {
        rcUniforms,
        penetrationMaterial, externalMaterial, spacedMaterial, spacedStateMaterial, moduleStateMaterial,
        emptySpacedTexture,
    } = armorShaders;
    let heHeatmapCenter: THREE.Vector3 | null = null;    // HE 爆点（世界系）；null = 热力图 HE 分支透明
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
    // 状态通道场景/目标（RT1）：只有最近间隙板能写状态（不可累加）——见 SPACED_STATE_FRAG
    let spacedStateScene: THREE.Scene | null = null;
    const ricochet = createHeatmapRicochet(deps, rcUniforms)
    const { rebuildRicochetPack, prepareRicochetFrame, updateCollisionWorldMatrices, syncRicochetEnabled, collectRicochetEntries } = ricochet
    const omitMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true });
    // 间隙甲深度占位也必须双面：背面命中的间隙屏要参与遮挡/深度（与着色双面一致）。
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
                // stencilBuffer：开放间隙板 front 写/back 测的同板去重位（厚度通道按
                // 去重键每射线只计一次；spacedStateRT 状态通道深度独占，不需要）。
                // 深度纹理由 createDepthStencilTexture 统一构造（DepthStencilFormat，
                // 首建与 resize 重建同源）；spacedStateRT 不需要 stencil。
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
            // resize 重建深度纹理必须走同一工厂（DepthStencilFormat + stencilBuffer），
            // 否则首次 resize 后 stencil 附件消失、去重静默失效（review P1，2026-11-06）。
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
            // BlitzKit 同式：裁切面定义在枪管局部系（模型系）——法线 = 模型前向 +Y，过模型
            // 原点前方 maskOriginModel 处；再乘炮塔/炮管姿态矩阵（绕各自枢轴）与模型根变换
            // 进世界系。不能只取「模型原点 + 当前炮口方向 × 距离」：转炮塔/俯仰后平面应绕
            // 枢轴旋转，否则裁切位置会随姿态漂移（与 BlitzKit 不一致）。
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
            rcUniforms.rcThickMul.value = thickMul;   // 续飞层链厚度系数与主图同源
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
            // 三个 Scene 清空后必须一并置 null：调用方（syncHeatOverlay / animate /
            // 模式往返重建）都以引用是否为 null 判断「叠加层是否可用」。留着空 Scene，
            // 释放后再需要渐变时只会去更新一个空场景的 uniform，重建永不发生（评审 P2）。
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
                // 回到进入热力图前的视图样式（getCollisionMode() 仍开启则恢复碰撞视图）。
                // 不触碰模块网格可见性：热力图开启路径从不隐藏它们；此前在这里按
                // "mask 无值→隐藏 gunMaskPart" 重写视觉模型，会把 gun_XX_mask 炮盾视觉
                // 永久藏掉（有 mask 值的车则反向把 hide_elements 拆件点亮）——该规则只属于
                // collectPenetrationMeshes 的热力图外层网格选取
                applyArmorViewStyle(getCollisionMode());
                getRenderer().autoClear = true;
                getRenderer().setRenderTarget(null);
                // HE 渐变仍需叠加层（默认视图 + HE + 爆点）→ 保留机械并切渐变语义；
                // 否则照旧释放。保留/释放统一由 syncHeatOverlay 裁决。
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
            // 深度遮罩对所有弹种保持开启：热力图只给相机可见的首层主装甲上色。
            // HE 也不能例外——否则后层主装甲的颜色会穿透前板叠到画面上，
            // 看起来像“着色落在主装甲上”，实际取的是后层板的伤害。
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
            // 切到非 HE 时清掉旧爆点/采样可视化；切回 HE 时保留到下一次点击。
            if (!isHE) {
                heHeatmapCenter = null;
                disposeHeSplashVisual();
                updateHeHeatmapUniforms();
            } else {
                // 切换 HE/HESH 弹种时爆炸半径会变：旧球的 SphereGeometry 半径必须重建，
                // 否则球面与当前热力图不一致（评审 P2）。爆点保留到下一次点击。
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
