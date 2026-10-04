/**
 * 夹具资产包自检（评审 PR #511 BLOCKER 2 的确定性前提）：
 * browser-armor-aiming.mjs 不再 SKIP——CI 里必须真的加载起车模。这些断言锁住
 * 「夹具 GLB/tank JSON 满足查看器装配契约」：命名正则、枢轴装配数学、装甲板厚度键、
 * 资产源路由与 CORS。夹具改坏时在这里 fail，而不是在浏览器门禁里超时。
 */
import { describe, expect, it } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import {
    FIXTURE_ARMOR_GLB, FIXTURE_ORIGINS, FIXTURE_TANK_CACHE, FIXTURE_TANK_DATA, FIXTURE_TANK_ID,
    FIXTURE_VISUAL_GLB, startFixtureAssetPack,
} from './fixture-asset-pack.mjs'

const load = async (buf) => {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    return new GLTFLoader().parseAsync(ab, '')
}

function glbChunks(buf) {
    expect(buf.readUInt32LE(0)).toBe(0x46546C67)   // 'glTF'
    expect(buf.readUInt32LE(4)).toBe(2)
    expect(buf.readUInt32LE(8)).toBe(buf.length)   // 声明长度 = 实际长度
    const chunks = []
    let off = 12
    while (off < buf.length) {
        const len = buf.readUInt32LE(off)
        const type = buf.readUInt32LE(off + 4)
        chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) })
        expect(len % 4).toBe(0)                   // GLB 要求 4 字节对齐
        off += 8 + len
    }
    return chunks
}

/** 网格几何的世界/局部包围盒中心（装配数学断言用） */
function meshBoxCenter(mesh) {
    mesh.updateWorldMatrix(true, false)
    const box = new THREE.Box3().setFromObject(mesh)
    return box.getCenter(new THREE.Vector3())
}

describe('夹具 GLB 结构', () => {
    it('两个 GLB 都是合法容器（magic / version / 长度一致 / chunk 对齐）', () => {
        for (const buf of [FIXTURE_ARMOR_GLB, FIXTURE_VISUAL_GLB]) {
            const chunks = glbChunks(buf)
            expect(chunks.map((c) => c.type)).toEqual([0x4E4F534A, 0x004E4942])   // JSON + BIN
        }
    })
    it('装甲模型：板名命中 tagArmorPlates / configHidden / installPivot 三处正则', async () => {
        const gltf = await load(FIXTURE_ARMOR_GLB)
        const names = []
        gltf.scene.traverse((n) => { if (n.isMesh) names.push(n.name) })
        expect(names.sort()).toEqual(['gun_01_armor_1', 'hull_armor_1', 'turret_01_armor_1'])
        for (const name of names) {
            expect(name).toMatch(/(hull|turret|gun)_\w*?_?armor_(\d+)/)   // tagArmorPlates
        }
        expect(names.find((n) => /^turret_\d+_armor/.test(n))).toBeTruthy()   // installPivot
        expect(names.find((n) => /^gun_\d+_armor/.test(n))).toBeTruthy()
        expect(names.find((n) => /^hull_armor/.test(n))).toBeTruthy()
    })
    it('视觉模型：部位组命名命中 aimPartAt / collectConfigNodes / tagModuleMeshes 正则', async () => {
        const gltf = await load(FIXTURE_VISUAL_GLB)
        const nodes = []
        gltf.scene.traverse((n) => nodes.push(n))
        const byName = (re) => nodes.filter((n) => re.test(n.name || ''))
        expect(byName(/^turret_\d+$/).length).toBe(1)       // collectConfigNodes（炮塔组）
        expect(byName(/^gun_\d+$/).length).toBe(1)          // 炮管组
        expect(byName(/^gun_\d/).length).toBeGreaterThanOrEqual(1)   // aimPartAt（按炮管）
        // 炮管网格的父节点恰为 gun_XX → tagModuleMeshes 认成外部模块（flat 消耗）
        const barrel = nodes.find((n) => n.isMesh && /^gun_\d+$/.test(n.parent?.name || ''))
        expect(barrel).toBeTruthy()
        // 履带链：任一祖先名命中 ^chassis_track_ → chassis 模块（左右由 _R/_L 判定）
        const tracks = nodes.filter((n) => n.isMesh && /^chassis_track_/.test((() => {
            for (let p = n; p; p = p.parent) if (/^chassis_track_/.test(p.name || '')) return p.name
            return ''
        })()))
        expect(tracks.length).toBe(2)
    })
    it('装甲板与视觉几何的装配数学一致（枢轴 = model_origins；板存模块局部坐标）', async () => {
        const armor = await load(FIXTURE_ARMOR_GLB)
        const visual = await load(FIXTURE_VISUAL_GLB)
        const find = (gltf, name) => {
            let found = null
            gltf.scene.traverse((n) => { if (n.isMesh && n.name === name) found = n })
            return found
        }
        const tPivot = new THREE.Vector3(...FIXTURE_ORIGINS.turret)
        const track = new THREE.Vector3(...FIXTURE_ORIGINS.track)
        const gunOrigin = new THREE.Vector3(...FIXTURE_TANK_DATA.configs[0].gun_origin)
        const gPivot = track.clone().add(tPivot).add(gunOrigin)
        // 视觉网格中心（车体系）
        const vHull = meshBoxCenter(find(visual, 'hull_mesh'))
        const vTurret = meshBoxCenter(find(visual, 'turret_01_mesh'))
        const vGun = meshBoxCenter(find(visual, 'gun_01_mesh'))
        // 装甲板中心（模块局部） + 枢轴 == 视觉网格中心（alignArmorModules 的装配结果）
        expect(meshBoxCenter(find(armor, 'hull_armor_1')).add(track).distanceTo(vHull)).toBeLessThan(0.2)
        expect(meshBoxCenter(find(armor, 'turret_01_armor_1')).add(tPivot).distanceTo(vTurret)).toBeLessThan(0.2)
        expect(meshBoxCenter(find(armor, 'gun_01_armor_1')).add(gPivot).distanceTo(vGun)).toBeLessThan(0.2)
    })
})

describe('夹具 tank JSON / 名册契约', () => {
    it('厚度键与 GLB 板名一一对应（getPlateThickness 查得中）', async () => {
        const gltf = await load(FIXTURE_ARMOR_GLB)
        const am = FIXTURE_TANK_DATA.armor_model
        const ids = { hull: [], turret: [], gun: [] }
        gltf.scene.traverse((n) => {
            if (!n.isMesh) return
            const m = n.name.match(/^(hull|turret|gun)_\w*?_?armor_(\d+)/)
            if (m) ids[m[1]].push(m[2])
        })
        for (const [section, plates] of Object.entries(ids)) {
            expect(plates.length).toBeGreaterThan(0)
            for (const id of plates) expect(am[section].plates[id]).toBeGreaterThan(0)
        }
        expect(am.chassis.left_track).toBeGreaterThan(0)
        expect(am.chassis.right_track).toBeGreaterThan(0)
        expect(am.gun.plates.gun).toBeGreaterThan(0)   // 炮管外部模块厚度
    })
    it('模型 URL 与资产路由同形（/glb/<数字 id>/…；射击复现路径替换依赖数字 id）', () => {
        expect(FIXTURE_TANK_DATA.model_url).toBe(`/glb/${FIXTURE_TANK_ID}/armor.glb`)
        expect(FIXTURE_TANK_DATA.visual_model_url).toBe(`/glb/${FIXTURE_TANK_ID}/visual.glb`)
        expect(FIXTURE_TANK_DATA.visual_model_url).toMatch(/\/glb\/\d+\//)
        expect(FIXTURE_TANK_CACHE[FIXTURE_TANK_ID].name).toBe(FIXTURE_TANK_DATA.name)
    })
})

describe('夹具资产服务器', () => {
    it('四条路由可达 + CORS 放行；未知路径 404（不静默返回空）', async () => {
        const pack = await startFixtureAssetPack()
        try {
            const paths = [
                '/data/tank_cache.json',
                `/tank/${FIXTURE_TANK_ID}.json`,
                FIXTURE_TANK_DATA.model_url,
                FIXTURE_TANK_DATA.visual_model_url,
            ]
            for (const path of paths) {
                const res = await fetch(pack.origin + path)
                expect(res.status, path).toBe(200)
                expect(res.headers.get('access-control-allow-origin'), path).toBe('*')
            }
            const tank = await (await fetch(`${pack.origin}/tank/${FIXTURE_TANK_ID}.json`)).json()
            expect(tank.name).toBe(FIXTURE_TANK_DATA.name)
            const missing = await fetch(`${pack.origin}/glb/${FIXTURE_TANK_ID}/nope.glb`)
            expect(missing.status).toBe(404)
        } finally {
            await pack.close()
        }
    })
})
