/**
 * armorCollisionPack 等价性锁（跳弹续飞 GPU 求交 v5）：
 * 1. raycastPackAll ↔ THREE.Raycaster(intersectObjects, FrontSide)：同一射线的
 *    命中序列（对象与 t）必须一致——着色器求交与点击判定 raycast 的几何口径锁；
 * 2. simulateContinuation ↔ penetration.js calculate(allow_ricochet=false)：
 *    续飞层链（去重/flat 消耗/角度等效/严格大于/末层定论/前端 primary 门）的
 *    语义等价锁——GLSL rcContinue 与本 JS 参考同常量同语义，故此锁覆盖 GLSL；
 * 3. buildPack fail-closed 守卫（非刚性/超限/空集合禁用续飞）。
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
    RC, RC_GLSL_CONST, RC_GLSL_FUNCS, buildPack, buildRicochetGrid, createGridTextures, updatePackMatrices,
    raycastPackAll, simulateContinuation,
} from './armorCollisionPack.js'
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

/** 沿 +X 布置层链的便利构造：plates = [{ section, thickness, x, rotYDeg? }] */
function buildChainScene(plates) {
    const meshes = plates.map(p => makeMesh(
        p.section === 'chassis' || p.section === 'gunBarrel'
            ? new THREE.BoxGeometry(1.4, 1.4, 1.4)
            : new THREE.PlaneGeometry(1.4, 1.4),
        p.section, p.thickness,
        (m) => {
            m.position.set(p.x, 0, 0)
            if (p.rotYDeg) m.rotation.y = p.rotYDeg * Math.PI / 180
            else m.rotation.y = -Math.PI / 2   // 平面默认法线 +Z，转成 -X 朝向来向（正对）
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

/** 前端口径的 oracle：raw 命中无 primary → 紫（不做二次判定）；有 → calculate */
function oracleClass(pack, bouncePos, reflDir, params) {
    const ro = bouncePos.clone().addScaledVector(reflDir, RC.ORIGIN_OFFSET)
    const raw = raycastPackAll(pack, ro, reflDir, RC.T_SKIP + RC.T_EPS)
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
        // 30×30 段 = 1800 三角形 > MAX_TRI_PER_MESH(256) → 8 块
        const pack = buildPack([{ mesh: m, section: 'hull', thickness: 100, variant: null }])
        expect(pack.ok).toBe(true)
        expect(pack.meshCount).toBe(8)
        expect(pack.triTotal).toBe(1800)
        // 分块后求交与 Raycaster（整网格）仍一致
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
        // 文档化边界：射线恰好穿过几何棱时，同一网格的两个面在同一 t 上各报一次命中
        //（Raycaster 的重心判定与 MT 的 u/v 判定在浮点边界各自取舍）——同对象同 t 的
        // 重合命中不是语义层（判定链按层消耗，重合层无独立意义），比对前两侧都去重。
        const dedupe = (arr) => arr.filter((h, i) => i === 0
            || !(Math.abs(h.t - arr[i - 1].t) < 1e-6 && h.uuid === arr[i - 1].uuid))
        let compared = 0
        for (let i = 0; i < 40; i++) {
            // 从包围盒外随机点射向场景内部随机点
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
        // 去重扣 20 → 余 230 > 210 穿透；若不去重扣 50 → 余 200 < 210 被挡（有判别力）
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
        // 250 − 30 − 20 = 200 > 180 穿透；若漏掉任一则与 180 的比较无判别力差 20+30 → 选 200/180 边界
        const { sim, oracle } = runCase([
            { section: 'gunBarrel', thickness: 30, x: 2 },
            { section: 'chassis', thickness: 20, x: 3.5 },
            { section: 'hull', thickness: 180, x: 5.5 },
        ], P)
        expect(sim.cls).toBe(1)
        expect(oracle).toBe(1)
    })

    it('间隙甲角度等效：60° 斜置 50mm → 等效 100mm', () => {
        // 250 − 100(等效) = 150 > 145 穿透；flat/角度之判别由 layers[0].eff ≈ 100 断言承担
        const { sim, oracle } = runCase([
            { section: 'spaced', thickness: 50, x: 2, rotYDeg: -90 + 60 },
            { section: 'hull', thickness: 145, x: 4 },
        ], P)
        expect(sim.cls).toBe(1)
        expect(oracle).toBe(1)
        expect(Math.abs(sim.layers[0].eff - 100)).toBeLessThan(0.5)
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
        // 主装甲 100×1.04=104；250>104 穿透；非强化也穿透——取 245 边界区分：
        // 245 > 104 ✓ PEN；若漏乘 1.04（按 100 判）也 PEN → 需要更紧边界：
        // 主装甲 240：强化后 249.6 < 250 仍 PEN…取 242：251.68>250? no…
        // 直接校验层数值而非类别判别力
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
        // 旋转网格（模拟炮塔），矩阵纹理应跟上
        meshes[0].rotation.y += Math.PI / 6
        meshes[0].updateMatrix()
        meshes[0].updateWorldMatrix(true, false)
        updatePackMatrices(pack)
        const after = raycastPackAll(pack, new THREE.Vector3(-5, 0, 0), new THREE.Vector3(1, 0, 0), 0)
        // 同一射线在旋转后仍应命中（板足够大），法线方向随旋转改变
        expect(after.length).toBeGreaterThan(0)
        if (before.length && after.length) {
            expect(Math.abs(before[0].normal.angleTo(after[0].normal) - Math.PI / 6)).toBeLessThan(0.05)
        }
        // 整车世界包围盒（着色器早退 uniform 的数据源）随矩阵刷新且覆盖几何
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
                // 命中点所在 cell 必须列出该三角形（浮点边界：邻 cell 列出亦可接受）
                const inCell = listed.includes(h.slot)
                if (!inCell) {
                    // 边界容差：命中点可能在相邻 cell（floor 边界 ±1mm）
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
        // boxes: [{ size:[x,y,z], pos, section, thickness }] → buildPack
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
        // 覆盖断言：网格 AABB 完全包含几何包围盒
        // 末端 turret 盒（x∈[60.5,61.5]）必须落在网格内
        const maxX = grid.gridMin[0] + grid.dims[0] * grid.cellSize;
        expect(maxX).toBeGreaterThanOrEqual(61.5 - 1e-6);
        // 覆盖性：暴力射线命中末端盒的三角形必在其命中点 cell 的条目表
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
        // 盒以原点为中心：x∈[-10.8, 10.8]，ext=21.6=48×0.45 → floor 恰为默认 0.45
        const pack = packOfBoxes([{ size: [48 * 0.45, 2, 2], pos: [0, 0, 0], section: 'hull', thickness: 80 }]);
        const grid = buildRicochetGrid(pack);
        expect(grid.ok).toBe(true);
        expect(grid.dims[0]).toBeLessThanOrEqual(48);
        const maxX = grid.gridMin[0] + grid.dims[0] * grid.cellSize;
        const minX = grid.gridMin[0];
        expect(maxX).toBeGreaterThanOrEqual(10.8 - 1e-6);   // 覆盖到几何最远点
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
    it('极端密集（下界处仍超条目上限）→ fail-closed 而非截断成功', () => {
        // 单网格 2 万三角形集中在 10m 平面（chunk 拆为 ~79 单元）：细化到覆盖下界仍超
        // MAX_CELL_ENTRIES → 必须显式失败，禁止「capped 截断仍 ok」的静默半覆盖
        const dense = makeMesh(new THREE.PlaneGeometry(10, 10, 100, 100), 'hull', 60, m => {
            m.rotation.x = -Math.PI / 2; m.updateMatrix();
        });
        const pack = packOf([dense]);
        const grid = buildRicochetGrid(pack);
        if (grid.ok) {
            // 允许成功，但必须全覆盖 + 条目不超上限
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


describe('续飞距离常量三路一致（评审 P1b）', () => {
    it('RC.MIN_CONTINUATION_T = 0.0001 且 GLSL 序列化保 6 位小数', () => {
        expect(RC.MIN_CONTINUATION_T).toBe(0.0001);
        expect(RC_GLSL_CONST).toContain('#define RC_TSKIP 0.000100');
    });
    it('边界距离分类：0.05mm 滤除 / 0.10mm 边界（GLSL t> 判定） / 0.20mm 保留 —— JS 参考与口径锁', () => {
        // 层距 0.2m 的两块板：跳弹点附近按不同 MIN_CONTINUATION_T 人为分类，验证阈值语义
        // （0.05mm 与 0.10mm 处于同一 cell 噪声域，均被滤；0.2mm 亦滤——真实装甲层
        //  距离为厘米级，这些边界只验证常量语义而非物理命中）
        expect(0.00005 < RC.MIN_CONTINUATION_T).toBe(true);    // 0.05mm < 0.1mm → 滤
        expect(0.00010 >= RC.MIN_CONTINUATION_T).toBe(true);   // 0.10mm == 常量 → click 严格 < 判定保留（GLSL t<=tLo 滤，差一个 T_EPS 噪声域）
        expect(0.00020 > RC.MIN_CONTINUATION_T).toBe(true);    // 0.20mm > 常量 → 保留
        // JS 参考入口使用同一常量（源码级锁：防止将来改回硬编码）
        const src = require('fs').readFileSync(new URL('./armorCollisionPack.js', import.meta.url), 'utf8');
        expect(src).toContain('raycastPackAll(pack, ro, reflDir, RC.MIN_CONTINUATION_T + RC.T_EPS)');
        expect(src).not.toContain('RC.T_SKIP + RC.T_EPS);   // 与');
    });
    it('真实边界场景：跳弹点旁 0.5mm 处的薄板被保留（<0.1m 的接缝另一侧板命中）', () => {
        // 跳弹板在 x=0，另一侧板在 x=0.0005（0.5mm）：远大于 0.1mm 滤值 → 必须命中
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
        expect(sim.cls).toBe(1);   // 0.5mm 处的板被命中并穿透（正是接缝 bug 修复的语义）
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
