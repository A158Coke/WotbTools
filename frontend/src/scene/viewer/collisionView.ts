import * as THREE from 'three'
import { applyArmorStateToMesh, replaceArmorMaterial } from './armorMeshState.js'
import { hasGunMask } from './armorPlateModel.js'
import { activePlateSet, controllablePlateSet, defaultStateId, dynamicDeclarationByTankId } from '../../data/armorStates.js'
import type { ArmorStateSection } from './armorMeshState.js'
import type { ModelReferences } from './modelLifecycle.js'
import type { TankArmorConfig } from './armorPlateModel.js'
import type { TankData } from './viewerContracts.js'

export interface CollisionHeatmapHandle {
    applyArmorStateToHeatmapClones(activeSet: ReadonlySet<string>): void
    rebuildRicochetPack(): void
    getGunClipPlane(): THREE.Plane | null
    computeGunClipPlane(): void
    getPrimaryArmorScene(): THREE.Scene | null
}

export interface CollisionRigHandle {
    applyConfigVisible(model: THREE.Object3D, gunIndex: number, turretIndex: number): void
    updateTurretGun(turretDeg: number, gunDeg: number): void
    alignArmorModules(): void
    getLastAppliedTurretDeg(): number
    getLastAppliedGunDeg(): number
}

export interface CollisionModelLifecycleHandle {
    retagSpacedSections(root: THREE.Object3D): void
}

export interface CollisionViewDeps {
    models: ModelReferences
    getModuleMeshes: () => THREE.Object3D[]
    hmRef: () => CollisionHeatmapHandle
    rig: CollisionRigHandle
    ml: CollisionModelLifecycleHandle
    getTankData: () => TankData
    getCurrentConfig: () => TankArmorConfig | null
    getActiveGunNumber: () => number | null
    getPenetrationMode: () => boolean
    getCollisionMode: () => boolean
    getPlateThickness: (section: string, plateId: string) => number | null
    thicknessToColor: (thickness: number | null | undefined) => number
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
                    mat.needsUpdate = true;
                }
            }
        }

function applyModuleCollisionMaterial(on: boolean): void {
            for (const node of getModuleMeshes()) {
                const mesh = node as THREE.Mesh;
                if (on) {
                    if (!moduleOriginalMaterials.has(mesh)) moduleOriginalMaterials.set(mesh, mesh.material);
                    const t = Number(mesh.userData.armorThickness);
                    const color = thicknessToColor(t);
                    const side = node.userData.moduleDoubleSided ? THREE.DoubleSide : THREE.FrontSide;
                    let mat = mesh.userData.collisionSolidMaterial as THREE.MeshStandardMaterial | undefined;
                    if (!mat) {
                        mat = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.6 });
                        mesh.userData.collisionSolidMaterial = mat;
                    } else {
                        mat.color.set(color);
                    }
                    mat.side = side;
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
            if (on) syncModuleClipPlanes();
        }

function applyArmorViewStyle(collision: boolean): void {
            if (!models.armorModel) return;
            if (collision) hmRef().computeGunClipPlane();
            applyModuleCollisionMaterial(collision);
            if (collision) {
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
            ml.retagSpacedSections(models.armorModel);
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
            alignArmorModulesFn();
            updateTurretGunFn(getLastAppliedTurretDegFn(), getLastAppliedGunDegFn());
        }

function setArmorState(stateId: number): void {
            if (!armorStateDecl) return;
            if (!stateEntries(armorStateDecl).some(function(s) { return s.id === stateId; })) return;
            armorStateCurrent = stateId;
            applyArmorStateToModel();
            applyCategoryFilters();
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
