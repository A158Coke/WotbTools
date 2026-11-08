// 穿透热力图 / 装甲渲染管线（#820 Agent A 出仓）：RT 机械、间隙甲/主装甲/状态通道
// 场景、跳弹续飞网格、HE 溅射可视化与逐帧渲染 pass 的唯一 owner。
// 原 tankViewer.js 闭包内对应函数整体平移；材质语义注释见 viewer/armorShaders.ts。
import * as THREE from 'three'
import {
    RC, buildPack, snapshotPackPose, packPoseChanged, buildRicochetGrid, createGridTextures,
    type CollisionPack, type PackEntry, type RicochetGrid,
} from '../armorCollisionPack.js'
import {
    shellTypeOf, shellAngles, rolledPenetration, hasGunMask,
    partitionArmorMeshes, selectExternalMeshes, gunMaskOriginModel,
    populateSpacedArmorScene, populateSpacedStateScene, populatePrimaryArmorScene,
} from './armorPlateModel.js'
import { createArmorShaderContext, createDepthStencilTexture } from './armorShaders.js'
import { shotBallisticLength } from '../agentData.js'
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

type RicochetGridTextured = RicochetGrid & { textures?: ReturnType<typeof createGridTextures> }

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
        getFxScene, getScene, applyCategoryFilters: applyCategoryFiltersFn,
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
    let heSplashGroup: THREE.Group | null = null;      // 溅射半径球面（无 800 方向线）
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
    let ricochetPack: CollisionPack | null = null;
    let ricochetGrid: RicochetGridTextured | null = null;          // 网格加速结构（含纹理）
    let ricochetPoseDirty = true;     // 几何姿态变化（炮塔/配置/模型）→ 需重建网格
    let ricochetPoseSnapshot: number[][] | null = null;
    let ricochetFailedPose: number[][] | null = null;
    let ricochetGridGeneration = 0;
    let ricochetPackReason = '';      // 最近一次失败原因（钩子透出，排查用）
    let ricochetGridRetries = 0;
    const RC_GRID_RETRY_MAX = 240;   // ~4s @60fps：矩阵就位的宽限期
    const omitMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true });
    // 间隙甲深度占位也必须双面：背面命中的间隙屏要参与遮挡/深度（与着色双面一致）。
    const spacedOmitMaterial = new THREE.MeshBasicMaterial({
        colorWrite: false, depthTest: true, depthWrite: true, side: THREE.DoubleSide,
    });
    const excludeMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthTest: true, depthWrite: true });
    const externalDepthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true });

function disposeHeSplashVisual(): void {
            if (!heSplashGroup) return;
            getFxScene().remove(heSplashGroup);
            heSplashGroup.traverse((o) => {
                const mesh = o as THREE.Mesh;
                if (mesh.geometry) mesh.geometry.dispose();
                const mat = mesh.material as THREE.Material | undefined;
                if (mat) mat.dispose();
            });
            heSplashGroup = null;
        }

function updateHeSplashVisual(center: THREE.Vector3 | null, radius: number) {
            disposeHeSplashVisual();
            if (!getScene() || !center || !(radius > 0)) return;
            const group = new THREE.Group();
            group.position.copy(center);
            group.userData.radius = radius;
            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(radius, 48, 24),
                new THREE.MeshBasicMaterial({
                    color: 0xffaa00, transparent: true, opacity: 0.07,
                    depthWrite: false, depthTest: false, side: THREE.DoubleSide,
                }),
            );
            sphere.raycast = () => {};
            // renderOrder 不随父级继承，必须写在 mesh 上：球壳先画（996），轨迹线/命中
            // 标记后画，否则按距离排序可能让球壳的橙色薄涂在轨迹线上。
            sphere.renderOrder = 996;
            group.add(sphere);
            group.visible = getPenetrationMode();
            getFxScene().add(group);
            heSplashGroup = group;
        }

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

function updateHeatMaskUniforms(on: boolean) {
            if (!primaryArmorScene) return;
            primaryArmorScene.traverse(function(node) {
                const mesh = node as THREE.Mesh;
                const mat = mesh.material as THREE.ShaderMaterial | undefined;
                if (mesh.isMesh && mat && mat.uniforms && mat.uniforms.heatmapMask) {
                    mat.uniforms.heatmapMask.value = on;
                }
            });
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

function disposeMaterial(mat: THREE.Material | null) {
            if (!mat) return;
            const shader = mat as THREE.ShaderMaterial;
            if (shader.uniforms) {
                for (const u of Object.values(shader.uniforms)) {
                    const v = u.value as THREE.Texture | null | undefined;
                    if (v && v.isTexture && v !== emptySpacedTexture() && !v.isRenderTargetTexture) v.dispose();
                }
            }
            const mapped = mat as THREE.MeshBasicMaterial;
            if (mapped.map && mapped.map.isTexture && mapped.map !== emptySpacedTexture()) mapped.map.dispose();
            mat.dispose();
        }

function disposeSceneMaterials(scene: THREE.Scene | null) {
            if (!scene) return;
            scene.traverse(function(node){
                const mesh = node as THREE.Mesh;
                if (mesh.isMesh) {
                    const mat = mesh.material as THREE.ShaderMaterial | undefined;
                    if (mat && mat.uniforms) disposeMaterial(mat);
                }
            });
            scene.clear();
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
            disposeRicochetGrid();
            ricochetPack = null;
            ricochetGrid = null;
            ricochetPoseSnapshot = null;
            ricochetFailedPose = null;
            ricochetPoseDirty = true;
            rcUniforms.rcWorldTris.value = null;
            rcUniforms.rcGridCells.value = null;
            rcUniforms.rcGridEntries.value = null;
            rcUniforms.rcEnabled.value = false;
            rcUniforms.rcMode.value = 0;
        }

function collectRicochetEntries() {
            const list: PackEntry[] = [];
            if (!models.armorModel) return list;
            models.armorModel.traverse(function(node) {
                const mesh = node as THREE.Mesh;
                if (!mesh.isMesh) return;
                const sec = node.userData.armorSection;
                if (sec !== 'hull' && sec !== 'turret' && sec !== 'gun' && sec !== 'spaced') return;
                if (node.userData.configHidden) return;
                if (node.parent && node.parent.visible === false) return;
                const t = node.userData.armorThickness;
                if (typeof t !== 'number') return;
                list.push({ mesh: mesh, section: sec, thickness: t, variant: null });
            });
            const act = getActiveGunNumber();
            const cfg = getCurrentConfig();
            const hasMask = hasGunMask(cfg);
            getModuleMeshes().forEach(function(node) {
                const mesh = node as THREE.Mesh;
                if (!mesh.isMesh) return;
                if (node.userData.gunConfig != null && act != null && node.userData.gunConfig !== act) return;
                if (node.userData.gunMaskPart && !hasMask) return;
                if (node.parent && node.parent.visible === false) return;
                const t = node.userData.armorThickness;
                if (typeof t !== 'number') return;
                const sec = node.userData.armorSection;   // 'chassis' | 'gunBarrel'
                if (sec !== 'chassis' && sec !== 'gunBarrel') return;
                list.push({ mesh: mesh, section: sec, thickness: t, variant: sec === 'chassis' ? 'track' : 'gun' });
            });
            return list;
        }

function rebuildRicochetPack() {
            disposeRicochetGrid();
            ricochetPack = null;
            ricochetPoseSnapshot = null;
            ricochetFailedPose = null;
            ricochetPackReason = '';
            rcUniforms.rcEnabled.value = false;
            rcUniforms.rcMode.value = 0;
            updateCollisionWorldMatrices();
            const entries = collectRicochetEntries();
            const pack = buildPack(entries);
            if (!pack.ok) {
                // fail-closed：超限/非刚性 → 续飞整体关闭，跳弹维持紫色（现状行为）
                ricochetPackReason = pack.reason + ' (entries=' + entries.length + ')';
                console.warn('[armor-ricochet] continuation disabled:', ricochetPackReason);
                return;
            }
            ricochetPack = pack;
            ricochetGridRetries = 0;
            rebuildRicochetGrid();
            const sh = getSelectedShell() || (getShooterShells()[0]) || null;
            if (sh) syncRicochetEnabled(sh);
        }

function rebuildRicochetGrid() {
            if (!ricochetPack) return false;
            const grid = buildRicochetGrid(ricochetPack);
            if (!grid.ok) {
                disposeRicochetGrid();
                rcUniforms.rcEnabled.value = false;
                rcUniforms.rcMode.value = 0;
                ricochetPackReason = grid.reason;
                ricochetGridRetries++;
                if (ricochetGridRetries >= RC_GRID_RETRY_MAX) {
                    rcUniforms.rcEnabled.value = false;
                    ricochetPoseDirty = false;
                    ricochetFailedPose = snapshotPackPose(ricochetPack); // 新姿态才重新尝试
                    console.warn('[armor-ricochet] grid disabled after retries:', grid.reason);
                    return false;
                }
                ricochetPoseDirty = true;        // 矩阵可能未就位 → 下一帧重试
                return false;
            }
            ricochetGridRetries = 0;
            disposeRicochetGrid();
            const tex = createGridTextures(grid);
            (grid as RicochetGridTextured).textures = tex;
            ricochetGrid = grid;
            rcUniforms.rcWorldTris.value = tex.worldTrisTex;
            rcUniforms.rcTriRows.value = grid.triRows;
            rcUniforms.rcGridCells.value = tex.cellsTex;
            rcUniforms.rcGridEntries.value = tex.entriesTex;
            (rcUniforms.rcGridMin.value as THREE.Vector3).set(grid.gridMin[0], grid.gridMin[1], grid.gridMin[2]);
            rcUniforms.rcCell.value = grid.cellSize;
            (rcUniforms.rcGridDimsF.value as THREE.Vector3).set(grid.dims[0], grid.dims[1], grid.dims[2]);
            rcUniforms.rcCellRows.value = Math.ceil(grid.cellTotal / RC.CELL_ROW);
            rcUniforms.rcEntryRows.value = Math.ceil(grid.entryTotal / RC.ENTRY_ROW);
            rcUniforms.rcEntryTotal.value = grid.entryTotal;
            ricochetPoseSnapshot = snapshotPackPose(ricochetPack);
            ricochetFailedPose = null;
            ricochetPackReason = '';
            ricochetGridGeneration++;
            ricochetPoseDirty = false;
            return true;
        }

function disposeRicochetGrid() {
            if (ricochetGrid?.textures) {
                for (const texture of Object.values(ricochetGrid.textures)) texture.dispose();
            }
            ricochetGrid = null;
            ricochetPoseSnapshot = null; // a disposed grid has no valid successful-pose snapshot
            rcUniforms.rcWorldTris.value = null;
            rcUniforms.rcGridCells.value = null;
            rcUniforms.rcGridEntries.value = null;
        }

function updateCollisionWorldMatrices() {
            // 只传播矩阵；syncTransforms 会重新收集/对齐模块，不能作为每帧准备。
            models.armorModel?.updateWorldMatrix(true, true);
            models.tankModel?.updateWorldMatrix(true, true);
            getCamera().updateWorldMatrix(true, false);
        }

function prepareRicochetFrame() {
            // 传播门控在 pack 上：packPoseChanged / raycastPackAll 这类 CPU 矩阵读者都以
            // ricochetPack 存在为前提；无 pack（未进热力图）时无本帧 CPU 读者，传播交给
            // getRenderer().render 的根遍历（显示分支各自自更新），不为每帧白付两棵全树重算。
            if (ricochetPack) {
                updateCollisionWorldMatrices();
                const changed = packPoseChanged(ricochetPack, ricochetPoseSnapshot);
                const retryStopped = ricochetFailedPose && !packPoseChanged(ricochetPack, ricochetFailedPose);
                if (ricochetPoseDirty || (changed && !retryStopped)) {
                    if (ricochetFailedPose) {
                        ricochetGridRetries = 0;
                        ricochetFailedPose = null;
                    }
                    rebuildRicochetGrid();
                }
            }
            const sh = getSelectedShell() || getShooterShells()[0];
            if (sh) syncRicochetEnabled(sh);
        }

function syncRicochetEnabled(sh: ShellSpec) {
            const t = shellTypeOf(sh);
            const on = !!ricochetPack && !!ricochetGrid && (t === 'ap' || t === 'apcr');
            rcUniforms.rcEnabled.value = on;
            rcUniforms.rcMode.value = on ? 1 : 0;
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
                if (heSplashGroup) heSplashGroup.visible = false;
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
            if (heSplashGroup) heSplashGroup.visible = true;
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
                if (heSplashGroup && heHeatmapCenter && nextRadius > 0
                    && heSplashGroup.userData.radius !== nextRadius) {
                    updateHeSplashVisual(heHeatmapCenter, nextRadius);
                } else if (heSplashGroup && !(nextRadius > 0)) {
                    disposeHeSplashVisual();
                } else if (heSplashGroup) {
                    heSplashGroup.visible = getPenetrationMode();
                }
            }
        }

function refreshPenetrationResolution() {
            const c = getRenderer().domElement;
            const apply = (obj: THREE.Scene) => obj.traverse(function(node) {
                const mesh = node as THREE.Mesh;
                const mat = mesh.material as THREE.ShaderMaterial | undefined;
                if (mesh.isMesh && mat && mat.uniforms && mat.uniforms.resolution) {
                    mat.uniforms.resolution.value.set(c.width, c.height);
                    if (mat.uniforms.metersPerUnit) {
                        mat.uniforms.metersPerUnit.value = getWorldMetersPerUnit() || 1;
                    }
                }
            });
            if (primaryArmorScene) apply(primaryArmorScene);
        }

function updatePenetrationDistanceUniforms() {
            const sh = getSelectedShell();
            if (!sh) return;
            const near = sh.penetration || 0;
            const isHE = shellTypeOf(sh) === 'he';
            const { penMul } = equipmentCoeffs();
            const origin = getCamera().position;
            const world = new THREE.Vector3();
            // 射击复现：弹道长度是单值事件量——逐板同值（板间差 ≤ 车体尺度 ~10m，
            // 在 100→500m 衰减窗口内 ≤0.4mm；与判定同源，用户裁定 2026-10-13）。
            // 静态检视：逐板 = 相机 → 板包围球中心。
            const shotLenForUniforms = (window.__shotCtx && window.__shotCtx.shot)
                ? shotBallisticLength(window.__shotCtx.shot) * (getWorldMetersPerUnit() || 1) : 0;
            const apply = (scene: THREE.Scene | null) => {
                if (!scene) return;
                scene.traverse(function(node) {
                    const mesh = node as THREE.Mesh;
                    const mat = mesh.material as THREE.ShaderMaterial | undefined;
                    if (!mesh.isMesh || !mat || !mat.uniforms || !mat.uniforms.penetration) return;
                    const src = node.userData._src as THREE.Object3D | null | undefined;
                    if (src) {
                        const g = mesh.geometry as THREE.BufferGeometry;
                        if (!g.boundingSphere) g.computeBoundingSphere();
                        src.updateWorldMatrix(true, false);
                        world.copy(g.boundingSphere!.center).applyMatrix4(src.matrixWorld);
                    } else {
                        world.setFromMatrixPosition(node.matrixWorld);
                    }
                    const d = shotLenForUniforms > 0 ? shotLenForUniforms : origin.distanceTo(world);
                    mat.uniforms.penetration.value =
                        rolledPenetration(near, sh.penetration_far, d, isHE) * penMul;
                });
            };
            apply(primaryArmorScene);
            apply(spacedArmorScene);
            apply(spacedStateScene);
        }

function renderSpacedArmorPass() {
            if (!spacedArmorScene) return;
            const rt = syncPenetrationRT();
            const srt = ensureSpacedStateRT();
            if (!srt) return;
            syncCloneMatrices(spacedArmorScene);
            syncCloneMatrices(spacedStateScene);
            computeGunClipPlane();
            // gun_mask 裁切面同步到续飞着色器：与点击/JS 参考同一判据，只滤 gunBarrel。
            if (gunClipPlane) {
                rcUniforms.rcClipPlane.value.set(
                    gunClipPlane.normal.x, gunClipPlane.normal.y, gunClipPlane.normal.z, gunClipPlane.constant);
                rcUniforms.rcClipEnabled.value = true;
            } else {
                rcUniforms.rcClipEnabled.value = false;
            }
            // ① 状态通道：主装甲深度 → 最近间隙板独占写 R/G（A=0）→ 更近的外部模块写
            //    A=1（RGB 保留：模块后间隙板的跳弹/续飞状态不被覆盖）
            if (spacedStateScene) {
                getRenderer().autoClear = true;
                getRenderer().setRenderTarget(srt);
                getRenderer().setClearColor(0x000000, 0);
                getRenderer().render(spacedStateScene, getCamera());
            }
            // ② 厚度通道：全板 additive（逐层 normalized effective 累计）；状态缓冲留给 PBR 解读
            const rtIsFloat = spacedRTFloatCapable();
            const inject = (obj: THREE.Object3D) => { obj.traverse(function(node){
                const mesh = node as THREE.Mesh;
                const mat = mesh.material as THREE.ShaderMaterial | undefined;
                if (mesh.isMesh && mat && mat.uniforms && mat.uniforms.spacedArmorBuffer) {
                    mat.uniforms.spacedArmorBuffer.value = rt.texture;
                    if (mat.uniforms.spacedStateBuffer) mat.uniforms.spacedStateBuffer.value = srt.texture;
                    if (mat.uniforms.spacedSatGuard) mat.uniforms.spacedSatGuard.value = rtIsFloat ? 0 : 1;
                    if (mat.uniforms.spacedArmorDepth && rt.depthTexture) mat.uniforms.spacedArmorDepth.value = rt.depthTexture;
                    if (mat.uniforms.inverseProjectionMatrix) mat.uniforms.inverseProjectionMatrix.value = getCamera().projectionMatrixInverse;
                }
            }); };
            if (primaryArmorScene) inject(primaryArmorScene);
            getRenderer().autoClear = true;
            getRenderer().setRenderTarget(rt);
            getRenderer().setClearColor(0x000000, 0);
            getRenderer().render(spacedArmorScene, getCamera());
            getRenderer().autoClear = false;
            getRenderer().setRenderTarget(null);
            // scene.background=null 时 autoClear=false 不会隐式清屏；显式清理默认 framebuffer，
            // 避免热力图相机移动时复用上一帧颜色/深度（拖影/新几何被旧深度拒绝）。
            getRenderer().clear(true, true, true);
        }
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
        getRicochetPack: () => ricochetPack,
        getRicochetGrid: () => ricochetGrid,
        isRicochetPoseDirty: () => ricochetPoseDirty,
        getRicochetGridGeneration: () => ricochetGridGeneration,
        getRicochetPackReason: () => ricochetPackReason,
        getRicochetPoseSnapshot: () => ricochetPoseSnapshot,
        getPenetrationRT: () => penetrationRT,
        /** rig 姿态已变：下一次跳弹/HE 溅射查询不得复用旧碰撞几何。 */
        invalidateRicochetPose() { ricochetPoseDirty = true; },
        /** HE 溅射采样的碰撞几何（与点击主链同一包/网格口径；姿态脏时现场构建临时件）。 */
        buildSplashGeometry() {
            const pack = (!ricochetPoseDirty && ricochetPack)
                ? ricochetPack
                : buildPack(collectRicochetEntries());
            const grid = (pack === ricochetPack && ricochetGrid)
                ? ricochetGrid
                : buildRicochetGrid(pack);
            return { pack, grid };
        },
    };
}
