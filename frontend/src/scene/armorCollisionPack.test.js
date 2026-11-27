import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
    snapshotPackPose, packPoseChanged, RC, RC_GLSL_CONST, RC_GLSL_FUNCS, buildPack, buildRicochetGrid, createGridTextures, updatePackMatrices,
    raycastPackAll, raycastGridAll, simulateContinuation, isClippedModuleHit, isBackfaceNormal,
} from './armorCollisionPack.ts'
import { calculate } from './penetration.js'

const PRIM = new Set(['hull', 'turret', 'gun'])

function makeMesh(geometry, section, thickness, transform) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
    mesh.name = `${section}_${thickness}`
    mesh.userData.armorSection = section
    mesh.userData.armorThickness = thickness
    if (transform) transform(mesh)
    mesh.updateWorldMatrix(true, false)
    return mesh
}

function buildChainScene(plates) {
    const meshes = plates.map(p => makeMesh(
        p.section === 'chassis' || p.section === 'gunBarrel'
            ? new THREE.BoxGeometry(1.4, 1.4, 1.4)
            : new THREE.PlaneGeometry(1.4, 1.4),
        p.section, p.thickness,
        (m) => {
            m.position.set(p.x, 0, 0)
            if (p.rotYDeg) m.rotation.y = p.rotYDeg * Math.PI / 180
            else m.rotation.y = -Math.PI / 2
            m.updateMatrix()
        },
    ))
    const scene = new THREE.Scene()
    meshes.forEach(m => scene.add(m))
    scene.updateMatrixWorld(true)
    return { meshes, scene }
}

function packOf(meshes) {
    const entries = meshes.map(m => ({
        mesh: m,
        section: m.userData.armorSection,
        thickness: m.userData.armorThickness,
        variant: (m.userData.armorSection === 'chassis') ? 'track'
            : (m.userData.armorSection === 'gunBarrel') ? 'gun' : null,
    }))
    const pack = buildPack(entries)
    if (!pack.ok) throw new Error('pack failed: ' + pack.reason)
    return pack
}

function oracleClass(pack, bouncePos, reflDir, params) {
    const ro = bouncePos.clone().addScaledVector(reflDir, RC.ORIGIN_OFFSET)
    const raw = raycastPackAll(pack, ro, reflDir, RC.MIN_CONTINUATION_T, RC.FAR, false, params.clipPlane || null)
    if (!raw.some(h => PRIM.has(h.section))) return 0
    const req = {
        shell_type: 'ap',
        penetration: params.remIn,
        caliber: params.caliber,
        view_dir: [reflDir.x, reflDir.y, reflDir.z],
        hits: raw.map(h => ({
            section: h.section,
            plate_id: String(h.meshIdx),
            thickness: h.thickness,
            normal: [h.normal.x, h.normal.y, h.normal.z],
            point: [h.point.x, h.point.y, h.point.z],
            part_name: 'P' + h.meshIdx,
        })),
        allow_ricochet: false,
        enhanced_armor: params.thickMul > 1,
        normalization_deg: params.normalizationRad * 180 / Math.PI,
    }
    const res = calculate(req)
    if (res.result === 'PENETRATION') return 1
    if (res.result === 'BLOCKED') return 2
    return 0
}

const ORIGIN = new THREE.Vector3(0, 0, 0)
const X_DIR = new THREE.Vector3(1, 0, 0)

function runCase(plates, params) {
    const { meshes } = buildChainScene(plates)
    const pack = packOf(meshes)
    const sim = simulateContinuation(pack, ORIGIN, X_DIR, params)
    const oracle = oracleClass(pack, ORIGIN, X_DIR, params)
    return { sim, oracle, pack }
}

describe('buildPack 守卫（fail-closed）', () => {
    it('空集合禁用', () => {
        expect(buildPack([]).ok).toBe(false)
    })
    it('非刚性矩阵禁用（着色器 R^T 求逆依赖刚性）', () => {
        const m = makeMesh(new THREE.BoxGeometry(1, 1, 1), 'hull', 100, (mm) => {
            mm.scale.setScalar(2)
            mm.updateMatrix()
        })
        const pack = buildPack([{ mesh: m, section: 'hull', thickness: 100, variant: null }])
        expect(pack.ok).toBe(false)
        expect(pack.reason).toMatch(/non-rigid/)
    })
    it('单网格超三角形上限 → 按连续段分块（不禁用，命中集合不变）', () => {
        const m = makeMesh(new THREE.PlaneGeometry(30, 30, 30, 30), 'hull', 100)
        const pack = buildPack([{ mesh: m, section: 'hull', thickness: 100, variant: null }])
        expect(pack.ok).toBe(true)
        expect(pack.meshCount).toBe(8)
        expect(pack.triTotal).toBe(1800)
        const raycaster = new THREE.Raycaster()
        raycaster.set(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1))
        const ref = raycaster.intersectObject(m, false)
        const mine = raycastPackAll(pack, new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1), 0)
        expect(mine.length).toBe(ref.length)
        expect(Math.abs(mine[0].t - ref[0].distance)).toBeLessThan(1e-4)
    })
    it('正常打包：计数与网格纹理可创建（评审清理：死 createPackTextures 已移除）', () => {
        const { meshes } = buildChainScene([
            { section: 'hull', thickness: 100, x: 2 },
            { section: 'chassis', thickness: 20, x: 3 },
        ])
        const pack = packOf(meshes)
        expect(pack.meshCount).toBe(2)
        const grid = buildRicochetGrid(pack)
        expect(grid.ok).toBe(true)
        const tex = createGridTextures(grid)
        expect(tex.worldTrisTex.image.width).toBe(RC.TRI_ROW)
        expect(tex.cellsTex.image.height).toBe(Math.ceil(grid.cellTotal / RC.CELL_ROW))
        expect(tex.entriesTex.image.height).toBe(Math.ceil(grid.entryTotal / RC.ENTRY_ROW))
    })
    it('网格求交与暴力求交同口径（HE 800 射线走 DDA，不再全扫三角形）', () => {
        const { meshes } = buildChainScene([
            { section: 'hull', thickness: 100, x: 0 },
            { section: 'chassis', thickness: 20, x: 2.2 },
        ])
        const pack = packOf(meshes)
        const grid = buildRicochetGrid(pack)
        expect(grid.ok).toBe(true)
        const rays = [
            { ro: new THREE.Vector3(-5, 0.31, 0.17), dir: new THREE.Vector3(1, 0, 0) },
            { ro: new THREE.Vector3(-5, 0.3, 0.2), dir: new THREE.Vector3(1, 0.05, 0.02).normalize() },
            { ro: new THREE.Vector3(-5, 2, 2), dir: new THREE.Vector3(1, -0.1, -0.1).normalize() },
        ]
        for (const { ro, dir } of rays) {
            const brute = raycastPackAll(pack, ro, dir, 0)
            const fast = raycastGridAll(grid, ro, dir, 0)
            expect(fast, JSON.stringify({ ro, dir })).not.toBeNull()
            expect(fast.length, JSON.stringify({ ro, dir })).toBe(brute.length)
            for (let i = 0; i < fast.length; i++) {
                expect(fast[i].t).toBeCloseTo(brute[i].t, 6)
                expect(fast[i].section).toBe(brute[i].section)
                expect(fast[i].thickness).toBe(brute[i].thickness)
            }
        }
    })
})

describe('间隙甲双面命中（从背面命中间隙屏）', () => {
    it('默认仍按 FrontSide 剔除；twoSidedSpaced=true 时暴力/网格都命中且法线朝来向', () => {
        const { meshes } = buildChainScene([
            { section: 'spaced', thickness: 20, x: 0 },
        ])
        const pack = packOf(meshes)
        const grid = buildRicochetGrid(pack)
        expect(grid.ok).toBe(true)
        const ro = new THREE.Vector3(5, 0.31, 0.17)
        const dir = new THREE.Vector3(-1, 0, 0)
        expect(raycastPackAll(pack, ro, dir, 0)).toHaveLength(0)
        const brute = raycastPackAll(pack, ro, dir, 0, RC.FAR, true)
        expect(brute).toHaveLength(1)
        expect(brute[0].section).toBe('spaced')
        expect(brute[0].normal.dot(dir)).toBeLessThan(0)
        expect(raycastGridAll(grid, ro, dir, 0)).toHaveLength(0)
        const fast = raycastGridAll(grid, ro, dir, 0, RC.FAR, true)
        expect(fast).toHaveLength(1)
        expect(fast[0].section).toBe('spaced')
    })
})

describe('raycastPackAll ↔ THREE.Raycaster 几何口径', () => {
    it('随机射线命中序列一致（对象 + t + 法线方向）', () => {
        const { meshes } = buildChainScene([
            { section: 'hull', thickness: 100, x: 0, rotYDeg: -90 + 30 },
            { section: 'chassis', thickness: 20, x: 2.2 },
            { section: 'gunBarrel', thickness: 30, x: 4 },
            { section: 'spaced', thickness: 10, x: 5.5, rotYDeg: -90 - 20 },
            { section: 'turret', thickness: 200, x: 8 },
        ])
        const pack = packOf(meshes)
        const raycaster = new THREE.Raycaster()
        raycaster.far = RC.FAR
        const dedupe = (arr) => arr.filter((h, i) => i === 0
            || !(Math.abs(h.t - arr[i - 1].t) < 1e-6 && h.uuid === arr[i - 1].uuid))
        let compared = 0
        for (let i = 0; i < 40; i++) {
            const target = new THREE.Vector3(2 + (i * 37 % 60) / 10, (i * 53 % 40) / 10 - 2, (i * 71 % 40) / 10 - 2)
            const origin = target.clone().add(new THREE.Vector3(-6, (i * 29 % 30) / 10 - 1.5, (i * 17 % 30) / 10 - 1.5))
            const dir = target.clone().sub(origin).normalize()
            const mine = dedupe(raycastPackAll(pack, origin, dir, 0)
                .map(h => ({ t: h.t, uuid: pack.meshes[h.meshIdx].uuid, n: h.normal })))
            raycaster.set(origin, dir)
            const ref = dedupe(raycaster.intersectObjects(meshes, false)
                .filter(h => h.distance < RC.FAR)
                .map(h => ({
                    t: h.distance,
                    uuid: h.object.uuid,
                    n: h.face.normal.clone()
                        .applyMatrix3(new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld)).normalize(),
                })))
            expect(mine.length).toBe(ref.length)
            for (let k = 0; k < mine.length; k++) {
                expect(Math.abs(mine[k].t - ref[k].t)).toBeLessThan(1e-4)
                expect(mine[k].uuid).toBe(ref[k].uuid)
                expect(mine[k].n.dot(ref[k].n)).toBeGreaterThan(0.99)
                compared++
            }
        }
        expect(compared).toBeGreaterThan(20)
    })
})

describe('simulateContinuation ↔ penetration.js calculate（续飞语义等价）', () => {
    const P = { remIn: 250, caliber: 100, normalizationRad: 0, thickMul: 1 }

    it('履带→主装甲：穿透（绿）', () => {
        const { sim, oracle } = runCase([
            { section: 'chassis', thickness: 20, x: 2 },
            { section: 'hull', thickness: 100, x: 4 },
        ], P)
        expect(sim.cls).toBe(1)
        expect(oracle).toBe(1)
    })

    it('履带→厚主装甲：被挡（红）', () => {
        const { sim, oracle } = runCase([
            { section: 'chassis', thickness: 20, x: 2 },
            { section: 'hull', thickness: 300, x: 4 },
        ], P)
        expect(sim.cls).toBe(2)
        expect(oracle).toBe(2)
    })

    it('同 variant 履带去重：两块履带只扣一块', () => {
        const { sim, oracle } = runCase([
            { section: 'chassis', thickness: 20, x: 2 },
            { section: 'chassis', thickness: 30, x: 3 },
            { section: 'hull', thickness: 210, x: 5 },
        ], P)
        expect(sim.cls).toBe(1)
        expect(oracle).toBe(1)
        expect(sim.layers.filter(l => l.section === 'chassis')).toHaveLength(1)
    })

    it('炮管与履带为不同 variant：两者都消耗', () => {
        const { sim, oracle } = runCase([
            { section: 'gunBarrel', thickness: 30, x: 2 },
            { section: 'chassis', thickness: 20, x: 3.5 },
            { section: 'hull', thickness: 180, x: 5.5 },
        ], P)
        expect(sim.cls).toBe(1)
        expect(oracle).toBe(1)
    })

    it('间隙甲角度等效：60° 斜置 50mm → 等效 100mm', () => {
        const { sim, oracle } = runCase([
            { section: 'spaced', thickness: 50, x: 2, rotYDeg: -90 + 60 },
            { section: 'hull', thickness: 145, x: 4 },
        ], P)
        expect(sim.cls).toBe(1)
        expect(oracle).toBe(1)
        expect(Math.abs(sim.layers[0].eff - 100)).toBeLessThan(0.5)
    })

    it('每层独立转正：20mm 间隙@60° + 100mm 主装甲@60°（BlitzKit）', () => {
        const { sim, oracle } = runCase([
            { section: 'spaced', thickness: 20, x: 2, rotYDeg: -90 + 60 },
            { section: 'hull', thickness: 100, x: 4, rotYDeg: -90 + 60 },
        ], { remIn: 220, caliber: 100, normalizationRad: 5 * Math.PI / 180, thickMul: 1 })
        expect(Math.abs(sim.layers[0].eff - 27.1268)).toBeLessThan(0.02)
        expect(Math.abs(sim.layers[1].eff - 100 / Math.cos(55 * Math.PI / 180))).toBeLessThan(0.05)
        expect(sim.layers[1].eff).toBeLessThan(180)
        expect(sim.cls).toBe(1)
        expect(oracle).toBe(1)
    })

    it('外部模块不参与转正：履带 + 主装甲@60°，仍独立转正 5°', () => {
        const { sim, oracle } = runCase([
            { section: 'chassis', thickness: 20, x: 2 },
            { section: 'hull', thickness: 100, x: 4, rotYDeg: -90 + 60 },
        ], { remIn: 210, caliber: 100, normalizationRad: 5 * Math.PI / 180, thickMul: 1 })
        expect(Math.abs(sim.layers[1].eff - 100 / Math.cos(55 * Math.PI / 180))).toBeLessThan(0.05)
        expect(sim.layers[1].eff).toBeLessThan(190)
        expect(sim.cls).toBe(1)
        expect(oracle).toBe(1)
    })

    it('0mm 首层装甲：模块后不产生 NaN，0mm 板穿透', () => {
        const { sim, oracle } = runCase([
            { section: 'chassis', thickness: 20, x: 2 },
            { section: 'hull', thickness: 0, x: 4 },
        ], { remIn: 100, caliber: 100, normalizationRad: 0, thickMul: 1 })
        expect(sim.layers[1].eff).toBe(0)
        expect(sim.cls).toBe(1)
        expect(oracle).toBe(1)
    })

    it('非平行间隙板/主装甲：续飞按间隙板自身几何（review 2026-10-13 用例）', () => {
        const gapAngle = 75 * Math.PI / 180
        const gapNormal = new THREE.Vector3(-Math.cos(gapAngle), 0, Math.sin(gapAngle))
        const bouncePos = new THREE.Vector3(2, 0, 0)
        const gap = makeMesh(new THREE.PlaneGeometry(4, 4), 'spaced', 40, (m) => {
            m.position.copy(bouncePos)
            m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), gapNormal)
        })
        const refl = X_DIR.clone().sub(gapNormal.clone().multiplyScalar(2 * X_DIR.dot(gapNormal))).normalize()
        const mainNormal = refl.clone().negate()
        const main = makeMesh(new THREE.PlaneGeometry(4, 4), 'hull', 100, (m) => {
            m.position.copy(bouncePos.clone().addScaledVector(refl, 0.5))
            m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), mainNormal)
        })
        const pack = packOf([gap, main])
        const params = { remIn: 225, caliber: 100, normalizationRad: 5 * Math.PI / 180, thickMul: 1 }
        const sim = simulateContinuation(pack, bouncePos, refl, params)
        expect(sim.cls).toBe(1)
        expect(oracleClass(pack, bouncePos, refl, params)).toBe(1)
        const wrongRefl = X_DIR.clone().sub(mainNormal.clone().multiplyScalar(2 * X_DIR.dot(mainNormal))).normalize()
        expect(simulateContinuation(pack, bouncePos, wrongRefl, params).cls).toBe(0)
    })

    it('间隙甲被挡但后方有主装甲：红（judge=BLOCKED）', () => {
        const { sim, oracle } = runCase([
            { section: 'spaced', thickness: 300, x: 2 },
            { section: 'hull', thickness: 100, x: 4 },
        ], P)
        expect(sim.cls).toBe(2)
        expect(oracle).toBe(2)
    })

    it('仅间隙甲无主装甲：紫（前端门，不做二次判定）', () => {
        const { sim, oracle } = runCase([
            { section: 'spaced', thickness: 10, x: 2 },
        ], P)
        expect(sim.cls).toBe(0)
        expect(oracle).toBe(0)
    })

    it('超厚履带挡下且后方有主装甲：红', () => {
        const { sim, oracle } = runCase([
            { section: 'chassis', thickness: 300, x: 2 },
            { section: 'hull', thickness: 100, x: 4 },
        ], P)
        expect(sim.cls).toBe(2)
        expect(oracle).toBe(2)
    })

    it('超厚履带挡下且无主装甲：紫', () => {
        const { sim, oracle } = runCase([
            { section: 'chassis', thickness: 300, x: 2 },
        ], P)
        expect(sim.cls).toBe(0)
        expect(oracle).toBe(0)
    })

    it('强化装甲 ×1.04 两边同口径', () => {
        const { sim, oracle } = runCase([
            { section: 'hull', thickness: 100, x: 2 },
        ], { ...P, thickMul: 1.04 })
        expect(Math.abs(sim.layers[0].thickness - 104)).toBeLessThan(1e-4)
        expect(sim.cls).toBe(1)
        expect(oracle).toBe(1)
    })

    it('穿透概率带：余量充足→1.0；临界→(0.5,1)', () => {
        const ample = runCase([{ section: 'hull', thickness: 100, x: 2 }], { ...P, remIn: 220 })
        expect(ample.sim.penChance).toBe(1.0)
        const edge = runCase([{ section: 'hull', thickness: 100, x: 2 }], { ...P, remIn: 101 })
        expect(edge.sim.penChance).toBeGreaterThan(0.5)
        expect(edge.sim.penChance).toBeLessThanOrEqual(1.0)
        expect(edge.oracle).toBe(1)
    })

    it('穿透概率带保留段首区间宽度：300→690 @1000 ≈ 72.57%', () => {
        const { sim } = runCase([
            { section: 'spaced', thickness: 300, x: 2 },
            { section: 'hull', thickness: 690, x: 4 },
        ], { ...P, remIn: 1000 })
        expect(sim.cls).toBe(1)
        expect(sim.penChance).toBeCloseTo(0.7257469, 5)
    })

    it('概率停在首个主装甲：其后的车体底板/履带命中不参与', () => {
        const { sim, oracle } = runCase([
            { section: 'spaced', thickness: 20, x: 2 },
            { section: 'turret', thickness: 225, x: 4 },
            { section: 'hull', thickness: 5, x: 6 },
            { section: 'chassis', thickness: 25, x: 8 },
        ], { ...P, remIn: 252, caliber: 120 })
        expect(oracle).toBe(1)
        expect(sim.cls).toBe(1)
        expect(sim.layers.map(l => l.section)).toEqual(['spaced', 'turret'])
        expect(sim.penChance).toBeGreaterThan(0.9)
        expect(sim.penChance).toBeLessThan(1)
    })

    it('续飞名义被挡但概率 1–99%：保留部分概率供热力图', () => {
        const { sim, oracle } = runCase([
            { section: 'hull', thickness: 102, x: 2 },
        ], { remIn: 100, caliber: 100, normalizationRad: 0, thickMul: 1 })
        expect(oracle).toBe(2)
        expect(sim.cls).toBe(2)
        expect(sim.penChance).toBeCloseTo(0.1150697, 5)
    })

    it('前置间隙甲名义被挡但到首个 Primary 的概率仍保留（spaced100→hull1）', () => {
        const { sim, oracle } = runCase([
            { section: 'spaced', thickness: 100, x: 2 },
            { section: 'hull', thickness: 1, x: 4 },
        ], { remIn: 100, caliber: 100, normalizationRad: 0, thickMul: 1 })
        expect(oracle).toBe(2)
        expect(sim.cls).toBe(2)
        expect(sim.layers.map(l => l.section)).toEqual(['spaced', 'hull'])
        expect(sim.penChance).toBeCloseTo(0.1371265, 5)
    })

    it('前置外部模块名义被挡但首个 Primary 仍累计概率（chassis101→hull1）', () => {
        const { sim, oracle } = runCase([
            { section: 'chassis', thickness: 101, x: 2 },
            { section: 'hull', thickness: 1, x: 4 },
        ], { remIn: 100, caliber: 100, normalizationRad: 0, thickMul: 1 })
        expect(oracle).toBe(2)
        expect(sim.cls).toBe(2)
        expect(sim.layers.map(l => l.section)).toEqual(['chassis', 'hull'])
        expect(sim.penChance).toBeCloseTo(0.1150697, 5)
    })

    it('严格大于才穿透：等厚 → 被挡（红）', () => {
        const { sim, oracle } = runCase([
            { section: 'hull', thickness: 250, x: 2 },
        ], P)
        expect(sim.cls).toBe(2)
        expect(oracle).toBe(2)
    })
})

describe('矩阵纹理与姿态', () => {
    it('updatePackMatrices 跟随网格旋转（绕序法线世界向一致）', () => {
        const { meshes } = buildChainScene([{ section: 'hull', thickness: 100, x: 2, rotYDeg: -90 + 25 }])
        const pack = packOf(meshes)
        const before = raycastPackAll(pack, new THREE.Vector3(-5, 0, 0), new THREE.Vector3(1, 0, 0), 0)
        meshes[0].rotation.y += Math.PI / 6
        meshes[0].updateMatrix()
        meshes[0].updateWorldMatrix(true, false)
        updatePackMatrices(pack)
        const after = raycastPackAll(pack, new THREE.Vector3(-5, 0, 0), new THREE.Vector3(1, 0, 0), 0)
        expect(after.length).toBeGreaterThan(0)
        if (before.length && after.length) {
            expect(Math.abs(before[0].normal.angleTo(after[0].normal) - Math.PI / 6)).toBeLessThan(0.05)
        }
        expect(pack.worldMin.every(Number.isFinite)).toBe(true)
        expect(pack.worldMax.every(Number.isFinite)).toBe(true)
        const bb = new THREE.Box3(
            new THREE.Vector3(...pack.worldMin), new THREE.Vector3(...pack.worldMax));
        const wb = new THREE.Box3().setFromObject(meshes[0]);
        expect(bb.containsBox(wb)).toBe(true)
    })
})

describe('世界网格加速结构（buildRicochetGrid）', () => {
    function gridScene() {
        const { meshes } = buildChainScene([
            { section: 'hull', thickness: 100, x: 0, rotYDeg: -90 + 30 },
            { section: 'chassis', thickness: 20, x: 2.2 },
            { section: 'gunBarrel', thickness: 30, x: 4 },
            { section: 'spaced', thickness: 10, x: 5.5, rotYDeg: -90 - 20 },
            { section: 'turret', thickness: 200, x: 8 },
        ])
        return { meshes, pack: packOf(meshes) }
    }
    it('构建成功且 cell 条目不超上限', () => {
        const { pack } = gridScene()
        const grid = buildRicochetGrid(pack)
        expect(grid.ok).toBe(true)
        for (let ci = 0; ci < grid.cellTotal; ci++) {
            expect(grid.cellsData[ci * 4 + 1]).toBeLessThanOrEqual(RC.MAX_CELL_ENTRIES)
        }
        expect(grid.entryTotal).toBeGreaterThan(0)
    })
    it('覆盖性质：暴力求交每个命中的三角形必列于命中点所在 cell（DDA 可达性）', () => {
        const { pack } = gridScene()
        const grid = buildRicochetGrid(pack)
        expect(grid.ok).toBe(true)
        const [gx, gy, gz] = grid.dims
        const cellIndexOf = (p) => {
            const cx = Math.min(gx - 1, Math.max(0, Math.floor((p.x - grid.gridMin[0]) / grid.cellSize)))
            const cy = Math.min(gy - 1, Math.max(0, Math.floor((p.y - grid.gridMin[1]) / grid.cellSize)))
            const cz = Math.min(gz - 1, Math.max(0, Math.floor((p.z - grid.gridMin[2]) / grid.cellSize)))
            return cx + gx * (cy + gy * cz)
        }
        let checked = 0
        for (let i = 0; i < 60; i++) {
            const target = new THREE.Vector3(2 + (i * 37 % 60) / 10, (i * 53 % 40) / 10 - 2, (i * 71 % 40) / 10 - 2)
            const origin = target.clone().add(new THREE.Vector3(-6, (i * 29 % 30) / 10 - 1.5, (i * 17 % 30) / 10 - 1.5))
            const dir = target.clone().sub(origin).normalize()
            const hits = raycastPackAll(pack, origin, dir, 0)
            for (const h of hits) {
                const ci = cellIndexOf(h.point)
                const off = grid.cellsData[ci * 4]
                const cnt = grid.cellsData[ci * 4 + 1]
                const listed = []
                for (let e = 0; e < cnt; e++) listed.push(grid.entriesData[(off + e) * 4])
                const inCell = listed.includes(h.slot)
                if (!inCell) {
                    const eps = 1e-3
                    let neighbor = false
                    for (const [dx, dy, dz] of [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]]) {
                        const p2 = h.point.clone().add(new THREE.Vector3(dx * eps, dy * eps, dz * eps))
                        const ci2 = cellIndexOf(p2)
                        if (ci2 === ci) continue
                        const off2 = grid.cellsData[ci2 * 4], cnt2 = grid.cellsData[ci2 * 4 + 1]
                        for (let e = 0; e < cnt2; e++) {
                            if (grid.entriesData[(off2 + e) * 4] === h.slot) { neighbor = true; break }
                        }
                        if (neighbor) break
                    }
                    expect(neighbor).toBe(true)
                }
                checked++
            }
        }
        expect(checked).toBeGreaterThan(20)
    })
    it('网格条目包含暴力求交的全部命中三角形', () => {
        const { pack } = gridScene()
        const grid = buildRicochetGrid(pack)
        const seen = new Set()
        for (let e = 0; e < grid.entryTotal; e++) seen.add(grid.entriesData[e * 4])
        for (let i = 0; i < 30; i++) {
            const target = new THREE.Vector3(3 + (i * 41 % 40) / 10, (i * 23 % 30) / 10 - 1.5, (i * 67 % 40) / 10 - 2)
            const origin = target.clone().add(new THREE.Vector3(-7, 1, (i * 13 % 20) / 10 - 1))
            const dir = target.clone().sub(origin).normalize()
            for (const h of raycastPackAll(pack, origin, dir, 0)) {
                expect(seen.has(h.slot)).toBe(true)
            }
        }
    })
})

describe('网格覆盖不变量（评审 P1）', () => {
    function packOfBoxes(boxes) {
        const meshes = boxes.map(b => makeMesh(new THREE.BoxGeometry(...b.size), b.section, b.thickness, m => {
            m.position.set(...b.pos); m.updateMatrix(); m.updateWorldMatrix(true, false);
        }));
        return packOf(meshes);
    }
    it('长几何（单轴 60m > 48×0.45）：cellSize 抬到覆盖下界，网格仍全覆盖', () => {
        const pack = packOfBoxes([
            { size: [60, 1, 1], pos: [0, 0, 0], section: 'hull', thickness: 100 },
            { size: [1, 1, 1], pos: [61, 0, 0], section: 'turret', thickness: 200 },
        ]);
        const grid = buildRicochetGrid(pack);
        expect(grid.ok).toBe(true);
        const [gx, gy, gz] = grid.dims;
        expect(gx).toBeLessThanOrEqual(48);
        const maxX = grid.gridMin[0] + grid.dims[0] * grid.cellSize;
        expect(maxX).toBeGreaterThanOrEqual(61.5 - 1e-6);
        const far = new THREE.Vector3(61, 0, 5);
        const hits = raycastPackAll(pack, far, new THREE.Vector3(0, 0, -1), 0);
        expect(hits.length).toBeGreaterThan(0);
        const [mgx, mgy, mgz] = grid.dims;
        const cx = Math.min(mgx - 1, Math.max(0, Math.floor((hits[0].point.x - grid.gridMin[0]) / grid.cellSize)));
        const cy = Math.min(mgy - 1, Math.max(0, Math.floor((hits[0].point.y - grid.gridMin[1]) / grid.cellSize)));
        const cz = Math.min(mgz - 1, Math.max(0, Math.floor((hits[0].point.z - grid.gridMin[2]) / grid.cellSize)));
        const ci = cx + mgx * (cy + mgy * cz);
        const off = grid.cellsData[ci * 4], cnt = grid.cellsData[ci * 4 + 1];
        const listed = [];
        for (let e = 0; e < cnt; e++) listed.push(grid.entriesData[(off + e) * 4]);
        expect(listed).toContain(hits[0].slot);
    });
    it('恰在上限的几何（单轴 = 48×0.45m）成功且覆盖', () => {
        const pack = packOfBoxes([{ size: [48 * 0.45, 2, 2], pos: [0, 0, 0], section: 'hull', thickness: 80 }]);
        const grid = buildRicochetGrid(pack);
        expect(grid.ok).toBe(true);
        expect(grid.dims[0]).toBeLessThanOrEqual(48);
        const maxX = grid.gridMin[0] + grid.dims[0] * grid.cellSize;
        const minX = grid.gridMin[0];
        expect(maxX).toBeGreaterThanOrEqual(10.8 - 1e-6);
        expect(minX).toBeLessThanOrEqual(-10.8 + 1e-6);
    });
    it('DDA 步数上界 ≥ dims 之和（对角线路径可达）', () => {
        const pack = packOfBoxes([{ size: [10, 3, 3], pos: [0, 0, 0], section: 'hull', thickness: 80 }]);
        const grid = buildRicochetGrid(pack);
        expect(grid.ok).toBe(true);
        const dimsSum = grid.dims[0] + grid.dims[1] + grid.dims[2];
        expect(RC.MAX_STEPS).toBeGreaterThanOrEqual(dimsSum);
        expect(RC.MAX_STEPS).toBeGreaterThanOrEqual(RC.GRID_DIM_MAX * 3);
    });
    it('密度细化重试可达（评审 P1）：初始 0.45m 过密 → 细化到更细 cell 成功且仍全覆盖', () => {
        const dense = makeMesh(new THREE.PlaneGeometry(2, 2, 60, 60), 'hull', 60, m => {
            m.rotation.x = -Math.PI / 2; m.position.set(0, 0, 0); m.updateMatrix();
        });
        const far = makeMesh(new THREE.BoxGeometry(1, 1, 1), 'turret', 100, m => {
            m.position.set(6, 0, 0); m.updateMatrix();
        });
        const pack = packOf([dense, far]);
        const grid = buildRicochetGrid(pack);
        expect(grid.ok).toBe(true);
        expect(grid.cellSize).toBeLessThan(RC.GRID_CELL_SIZE);
        const cov = grid.gridMin.map((v, a) => v + grid.dims[a] * grid.cellSize);
        expect(cov[0]).toBeGreaterThanOrEqual(6.5 - 1e-6);
        for (let ci = 0; ci < grid.cellTotal; ci++) {
            expect(grid.cellsData[ci * 4 + 1]).toBeLessThanOrEqual(RC.MAX_CELL_ENTRIES);
        }
    });
    it('极端密集（下界处仍超条目上限）→ fail-closed 而非截断成功', () => {
        const dense = makeMesh(new THREE.PlaneGeometry(10, 10, 100, 100), 'hull', 60, m => {
            m.rotation.x = -Math.PI / 2; m.updateMatrix();
        });
        const pack = packOf([dense]);
        const grid = buildRicochetGrid(pack);
        if (grid.ok) {
            const cov = grid.gridMin.map((v, a) => v + grid.dims[a] * grid.cellSize);
            expect(cov[0]).toBeGreaterThanOrEqual(5 - 1e-6);
            expect(cov[2]).toBeGreaterThanOrEqual(5 - 1e-6);
            for (let ci = 0; ci < grid.cellTotal; ci++) {
                expect(grid.cellsData[ci * 4 + 1]).toBeLessThanOrEqual(RC.MAX_CELL_ENTRIES);
            }
        } else {
            expect(['grid-too-dense', 'grid-capped']).toContain(grid.reason);
        }
    });
})


describe('续飞初始接受阈三路一致（评审 P1）', () => {
    it('两个常量语义分离：MIN_CONTINUATION_T（初始接受阈）/ ADVANCE_EPSILON（层推进）', () => {
        expect(RC.MIN_CONTINUATION_T).toBe(0.0001);
        expect(RC.ADVANCE_EPSILON).toBe(0.0001);
        expect(RC_GLSL_CONST).toContain('#define RC_TSKIP 0.000100');
        expect(RC_GLSL_CONST).toContain('#define RC_ADV_EPS 0.000100');
    });
    it('GLSL：初始接受阈 = RC_TSKIP 本身（不得叠加 RC_ADV_EPS）；推进 eps 只出现在吞层之后', () => {
        expect(RC_GLSL_FUNCS).toContain('tStart = max(tStart, RC_TSKIP);');
        expect(RC_GLSL_FUNCS).not.toContain('RC_TSKIP + RC_ADV_EPS');
        expect(RC_GLSL_FUNCS).not.toContain('tCur + RC_ADV_EPS');
        expect(RC_GLSL_FUNCS).toContain('tCur = bestT + RC_ADV_EPS;');
    });
    it('click 路径续飞链与 pack 参考入口同一接受阈（#827 窄化：行为侧由下方 0.15/0.05mm 行为锁定；collectJudgmentHits 困于 judgment 闭包，保留 F3 Integration Contract 子句）', () => {
        const viewer = require('fs').readFileSync(new URL('./tankViewer.js', import.meta.url), 'utf8')
            + require('fs').readFileSync(new URL('./viewer/judgmentResult.ts', import.meta.url), 'utf8');
        expect(viewer).toMatch(/ricCollect = collectJudgmentHits\(ricIntersects, rc\.ray\.direction, RC\.MIN_CONTINUATION_T\)/);
        expect(viewer.replace('RC.MIN_CONTINUATION_T', '0')).not.toMatch(/ricCollect = collectJudgmentHits\(ricIntersects, rc\.ray\.direction, RC\.MIN_CONTINUATION_T\)/);
        expect(viewer).not.toContain('hit.distance < RC.MIN_CONTINUATION_T');
    });
    it('行为锁定：0.15mm 处的板被命中（旧 +eps 口径 0.2mm 会滤掉它）；0.05mm 处被滤', () => {
        const at = (x) => makeMesh(new THREE.PlaneGeometry(2, 2), 'hull', 60, m => {
            m.rotation.y = -Math.PI / 2; m.position.set(x, 0, 0); m.updateMatrix();
        });
        const ro = new THREE.Vector3(0, 0.31, 0.17);
        const dir = new THREE.Vector3(1, 0, 0);
        const mid = packOf([at(0.00015)]);
        expect(raycastPackAll(mid, ro, dir, RC.MIN_CONTINUATION_T).length).toBe(1);
        const below = packOf([at(0.00005)]);
        expect(raycastPackAll(below, ro, dir, RC.MIN_CONTINUATION_T).length).toBe(0);
    });
    it('真实边界场景：跳弹点旁 0.5mm 处的薄板被保留（<0.1m 的接缝另一侧板命中）', () => {
        const bounce = makeMesh(new THREE.PlaneGeometry(2, 2), 'hull', 60, m => {
            m.rotation.y = -Math.PI / 2; m.position.set(0, 0, 0); m.updateMatrix();
        });
        const near = makeMesh(new THREE.PlaneGeometry(2, 2), 'turret', 150, m => {
            m.rotation.y = -Math.PI / 2; m.position.set(0.0005, 0, 0); m.updateMatrix();
        });
        const pack = packOf([bounce, near]);
        const sim = simulateContinuation(pack, new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), {
            remIn: 300, caliber: 100, normalizationRad: 0, thickMul: 1,
        });
        expect(sim.cls).toBe(1);
    });
});


describe('GLSL 注入串完整性', () => {
    it('常量与关键函数在位（防手改漂移的轻量哨兵）', () => {
        expect(RC_GLSL_FUNCS).toContain('int rcContinue(')
        expect(RC_GLSL_FUNCS).toContain('bool rcTriW(')
        expect(RC_GLSL_FUNCS).toContain('RC_MAX_STEPS')
        expect(RC_GLSL_CONST).toContain('#define RC_RICO_MUL 0.750')
        expect(RC_GLSL_CONST).toContain('#define RC_TWO_CAL 1.4')
        
        expect(RC.RICO_REMAIN_MUL).toBe(0.75)
        expect(RC.TWO_CAL_NORM).toBe(1.4)
        expect(RC.MAX_CELL_ENTRIES).toBe(256)
    })
})


describe('packed pose invalidation (#711)', () => {
    it('copies matrix values and detects parent/mesh motion without manual dirty flags', () => {
        const { meshes, scene } = buildChainScene([{ section: 'turret', thickness: 225, x: 2 }]);
        const pack = packOf(meshes);
        const snapshot = snapshotPackPose(pack);
        expect(packPoseChanged(pack, snapshot)).toBe(false);
        scene.position.x = 0.00000001;
        scene.updateMatrixWorld(true);
        expect(packPoseChanged(pack, snapshot)).toBe(true);
        expect(snapshot[0][12]).toBe(2);
        const rebuilt = snapshotPackPose(pack);
        const camera = new THREE.PerspectiveCamera();
        camera.position.set(20, 30, 40);
        camera.updateMatrixWorld(true);
        expect(packPoseChanged(pack, rebuilt)).toBe(false);
        meshes[0].rotation.y += 0.01;
        scene.updateMatrixWorld(true);
        expect(packPoseChanged(pack, rebuilt)).toBe(true);
    });
    it('invalidates missing snapshots and changed geometry collections', () => {
        const pack = packOf(buildChainScene([{ section: 'hull', thickness: 70, x: 1 }]).meshes);
        expect(packPoseChanged(pack, null)).toBe(true);
        expect(packPoseChanged(pack, [])).toBe(true);
    });
});


describe('gun_mask 裁切面之后的炮管不参与续飞（2026-10-20 KRV）', () => {
    const origin = new THREE.Vector3(-5, 0, 0);
    const dir = new THREE.Vector3(1, 0, 0);
    const params = { remIn: 100, caliber: 120, normalizationRad: 0, thickMul: 1 };
    const hidden = new THREE.Plane(new THREE.Vector3(1, 0, 0), -0.5);
    const visible = new THREE.Plane(new THREE.Vector3(1, 0, 0), 1.0);

    it('isClippedModuleHit 只过滤 gunBarrel；null 平面/其它 section 不误伤', () => {
        const point = new THREE.Vector3(0, 0, 0);
        expect(isClippedModuleHit('gunBarrel', point, hidden)).toBe(true);
        expect(isClippedModuleHit('gunBarrel', point, visible)).toBe(false);
        expect(isClippedModuleHit('gunBarrel', point, null)).toBe(false);
        expect(isClippedModuleHit('turret', point, hidden)).toBe(false);
        expect(isClippedModuleHit('chassis', point, hidden)).toBe(false);
    });

    it('隐藏炮管从命中集合移除；可见炮管仍按模块先消费', () => {
        const { meshes } = buildChainScene([
            { section: 'gunBarrel', thickness: 50, x: 0 },
            { section: 'turret', thickness: 70, x: 0 },
        ]);
        const pack = packOf(meshes);
        expect(raycastPackAll(pack, origin, dir, 0).map(h => h.section)).toEqual(['gunBarrel', 'turret']);
        expect(raycastPackAll(pack, origin, dir, 0, RC.FAR, false, hidden).map(h => h.section)).toEqual(['turret']);
        expect(raycastPackAll(pack, origin, dir, 0, RC.FAR, false, visible).map(h => h.section)).toEqual(['gunBarrel', 'turret']);
    });

    it('隐藏炮管不再吞掉 50mm：100mm 剩余穿深从 BLOCKED 变 PENETRATED', () => {
        const { meshes } = buildChainScene([
            { section: 'gunBarrel', thickness: 50, x: 0 },
            { section: 'turret', thickness: 70, x: 0 },
        ]);
        const pack = packOf(meshes);
        expect(simulateContinuation(pack, origin, dir, params).cls).toBe(2);
        expect(oracleClass(pack, origin, dir, params)).toBe(2);
        const withClip = { ...params, clipPlane: hidden };
        const sim = simulateContinuation(pack, origin, dir, withClip);
        expect(sim.cls).toBe(1);
        expect(sim.layers.map(l => l.section)).toEqual(['turret']);
        expect(oracleClass(pack, origin, dir, withClip)).toBe(1);
        expect(simulateContinuation(pack, origin, dir, { ...params, clipPlane: visible }).cls).toBe(2);
    });

    it('GLSL rcContinue 与 JS 参考共用同一裁切判据', () => {
        expect(RC_GLSL_CONST).toContain('#define RC_SEC_GUN_BARREL 5');
        expect(RC_GLSL_FUNCS).toContain('uniform vec4 rcClipPlane;');
        expect(RC_GLSL_FUNCS).toContain('uniform bool rcClipEnabled;');
        expect(RC_GLSL_FUNCS).toContain('rcClipEnabled && candidateSection == RC_SEC_GUN_BARREL');
        expect(RC_GLSL_FUNCS).toContain('dot(rcClipPlane.xyz, clipPoint) + rcClipPlane.w < 0.0');
    });
});

describe('第二次跳弹即终态（2026-10-20）', () => {
    it('续飞段再次跳弹后炮弹消失，不再进入第三段', () => {
        const plate = makeMesh(new THREE.PlaneGeometry(2, 2), 'turret', 50, (m) => {
            m.rotation.y = -10 * Math.PI / 180;
            m.position.set(0, 0, 0);
            m.updateMatrix();
        });
        const pack = packOf([plate]);
        const sim = simulateContinuation(pack, new THREE.Vector3(-2, 0, 0), new THREE.Vector3(1, 0, 0), {
            remIn: 100, caliber: 120, normalizationRad: 0, thickMul: 1,
            ricochetRad: 70 * Math.PI / 180,
        });
        expect(sim.cls).toBe(0);
        expect(sim.layers.map(l => l.ricochet)).toEqual([true]);
        expect(sim.layers[0].seg).toBe(1);
    });
});

describe('续飞首层间隙甲跳弹（2026-10-21）', () => {
    it('续飞段首个命中是间隙甲且达跳弹角 → 第二次跳弹即终态', () => {
        const plate = makeMesh(new THREE.PlaneGeometry(2, 2), 'spaced', 50, (m) => {
            m.rotation.y = -10 * Math.PI / 180;
            m.position.set(0, 0, 0);
            m.updateMatrix();
        });
        const primary = makeMesh(new THREE.PlaneGeometry(2, 2), 'turret', 50, (m) => {
            m.position.set(4, 0, 0);
            m.rotation.y = -Math.PI / 2;
            m.updateMatrix();
        });
        const pack = packOf([plate, primary]);
        const sim = simulateContinuation(pack, new THREE.Vector3(-2, 0, 0), new THREE.Vector3(1, 0, 0), {
            remIn: 100, caliber: 120, normalizationRad: 0, thickMul: 1,
            ricochetRad: 70 * Math.PI / 180,
        });
        expect(sim.cls).toBe(0);
        expect(sim.layers.map(l => [l.section, l.ricochet])).toEqual([['spaced', true]]);
    });

    it('外部模块先消耗（hitIndex>0）后，间隙甲不再跳弹', () => {
        const { meshes } = buildChainScene([
            { section: 'chassis', thickness: 5, x: 0 },
            { section: 'spaced', thickness: 50, x: 2, rotYDeg: -10 },
            { section: 'turret', thickness: 50, x: 4 },
        ]);
        const pack = packOf(meshes);
        const sim = simulateContinuation(pack, new THREE.Vector3(-2, 0, 0), new THREE.Vector3(1, 0, 0), {
            remIn: 400, caliber: 120, normalizationRad: 0, thickMul: 1,
            ricochetRad: 70 * Math.PI / 180,
        });
        expect(sim.layers.some(l => l.ricochet)).toBe(false);
        expect(sim.layers.map(l => l.section)).toEqual(['chassis', 'spaced', 'turret']);
    });
});

describe('0mm 主装甲 3× 口径规则（2026-10-21）', () => {
    it('续飞命中 0mm 主装甲且角度≥跳弹角时按 overmatch 击穿，不判跳弹', () => {
        const plate = makeMesh(new THREE.PlaneGeometry(2, 2), 'turret', 0, (m) => {
            m.rotation.y = -10 * Math.PI / 180;
            m.position.set(0, 0, 0);
            m.updateMatrix();
        });
        const pack = packOf([plate]);
        const sim = simulateContinuation(pack, new THREE.Vector3(-2, 0, 0), new THREE.Vector3(1, 0, 0), {
            remIn: 100, caliber: 120, normalizationRad: 0, thickMul: 1,
            ricochetRad: 70 * Math.PI / 180,
        });
        expect(sim.cls).toBe(1);
        expect(sim.layers.map(l => [l.thickness, l.ricochet, l.penetrated])).toEqual([[0, false, true]]);
    });
});

describe('背面命中过滤（FrontSide 判定口径）', () => {
    it('双面闭合盒的正/背两个交点只保留迎面一个', () => {
        const box = makeMesh(new THREE.BoxGeometry(2, 2, 2), 'spaced', 50);
        box.material.side = THREE.DoubleSide;
        box.updateWorldMatrix(true, false);
        const ray = new THREE.Raycaster(new THREE.Vector3(0.3, 0.2, 3), new THREE.Vector3(0, 0, -1));
        const hits = ray.intersectObject(box, false);
        expect(hits).toHaveLength(2);
        const front = hits.filter(h => !isBackfaceNormal(
            h.face.normal.clone().transformDirection(box.matrixWorld), ray.ray.direction));
        expect(front).toHaveLength(1);
        expect(front[0].point.z).toBeCloseTo(1, 6);
    });
});
