// #820 Wave B3C：动态装甲单次 Mesh 状态应用出仓测试（真实 THREE.Mesh）。
// 宿主保留集合计算/retag/枢轴/姿态重放；本文件只验证 helper 的 mesh 级契约，
// 并用 negative control 证明关键分支（deco 摘除、姿态不触碰）真实生效。
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { applyArmorStateToMesh, replaceArmorMaterial } from './armorMeshState.js'
import type { ArmorMeshStateParams } from './armorMeshState.js'

const THICKNESS: Record<string, number> = { 'hull:10': 100, 'hull:11': 45, 'turret:2': 250, 'gun:3': 30 }

function thicknessOf(section: string, plateId: string): number | null {
    return THICKNESS[`${section}:${plateId}`] ?? null
}
function colorOf(t: number | null | undefined): number {
    if (t == null) return 0x666666
    if (t >= 200) return 0x8B0000
    if (t >= 100) return 0xFF4500
    return 0x228B22
}

function params(over: Partial<ArmorMeshStateParams> = {}): ArmorMeshStateParams {
    return {
        key: 'hull:10', plateId: '10', section: 'hull',
        active: true, spaced: false, collisionMode: false,
        thicknessOf, colorOf, ...over,
    }
}

function meshNamed(name: string): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    m.name = name
    return m
}

describe('applyArmorStateToMesh — 激活板', () => {
    it('升级为一等板：厚度按声明表、orig/plateId 落档、可见', () => {
        const node = meshNamed('hull_state_01_armor_10')
        applyArmorStateToMesh(node, params())
        expect(node.userData.armorThickness).toBe(100)
        expect(node.userData.armorSectionOrig).toBe('hull')
        expect(node.userData.armorPlateId).toBe('10')
        expect(node.userData.armorStateHidden).toBe(false)
        expect(node.visible).toBe(true)
        expect(node.userData.armorSection).toBe('hull')
        expect(node.userData.armorStateKey).toBe('hull:10')
        expect(node.userData.armorStateSection).toBe('hull')
    })

    it('spaced 表归类：armorSection 与 armorStateSection 均为 spaced', () => {
        const node = meshNamed('hull_state_01_armor_10')
        applyArmorStateToMesh(node, params({ spaced: true }))
        expect(node.userData.armorSection).toBe('spaced')
        expect(node.userData.armorStateSection).toBe('spaced')
    })

    it('configHidden 网格：激活也不可见（其余字段照常落档）', () => {
        const node = meshNamed('hull_state_01_armor_10')
        node.userData.configHidden = true
        applyArmorStateToMesh(node, params())
        expect(node.visible).toBe(false)
        expect(node.userData.armorSection).toBe('hull')
    })

    it('普通模式材质：透明覆盖层（不透明度 0、不写深度）', () => {
        const node = meshNamed('hull_state_01_armor_10')
        applyArmorStateToMesh(node, params())
        const mat = node.material as THREE.MeshStandardMaterial
        expect(mat.transparent).toBe(true)
        expect(mat.opacity).toBe(0)
        expect(mat.depthWrite).toBe(false)
        expect(node.userData.armorMaterialOwned).toBe(true)
    })

    it('碰撞模式材质：按声明厚度着色（colorOf 输出）', () => {
        const node = meshNamed('hull_state_01_armor_10')
        applyArmorStateToMesh(node, params({ collisionMode: true }))
        const mat = node.material as THREE.MeshStandardMaterial
        expect(mat.color.getHex()).toBe(0xFF4500)
        expect(mat.opacity).toBe(0.95)
        expect(mat.depthWrite).toBe(true)
    })

    it('state_XX 前缀命名网格与普通网格同路径（key/plateId 直通）', () => {
        const node = meshNamed('turret_state_02_armor_2')
        applyArmorStateToMesh(node, params({ key: 'turret:2', plateId: '2', section: 'turret' }))
        expect(node.userData.armorThickness).toBe(250)
        expect(node.userData.armorSectionOrig).toBe('turret')
    })
})

describe('applyArmorStateToMesh — 非激活板（deco 口径摘除）', () => {
    it('隐藏 + deco 分类 + 声明厚度/orig 落档（review P1：不留 0）', () => {
        const node = meshNamed('hull_state_01_armor_10')
        applyArmorStateToMesh(node, params({ active: false }))
        expect(node.visible).toBe(false)
        expect(node.userData.armorStateHidden).toBe(true)
        expect(node.userData.armorSection).toBe('deco')
        expect(node.userData.armorThickness).toBe(100)
        expect(node.userData.armorSectionOrig).toBe('hull')
        expect(node.userData.armorStateKey).toBe('hull:10')
        expect(node.userData.armorStateSection).toBe('hull')
    })

    it('非激活不换材质：沿用原 GLTF 材质（deco 分支不初始化）', () => {
        const node = meshNamed('hull_state_01_armor_10')
        const original = new THREE.MeshStandardMaterial()
        node.material = original
        applyArmorStateToMesh(node, params({ active: false, collisionMode: true }))
        expect(node.material).toBe(original)
    })

    it('厚度表缺失（null）时如实落 null，不伪装 0', () => {
        const node = meshNamed('gun_state_01_armor_3')
        applyArmorStateToMesh(node, params({ key: 'gun:9', plateId: '9', section: 'gun', active: false }))
        expect(node.userData.armorThickness).toBeNull()
    })
})

describe('反复切态与材质所有权', () => {
    it('激活→非激活→激活 幂等：字段回到激活档、厚度稳定', () => {
        const node = meshNamed('hull_state_01_armor_10')
        applyArmorStateToMesh(node, params())
        applyArmorStateToMesh(node, params({ active: false }))
        applyArmorStateToMesh(node, params())
        expect(node.userData.armorSection).toBe('hull')
        expect(node.userData.armorStateHidden).toBe(false)
        expect(node.visible).toBe(true)
        expect(node.userData.armorThickness).toBe(100)
        expect(node.userData.armorMaterialOwned).toBe(true)
    })

    it('owned 材质随替换 dispose，外来材质不动（资源释放契约）', () => {
        const node = meshNamed('hull_state_01_armor_10')
        const gltf = new THREE.MeshStandardMaterial()
        const gltfSpy = vi.spyOn(gltf, 'dispose')
        applyArmorStateToMesh(node, params())                       // gltf → owned#1（gltf 不动）
        expect(gltfSpy).not.toHaveBeenCalled()
        const first = node.material as THREE.MeshStandardMaterial
        const firstSpy = vi.spyOn(first, 'dispose')
        applyArmorStateToMesh(node, params({ collisionMode: true })) // owned#1 dispose → owned#2
        expect(firstSpy).toHaveBeenCalledTimes(1)
        expect((node.material as THREE.MeshStandardMaterial).opacity).toBe(0.95)
        replaceArmorMaterial(node, gltf)                             // owned#2 dispose，gltf 仍不动
        expect(gltfSpy).not.toHaveBeenCalled()
        expect(node.material).toBe(gltf)
        expect(firstSpy).toHaveBeenCalledTimes(1)
    })
})

describe('negative control 守卫', () => {
    it('姿态不触碰：matrix/rotation/position 原样（宿主重放依赖此前提）', () => {
        const node = meshNamed('hull_state_01_armor_10')
        node.rotation.set(0.3, 1.2, -0.4)
        node.position.set(1, 2, 3)
        node.updateMatrix()
        const before = node.matrix.clone()
        applyArmorStateToMesh(node, params())
        applyArmorStateToMesh(node, params({ active: false }))
        expect(node.matrix.equals(before)).toBe(true)
        expect(node.rotation.x).toBeCloseTo(0.3)
        expect(node.rotation.y).toBeCloseTo(1.2)
        expect(node.rotation.z).toBeCloseTo(-0.4)
        expect(node.position.toArray()).toEqual([1, 2, 3])
    })

    it('thicknessOf 以 (section, plateId) 调用——签名漂移立即暴露', () => {
        const spy = vi.fn(thicknessOf)
        const node = meshNamed('hull_state_01_armor_10')
        applyArmorStateToMesh(node, params({ thicknessOf: spy }))
        expect(spy).toHaveBeenCalledWith('hull', '10')
    })
})
