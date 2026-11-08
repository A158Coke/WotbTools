// 装甲视图状态（#820 Agent A 出仓）：碰撞（厚度）视图样式、装甲分类过滤、
// 点击高亮与动态装甲（armorsStatesController）状态应用。
// 原 tankViewer.js 闭包内对应块整体平移；视图语义与状态机保持原样。
import * as THREE from 'three'
import { applyArmorStateToMesh, replaceArmorMaterial } from './armorMeshState.js'
import { hasGunMask } from './armorPlateModel.js'
import { activePlateSet, controllablePlateSet, defaultStateId, dynamicDeclarationByTankId } from '../../data/armorStates.js'
import type { ArmorStateSection } from './armorMeshState.js'
import type { ModelReferences } from './modelLifecycle.js'
import type { TankArmorConfig } from './armorPlateModel.js'
import type { TankData } from './viewerContracts.js'

/** 热力图 owner 中被本模块消费的句柄子集。 */
export interface CollisionHeatmapHandle {
    applyArmorStateToHeatmapClones(activeSet: ReadonlySet<string>): void
    rebuildRicochetPack(): void
    getGunClipPlane(): THREE.Plane | null
    computeGunClipPlane(): void
    getPrimaryArmorScene(): THREE.Scene | null
}

/** 炮塔 rig owner 中被本模块消费的句柄子集。 */
export interface CollisionRigHandle {
    applyConfigVisible(model: THREE.Object3D, gunIndex: number, turretIndex: number): void
    updateTurretGun(turretDeg: number, gunDeg: number): void
    alignArmorModules(): void
    getLastAppliedTurretDeg(): number
    getLastAppliedGunDeg(): number
}

/** 模型生命周期 owner 中被本模块消费的句柄子集。 */
export interface CollisionModelLifecycleHandle {
    retagSpacedSections(root: THREE.Object3D): void
}

export interface CollisionViewDeps {
    models: ModelReferences
    getModuleMeshes: () => THREE.Object3D[]
    /** 热力图管线（deferred：组合根完成装配前不会调用）。 */
    hmRef: () => CollisionHeatmapHandle
    rig: CollisionRigHandle
    ml: CollisionModelLifecycleHandle
    getTankData: () => TankData
    getCurrentConfig: () => TankArmorConfig | null
    getActiveGunNumber: () => number | null
    /** 击穿（热力图）视图模式。 */
    getPenetrationMode: () => boolean
    /** 碰撞（厚度）视图模式。 */
    getCollisionMode: () => boolean
    getPlateThickness: (section: string, plateId: string) => number | null
    thicknessToColor: (thickness: number | null | undefined) => number
    /** 有效可见性（judgment 口径，与点击判定一致）。 */
    isEffectivelyVisible: (node: THREE.Object3D) => boolean
}

export interface CollisionViewHandle {
    baseNodeVisible(node: THREE.Object3D): boolean
    resetArmorFilters(): void
    toggleCategory(name: string): boolean | null
    applyCategoryFilters(): void
    resetArmorHighlight(): void
    applyArmorHighlight(selected: THREE.Object3D | null): void
    applyArmorViewStyle(collision: boolean): void
    releaseModuleMaterialCaches(): void
    resolveArmorStateDecl(tankId: number | string | null | undefined): void
    updateArmorStateControl(): void
    applyArmorStateToModel(): void
    setArmorState(stateId: number): void
    syncArmorStateControl(): void
    nonDefaultStateId(decl: ArmorStateDeclRaw): number
    syncModuleClipPlanes(): void
    getHighlightedArmorNode(): THREE.Object3D | null
    setHighlightedArmorNode(v: THREE.Object3D | null): void
    getArmorStateDecl(): ArmorStateDeclRaw | null
}

type ArmorStateDeclRaw = NonNullable<ReturnType<typeof dynamicDeclarationByTankId>>
/** armorStates.js 的 JSDoc 只声明 states: object[]；本模块只消费 id/default。 */
interface ArmorStateEntry {
    id: number
    default?: boolean
    [key: string]: unknown
}

type ArmorCategory = 'primary' | 'spaced' | 'external'

export function createCollisionView(deps: CollisionViewDeps): CollisionViewHandle {
    const {
        models, getModuleMeshes, hmRef, rig, ml,
        getTankData, getCurrentConfig, getActiveGunNumber,
        getPenetrationMode, getCollisionMode, getPlateThickness, thicknessToColor,
        isEffectivelyVisible: isEffectivelyVisibleFn,
    } = deps
    const applyConfigVisibleFn = rig.applyConfigVisible;
    const updateTurretGunFn = rig.updateTurretGun;
    const alignArmorModulesFn = rig.alignArmorModules;
    const getLastAppliedTurretDegFn = rig.getLastAppliedTurretDeg;
    const getLastAppliedGunDegFn = rig.getLastAppliedGunDeg;
    const applyArmorStateToHeatmapClonesFn = (activeSet: ReadonlySet<string>) => hmRef().applyArmorStateToHeatmapClones(activeSet);
    const rebuildRicochetPackFn = () => hmRef().rebuildRicochetPack();
    const getGunClipPlaneFn = () => hmRef().getGunClipPlane();

        const hiddenCategories: Record<ArmorCategory, boolean> = { primary: false, spaced: false, external: false };


        const moduleOriginalMaterials = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>();

        let highlightedArmorNode: THREE.Object3D | null = null;

        let armorStateDecl: ArmorStateDeclRaw | null = null, armorStateCurrent: number | null = null;

        /** armorStates.js 的 states 元素在 JSDoc 层是 object；本模块消费的字段在此收窄。 */
        const stateEntries = (decl: ArmorStateDeclRaw): ArmorStateEntry[] => decl.states as ArmorStateEntry[];

function baseNodeVisible(node: THREE.Object3D): boolean {
            const mesh = node as THREE.Mesh;
            if (!mesh.isMesh) return false;
            if (mesh.userData.armorSection === 'deco') return false;
            if (mesh.userData.configHidden) return false;
            if (mesh.userData.armorStateHidden) return false;
            if (mesh.userData.armorSection === 'gunBarrel' && mesh.userData.gunConfig != null) {
                const act = getActiveGunNumber();
                if (act != null && mesh.userData.gunConfig !== act) return false;
            }
            return true;
        }

function resetArmorFilters(): void {
            const names: ArmorCategory[] = ['primary', 'spaced', 'external'];
            for (const name of names) {
                hiddenCategories[name] = false;
                const btn = document.getElementById('filter-' + name);
                if (btn) { btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true'); }
            }
        }

function toggleCategory(name: string): boolean | null {
            if (name !== 'primary' && name !== 'spaced' && name !== 'external') return null;
            hiddenCategories[name] = !hiddenCategories[name];
            const visible = !hiddenCategories[name];
            const btn = document.getElementById('filter-' + name);
            if (btn) { btn.classList.toggle('active', visible); btn.setAttribute('aria-pressed', String(visible)); }
            applyCategoryFilters();
            return visible;
        }

function applyCategoryFilters(): void {
            if (models.armorModel) {
                models.armorModel.traverse(function(node: THREE.Object3D) {
                    const mesh = node as THREE.Mesh;
                    if (!mesh.isMesh) return;
                    const sec = mesh.userData.armorSection;
                    let category: ArmorCategory | null = null;
                    if (sec === 'spaced') category = 'spaced';
                    else if (sec === 'hull' || sec === 'turret' || sec === 'gun') category = 'primary';
                    mesh.visible = baseNodeVisible(mesh) && !(category && hiddenCategories[category]);
                });
            }
            // BlitzKit 的“mask 无值 → 外部模块只取精确 gun_0X”规则只属于**装甲厚度视图**
            // 的外部模块：厚度视图把炮管/履带画成实心碰撞体，炮盾（gun_XX_mask）在无 mask
            // 值的车上不属于外部模块，需随外部模块口径隐藏；普通/击穿视图的视觉模型仍渲染
            // 全部部件（2026-10-28 用户报障：视觉模型缺件；厚度模式要求裁剪隐藏）。
            const cfg = getCurrentConfig();
            const hasMask = hasGunMask(cfg);
            const hideMaskPart = getCollisionMode() && !hasMask;
            for (const node of getModuleMeshes()) {
                node.visible = baseNodeVisible(node)
                    && !hiddenCategories.external
                    && !(hideMaskPart && node.userData.gunMaskPart);
            }
            if (getCollisionMode() && highlightedArmorNode && !isEffectivelyVisibleFn(highlightedArmorNode)) {
                resetArmorHighlight();
                const card = document.getElementById('click-info');
                if (card) card.style.display = 'none';
            }
        }

function collectHighlightMeshes(): THREE.Mesh[] {
            const list: THREE.Mesh[] = [];
            if (models.armorModel) {
                models.armorModel.traverse(function(node: THREE.Object3D) {
                    const mesh = node as THREE.Mesh;
                    if (!mesh.isMesh || mesh.userData.armorSection === 'deco') return;
                    list.push(mesh);
                });
            }
            for (const node of getModuleMeshes()) list.push(node as THREE.Mesh);
            return list;
        }

function applyArmorMaterialState(m: THREE.Material, transparent: boolean, opacity: number, depthWrite: boolean): void {
            if (m.transparent !== transparent || m.depthWrite !== depthWrite) m.needsUpdate = true;
            m.transparent = transparent;
            m.opacity = opacity;
            m.depthWrite = depthWrite;
        }

function resetArmorHighlight(): void {
            highlightedArmorNode = null;
            // 普通/击穿视图的装甲材质是“透明覆盖层”，不能套用碰撞视图的透明度复位
            if (!getCollisionMode() || !models.armorModel) return;
            const modules = new Set<THREE.Object3D>(getModuleMeshes());
            for (const node of collectHighlightMeshes()) {
                const m = node.material;
                if (!m || Array.isArray(m)) continue;
                applyArmorMaterialState(m, true, modules.has(node) ? 1 : 0.95, true);
                const em = m as THREE.MeshStandardMaterial;
                if (em.emissive) { em.emissive.setHex(0x000000); em.emissiveIntensity = 0; }
            }
        }

function applyArmorHighlight(selected: THREE.Object3D | null): void {
            const modules = new Set<THREE.Object3D>(getModuleMeshes());
            for (const node of collectHighlightMeshes()) {
                const m = node.material;
                if (!m || Array.isArray(m)) continue;
                if (node === selected) {
                    // 高亮只靠"选中板保持不透明、其余压暗"：不改厚度色相（用户 2026-10-28
                    // 报障：金色自发光让被点板颜色与点击前不一致）。
                    applyArmorMaterialState(m, true, 1, true);
                    const em = m as THREE.MeshStandardMaterial;
                    if (em.emissive) { em.emissive.setHex(0x000000); em.emissiveIntensity = 0; }
                } else {
                    applyArmorMaterialState(m, true, modules.has(node) ? 0.15 : 0.18, false);
                    const em = m as THREE.MeshStandardMaterial;
                    if (em.emissive) { em.emissive.setHex(0x000000); em.emissiveIntensity = 0; }
                }
            }
            highlightedArmorNode = selected;
        }

function syncModuleClipPlanes(): void {
            for (const node of getModuleMeshes()) {
                const mesh = node as THREE.Mesh;
                const mat = mesh.userData.collisionSolidMaterial as THREE.MeshStandardMaterial | undefined;
                if (!mat || mesh.material !== mat) continue;
                let clipPlanes: THREE.Plane[] | null = null;
                if (mesh.userData.armorSection === 'gunBarrel') {
                    const plane = getGunClipPlaneFn();
                    if (plane) clipPlanes = [plane];
                }
                const hadClip = !!(mat.clippingPlanes && mat.clippingPlanes.length);
                if (hadClip !== !!clipPlanes) {
                    mat.clippingPlanes = clipPlanes;
                    mat.needsUpdate = true;   // 裁剪面有无切换会换 shader 变体
                }
            }
        }

function applyModuleCollisionMaterial(on: boolean): void {
            for (const node of getModuleMeshes()) {
                const mesh = node as THREE.Mesh;
                if (on) {
                    if (!moduleOriginalMaterials.has(mesh)) moduleOriginalMaterials.set(mesh, mesh.material);
                    const t = Number(mesh.userData.armorThickness);
                    const color = thicknessToColor(Number.isFinite(t) ? t : 0);
                    const side = node.userData.moduleDoubleSided ? THREE.DoubleSide : THREE.FrontSide;
                    let mat = mesh.userData.collisionSolidMaterial as THREE.MeshStandardMaterial | undefined;
                    if (!mat) {
                        mat = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.6 });
                        mesh.userData.collisionSolidMaterial = mat;
                    } else {
                        mat.color.set(color);
                    }
                    // 双面模块（履带）保留客户端的双面口径：厚度视图里上表面仍可见
                    mat.side = side;
                    // 复用缓存材质时恢复高亮可能改过的透明/深度状态：离开厚度视图会先
                    // 清 getCollisionMode()，resetArmorHighlight 提前返回；不恢复的话再次进入
                    // 时外部模块仍是半透明且不写深度。
                    mat.transparent = false;
                    mat.opacity = 1;
                    mat.depthWrite = true;
                    mat.depthTest = true;
                    mat.needsUpdate = true;
                    mesh.material = mat;
                } else if (moduleOriginalMaterials.has(mesh)) {
                    const original = moduleOriginalMaterials.get(mesh);
                    if (original) mesh.material = original;
                    moduleOriginalMaterials.delete(mesh);
                }
            }
            // 厚度视图的炮管外部模块按 gun_mask 平面裁剪（与热力图外部模块 clone 同一
            // 口径）：掩体平面之后的炮尾/炮根段不显示，避免整根炮管插进炮塔。
            if (on) syncModuleClipPlanes();
        }

function applyArmorViewStyle(collision: boolean): void {
            // visual 与 armor 两个 GLB 独立完成；getCollisionMode() 可能在 armor 就绪前已开启。
            // armor 未就绪时直接返回，等 armor 完成回调里的 applyConfig 再刷新材质。
            if (!models.armorModel) return;
            // 厚度视图的炮管实心体按当前配置的 gun_mask 平面裁剪：与热力图外部模块 clone
            // 同一实现，进视图/换配置时先重算平面
            if (collision) hmRef().computeGunClipPlane();
            applyModuleCollisionMaterial(collision);
            if (collision) {
                // 碰撞视图保留外部模块（炮管/履带）的碰撞体，隐藏其余视觉网格。
                // 用逐节点标记而不是一次性数组：切配置会重复调用本函数，数组清空后会丢掉
                // 已经隐藏的节点，退出碰撞视图时坦克就再也显示不回来（用户 2026-10-28 报障）。
                if (models.tankModel) {
                    models.tankModel.visible = true;
                    const keep = new Set(getModuleMeshes());
                    models.tankModel.traverse(function(node: THREE.Object3D) {
                        const mesh = node as THREE.Mesh;
                        if (!mesh.isMesh || keep.has(mesh)) return;
                        if (!mesh.visible) return;
                        node.userData.collisionHidden = true;
                        mesh.visible = false;
                    });
                }
            } else {
                if (models.tankModel) {
                    models.tankModel.visible = true;
                    models.tankModel.traverse(function(node: THREE.Object3D) {
                        const mesh = node as THREE.Mesh;
                        if (!mesh.isMesh || node.userData.collisionHidden !== true) return;
                        node.userData.collisionHidden = false;
                        mesh.visible = true;
                    });
                    // 碰撞视图期间可能换过炮塔/炮：按当前配置重置视觉部件可见性
                    const cfg = getCurrentConfig();
                    applyConfigVisibleFn(models.tankModel, cfg ? cfg.gun_index ?? 0 : 0, cfg ? cfg.turret_index ?? 0 : 0);
                }
            }
            models.armorModel.traverse(function(node: THREE.Object3D) {
                const mesh = node as THREE.Mesh;
                if (!mesh.isMesh) return;
                if (mesh.userData.armorSection === 'deco') { mesh.visible = false; return; }
                replaceArmorMaterial(mesh, collision
                    ? new THREE.MeshStandardMaterial({
                        color: thicknessToColor(mesh.userData.armorThickness), metalness: 0.4, roughness: 0.6,
                        transparent: true, opacity: 0.95, depthWrite: true,
                        // 间隙甲双面：厚度视图下从背面看/点也可见（与判定/高亮口径一致）
                        side: node.userData.armorSection === 'spaced' ? THREE.DoubleSide : THREE.FrontSide,
                    })
                    : new THREE.MeshStandardMaterial({
                        color: 0x444444, metalness: 0.3, roughness: 0.8,
                        transparent: true, opacity: 0, depthWrite: false,
                    }));
            });
            applyCategoryFilters();
        }

function resolveArmorStateDecl(tankId: number | string | null | undefined): void {
            armorStateDecl = dynamicDeclarationByTankId(tankId);
            armorStateCurrent = armorStateDecl ? defaultStateId(armorStateDecl) : null;
            updateArmorStateControl();
        }

function updateArmorStateControl(): void {
            const opt = document.getElementById('armor-state-opt');
            const box = document.getElementById('armor-state-toggle') as HTMLInputElement | null;
            if (!opt || !box) return;
            if (!armorStateDecl) {
                opt.style.display = 'none';
                box.checked = false;
                box.disabled = false;
                box.title = '';
                return;
            }
            const nonDefault = nonDefaultStateId(armorStateDecl);
            box.checked = armorStateCurrent === nonDefault;
            box.disabled = false;
            box.title = '';
            opt.style.display = '';
        }

function applyArmorStateToModel(): void {
            if (!models.armorModel || !armorStateDecl || armorStateCurrent == null) return;
            ml.retagSpacedSections(models.armorModel);   // 常驻板整体还原（含 spaced 重判）；可控板由下方接管
            const active = activePlateSet(armorStateDecl, armorStateCurrent);
            const controllable = controllablePlateSet(armorStateDecl);
            const am = getTankData().armor_model || {};
            const cfg = getCurrentConfig();
            const spacedBySection: Record<ArmorStateSection, Set<string>> = {
                hull: new Set((getTankData().hull_spaced ?? am.hull?.spaced ?? []).map(String)),
                turret: new Set((cfg?.turret_spaced ?? []).map(String)),
                gun: new Set((cfg?.gun_spaced ?? []).map(String)),
            };
            models.armorModel.traverse(function(node: THREE.Object3D) {
                const mesh = node as THREE.Mesh;
                if (!mesh.isMesh) return;
                // 可控板按**网格名**识别（含 state_XX 前缀命名，如 hull_state_01_armor_10）——
                // 这类网格被 tagArmorPlates 的 /state_01/ 规则打成 deco 且无 armorSectionOrig/
                // thickness=0，依赖 orig 的过滤会漏掉它们（切态后永不被点亮，实测踩坑）。
                const m = (mesh.name || '').match(/(hull|turret|gun)_\w*?_?armor_(\d+)/);
                if (!m || !m[1] || !m[2]) return;
                const section = m[1] as ArmorStateSection;
                const plateId = m[2];
                const key = section + ':' + plateId;
                if (!controllable.has(key)) return;
                applyArmorStateToMesh(mesh, {
                    key, plateId, section,
                    active: active.has(key),
                    spaced: spacedBySection[section].has(plateId),
                    collisionMode: getCollisionMode(),
                    thicknessOf: getPlateThickness,
                    colorOf: thicknessToColor,
                });
            });
            // 新激活的板此前被 deco 跳过了枢轴安装（alignArmorModules 的正则原不含
            // state_XX 段）——厚度/orig 就位后统一重装。随后**必须重放当前姿态**：
            // installPivot 的 mesh.updateMatrix() 按 position 组合矩阵，会清掉
            // updateTurretGun 写入的炮塔/炮管旋转（板为 matrixAutoUpdate=false、姿态
            // 全在 .matrix 里）——不清回来就是「炮塔回默认位」（热力图 clones 经
            // syncCloneMatrices 如实镜像该错误姿态，即击穿视图闪烁后回默认的现象）。
            alignArmorModulesFn();
            // 重放**最近实际应用**的姿态（回放弹着态会设非零炮塔/炮管角——
            // currentTurretDeg 只跟踪手动瞄准/URL，用它会把回放姿态打回 0°，review P2-1）
            updateTurretGunFn(getLastAppliedTurretDegFn(), getLastAppliedGunDegFn());
        }

function setArmorState(stateId: number): void {
            if (!armorStateDecl) return;
            if (!stateEntries(armorStateDecl).some(function(s) { return s.id === stateId; })) return;
            armorStateCurrent = stateId;
            applyArmorStateToModel();
            applyCategoryFilters();
            // 板集变了 → 翻可控板 clone 可见性（零重建：无材质/着色器编译 → 无闪烁）+
            // 重建跳弹几何（纯几何：源网格 deco 口径已随态更新，无编译开销）。
            // 机械存在（击穿视图或默认视图 HE 渐变）时都要跟进，否则渐变停在旧板集。
            if ((getPenetrationMode() || hmRef().getPrimaryArmorScene()) && models.armorModel) {
                applyArmorStateToHeatmapClonesFn(activePlateSet(armorStateDecl, stateId));
                rebuildRicochetPackFn();
            }
            syncArmorStateControl();
        }

function nonDefaultStateId(decl: ArmorStateDeclRaw): number {
            const states = stateEntries(decl);
            const nd = states.find(function(s) { return !s.default; });
            const first = nd || states[0];
            return first ? first.id : 0;
        }

function syncArmorStateControl(): void {
            const box = document.getElementById('armor-state-toggle') as HTMLInputElement | null;
            if (!box || !armorStateDecl) return;
            box.checked = armorStateCurrent === nonDefaultStateId(armorStateDecl);
        }

function releaseModuleMaterialCaches(): void {
            const released = new Set<THREE.Material>();
            const release = (value: THREE.Material | THREE.Material[] | null | undefined): void => {
                const materials: Array<THREE.Material | null | undefined> = Array.isArray(value) ? value : [value];
                for (const material of materials) {
                    if (!material || released.has(material)) continue;
                    released.add(material);
                    for (const child of Object.values(material)) {
                        if (child && child.isTexture && typeof child.dispose === 'function') child.dispose();
                    }
                    if (typeof material.dispose === 'function') material.dispose();
                }
            };
            for (const material of moduleOriginalMaterials.values()) release(material);
            moduleOriginalMaterials.clear();
            for (const node of getModuleMeshes()) {
                release(node.userData.collisionSolidMaterial);
                node.userData.collisionSolidMaterial = null;
            }
        }
    return {
        baseNodeVisible, resetArmorFilters, toggleCategory, applyCategoryFilters,
        resetArmorHighlight, applyArmorHighlight,
        applyArmorViewStyle, releaseModuleMaterialCaches,
        resolveArmorStateDecl, updateArmorStateControl, applyArmorStateToModel,
        setArmorState, syncArmorStateControl, nonDefaultStateId, syncModuleClipPlanes,
        getHighlightedArmorNode: () => highlightedArmorNode,
        setHighlightedArmorNode: (v) => { highlightedArmorNode = v; },
        getArmorStateDecl: () => armorStateDecl,
    };
}
