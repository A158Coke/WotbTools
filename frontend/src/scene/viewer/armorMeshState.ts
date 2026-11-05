// 动态装甲（armorsStatesController，#820 Wave B3C）：单次 Mesh 状态应用出仓。
// 状态应用 = 可控板（各态 armors 并集）中非激活板按 **deco 口径**摘除（与穿透判定/
// 点击分类/跳弹枚举的保留面过滤同源，一处摘除全链生效）；常驻板不受状态控制。
// 本模块只负责「一个 mesh 在给定态下的 userData / 可见性 / 分类 / 厚度 / 材质」；
// 状态集合计算、retag 时序、枢轴重装（alignArmorModules）与姿态重放
// （updateTurretGun——installPivot 会清掉炮塔/炮管旋转，必须由宿主随后重放）都在宿主。
import * as THREE from 'three'
import type { Mesh } from 'three'

export type ArmorStateSection = 'hull' | 'turret' | 'gun'

/** thicknessOf：宿主的 getPlateThickness（tankData + 当前 config）；
 *  colorOf：宿主 thicknessToColor（厚度分档色，随视图模式共享）。 */
export interface ArmorMeshStateParams {
    key: string
    /** 网格名正则捕获的板号（key 即 `${section}:${plateId}`，宿主拼装）。 */
    plateId: string
    section: ArmorStateSection
    active: boolean
    spaced: boolean
    collisionMode: boolean
    thicknessOf: (section: string, plateId: string) => number | null
    colorOf: (t: number | null | undefined) => number
}

// 本查看器替换过的装甲材质才可 dispose；GLTF 原始材质可能跨网格共享，不能动。
export function replaceArmorMaterial(node: Mesh, material: THREE.Material): void {
    if (node.userData.armorMaterialOwned && node.material && typeof (node.material as THREE.Material).dispose === 'function') {
        (node.material as THREE.Material).dispose();
    }
    node.material = material;
    node.userData.armorMaterialOwned = true;
}

/** 把可控板 mesh 应用到给定动态装甲态：登记 armorStateKey/Section（热力图 clone
 *  预建依赖）、非激活按 deco 口径摘除、激活板升为一等板并同步当前视图材质。 */
export function applyArmorStateToMesh(node: Mesh, p: ArmorMeshStateParams): void {
    // 两个分支都登记 armorStateKey/armorStateSection：热力图构建时
    // 非激活板也要入场景（clone 隐藏）——切态只翻 clone 可见性，零重建
    node.userData.armorStateKey = p.key;
    node.userData.armorStateSection = p.spaced ? 'spaced' : p.section;
    const thickness = p.thicknessOf(p.section, p.plateId);
    if (!p.active) {
        node.userData.armorStateHidden = true;
        node.userData.armorSection = 'deco';
        node.visible = false;
        // 非激活板同样落声明厚度/orig（review P1：预建 clone 的
        // _baseThickness 缓存来源于此，留 0 会让切态初帧按 0mm 着色）
        node.userData.armorSectionOrig = p.section;
        node.userData.armorPlateId = p.plateId;
        node.userData.armorThickness = thickness;
    } else {
        // 激活板升级为一等板：厚度按声明表重算（deco 分支留的是 0）、
        // 补 armorSectionOrig（alignArmorModules/retag 依赖它）、按 spaced 表归类
        node.userData.armorStateHidden = false;
        node.userData.armorSectionOrig = p.section;
        node.userData.armorPlateId = p.plateId;
        node.userData.armorThickness = thickness;
        node.visible = !node.userData.configHidden;
        node.userData.armorSection = p.spaced ? 'spaced' : p.section;
        // 同步当前视图材质（review P2-2）：deco 分支没初始化材质，
        // 新激活板沿用原 GLTF 材质——普通模式不透明、碰撞模式不上厚度色。
        // 热力图模式下装甲本体走透明覆盖层（着色在 clone 场景），同普通模式。
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
