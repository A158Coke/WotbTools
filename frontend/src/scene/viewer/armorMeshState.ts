import * as THREE from 'three'
import type { Mesh } from 'three'

export type ArmorStateSection = 'hull' | 'turret' | 'gun'

export interface ArmorMeshStateParams {
    key: string
    plateId: string
    section: ArmorStateSection
    active: boolean
    spaced: boolean
    collisionMode: boolean
    thicknessOf: (section: string, plateId: string) => number | null
    colorOf: (t: number | null | undefined) => number
}

export function replaceArmorMaterial(node: Mesh, material: THREE.Material): void {
    if (node.userData.armorMaterialOwned && node.material && typeof (node.material as THREE.Material).dispose === 'function') {
        (node.material as THREE.Material).dispose();
    }
    node.material = material;
    node.userData.armorMaterialOwned = true;
}

export function applyArmorStateToMesh(node: Mesh, p: ArmorMeshStateParams): void {
    node.userData.armorStateKey = p.key;
    node.userData.armorStateSection = p.spaced ? 'spaced' : p.section;
    const thickness = p.thicknessOf(p.section, p.plateId);
    if (!p.active) {
        node.userData.armorStateHidden = true;
        node.userData.armorSection = 'deco';
        node.visible = false;
        node.userData.armorSectionOrig = p.section;
        node.userData.armorPlateId = p.plateId;
        node.userData.armorThickness = thickness;
    } else {
        node.userData.armorStateHidden = false;
        node.userData.armorSectionOrig = p.section;
        node.userData.armorPlateId = p.plateId;
        node.userData.armorThickness = thickness;
        node.visible = !node.userData.configHidden;
        node.userData.armorSection = p.spaced ? 'spaced' : p.section;
        replaceArmorMaterial(node, p.collisionMode
            ? new THREE.MeshStandardMaterial({
                color: p.colorOf(node.userData.armorThickness),
                metalness: 0.4, roughness: 0.6,
                transparent: true, opacity: 0.95, depthWrite: true,
            })
            : new THREE.MeshStandardMaterial({
                color: 0x444444, metalness: 0.3, roughness: 0.8,
                transparent: true, opacity: 0, depthWrite: false,
            }));
    }
}
