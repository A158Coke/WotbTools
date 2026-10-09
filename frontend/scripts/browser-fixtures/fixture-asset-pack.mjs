/**
 * 装甲查看器浏览器门禁的**确定性资产包**（评审 PR #511 BLOCKER 2）。
 *
 * 为什么需要：瞄准交互门禁（browser-armor-aiming.mjs）断言的是「按炮管/炮塔/车体拖动」
 * 与「短按判定」这些 Pointer Events × OrbitControls 互作——合成事件复现不了，必须有
 * 真实车模几何（部位判定按视觉组分组）。此前门禁依赖本机资产包、资产不可达就 SKIP，
 * 于是 CI 里这条 gate 永远是绿的假阳性。这里改用**进程内起一个极小资产源**：
 * 确定性构造的 GLB（hull / turret_01 / gun_01 / chassis_track_* 组，含装甲板命名）+ tank JSON，
 * 让门禁在任何环境（含 CI，无真实资产）都真实执行；SKIP 路径随之删除。
 *
 * 坐标口径与真实资产一致：GLB 为游戏系 Z-up（查看器 applyModelTransforms 转 -90°X）；
 * 装甲模型（armor.glb）的 turret/gun 板存**模块局部**坐标——alignArmorModules 会按
 * tank JSON 的 model_origins 加回枢轴（hull 板 = 车体枢轴系，与本 GLB 同原点）。
 */
import { createServer } from 'node:http'

/** 夹具坦克 id（数字 id：visual_model_url 的 /glb/<id>/ 替换逻辑要求数字） */
export const FIXTURE_TANK_ID = 9001

/* ------------------------------------------------------------------ 几何 */

/** 轴对齐盒 → 12 三角形（游戏系 Z-up；返回顶点/索引数组） */
function boxMesh(cx, cy, cz, sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2
  const corners = [
    [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz],
    [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz],
    [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
  ]
  const quads = [
    [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
  ]
  const positions = [], indices = []
  for (const q of quads) {
    const base = positions.length / 3
    for (const i of q) positions.push(...corners[i])
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return { positions: Float32Array.from(positions), indices: Uint16Array.from(indices) }
}

/** 夹具车体尺寸（米，游戏系）：hull / turret / 炮管 / 左右履带 */
const HULL = { c: [0, 0, 0.6], s: [3.0, 5.6, 1.2] }
const TURRET = { c: [0, -0.2, 1.85], s: [2.2, 2.6, 1.3] }
const BARREL = { c: [0, 2.6, 1.9], s: [0.35, 3.6, 0.35] }
const TRACK_L = { c: [-1.6, 0, 0.35], s: [0.6, 5.0, 0.7] }
const TRACK_R = { c: [1.6, 0, 0.35], s: [0.6, 5.0, 0.7] }
/** 装甲模型枢轴（= tank JSON model_origins 同值；装甲板按模块局部坐标存放） */
export const FIXTURE_ORIGINS = { track: [0, 0, 0], turret: [0, -0.2, 1.2] }
const GUN_ORIGIN = [0, 0, 0.7]   // gun 枢轴 = track + turret + gun_origin
/** 间隙甲屏幕板（turret 板 2，12mm）：悬在车体右前方之外，视线穿过它之后是空域，
 *  用来构造「整条射线只碰到间隙甲、没触达主装甲」的点击（BlitzKit 语义下不构成判定）。 */
const SCREEN = { c: [2.6, 3.2, 1.35], s: [1.6, 0.10, 1.7] }

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }

/** 视觉模型：部件组节点 + 网格子节点（与真实资产同构：查看器按"组名"分组/摆位，
 *  炮管网格的父节点须恰为 `gun_01` 才会被 tagModuleMeshes 认成外部模块） */
function visualParts() {
  return [
    { node: 'hull', mesh: 'hull_mesh', geo: boxMesh(...HULL.c, ...HULL.s) },
    { node: 'turret_01', mesh: 'turret_01_mesh', geo: boxMesh(...TURRET.c, ...TURRET.s) },
    { node: 'gun_01', mesh: 'gun_01_mesh', geo: boxMesh(...BARREL.c, ...BARREL.s) },
    { node: 'chassis_track_L', mesh: 'trackL_mesh', geo: boxMesh(...TRACK_L.c, ...TRACK_L.s) },
    { node: 'chassis_track_R', mesh: 'trackR_mesh', geo: boxMesh(...TRACK_R.c, ...TRACK_R.s) },
  ]
}

/** 装甲模型：板名命中查看器 tagArmorPlates 正则；turret/gun 板按模块局部坐标。
 *  装甲板直接是网格节点（installPivot 按网格名匹配，不能再套一层组）。 */
function armorParts() {
  const tPivot = FIXTURE_ORIGINS.turret
  const gPivot = [
    FIXTURE_ORIGINS.track[0] + tPivot[0] + GUN_ORIGIN[0],
    FIXTURE_ORIGINS.track[1] + tPivot[1] + GUN_ORIGIN[1],
    FIXTURE_ORIGINS.track[2] + tPivot[2] + GUN_ORIGIN[2],
  ]
  const local = (spec, pivot) => {
    const c = sub(spec.c, pivot)
    return boxMesh(c[0], c[1], c[2], ...spec.s)
  }
  return [
    { node: 'hull_armor_1', mesh: 'hull_armor_1', geo: local(HULL, FIXTURE_ORIGINS.track), wrap: false },
    { node: 'turret_01_armor_1', mesh: 'turret_01_armor_1', geo: local(TURRET, tPivot), wrap: false },
    { node: 'turret_01_armor_2', mesh: 'turret_01_armor_2', geo: local(SCREEN, tPivot), wrap: false },
    { node: 'gun_01_armor_1', mesh: 'gun_01_armor_1', geo: local(BARREL, gPivot), wrap: false },
  ]
}

/* ------------------------------------------------------------------ GLB 打包 */

/** 最小 GLB 封装：单缓冲 + 每个 primitive 一个 bufferView 对（POSITION / indices） */
function buildGlb(parts) {
  const bufferViews = []
  const accessors = []
  const meshes = []
  const binChunks = []
  let byteOffset = 0
  for (const part of parts) {
    const pos = part.geo.positions
    const idx = part.geo.indices
    // 顶点 min/max（POSITION accessor 必填）
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < pos.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        const v = pos[i + a]
        if (v < min[a]) min[a] = v
        if (v > max[a]) max[a] = v
      }
    }
    const posBytes = Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength)
    const idxBytes = Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength)
    const posPad = (4 - (posBytes.length % 4)) % 4
    const idxPad = (4 - (idxBytes.length % 4)) % 4
    bufferViews.push({ buffer: 0, byteOffset, byteLength: posBytes.length })
    bufferViews.push({ buffer: 0, byteOffset: byteOffset + posBytes.length + posPad, byteLength: idxBytes.length })
    accessors.push({ bufferView: bufferViews.length - 2, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max })
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5123, count: idx.length, type: 'SCALAR' })
    meshes.push({
      name: part.mesh,
      primitives: [{ attributes: { POSITION: accessors.length - 2 }, indices: accessors.length - 1 }],
    })
    binChunks.push(posBytes, Buffer.alloc(posPad), idxBytes, Buffer.alloc(idxPad))
    byteOffset += posBytes.length + posPad + idxBytes.length + idxPad
  }
  const bin = Buffer.concat(binChunks)
  // 节点图：0 = root；wrap=true 的部件 = 组节点 + 网格子节点（视觉模型），
  // 否则单网格节点（装甲模型：installPivot 按网格名匹配）
  const nodes = [{ name: 'fixture_root', children: [] }]
  parts.forEach((part, i) => {
    if (part.wrap === false) {
      nodes[0].children.push(nodes.length)
      nodes.push({ name: part.node, mesh: i })
    } else {
      nodes[0].children.push(nodes.length)
      const groupIdx = nodes.length
      nodes.push({ name: part.node, children: [groupIdx + 1] })
      nodes.push({ name: part.mesh, mesh: i })
    }
  })
  const json = {
    asset: { version: '2.0', generator: 'wotbtools-browser-fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  }
  const jsonBin = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPad = (4 - (jsonBin.length % 4)) % 4
  const jsonChunk = Buffer.concat([jsonBin, Buffer.alloc(jsonPad, 0x20)])
  const binPad = (4 - (bin.length % 4)) % 4
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad)])
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546C67, 0)   // 'glTF'
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonChunk.length, 0)
  jsonHeader.writeUInt32LE(0x4E4F534A, 4)   // 'JSON'
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binChunk.length, 0)
  binHeader.writeUInt32LE(0x004E4942, 4)   // 'BIN\0'
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk])
}

export const FIXTURE_ARMOR_GLB = buildGlb(armorParts())
export const FIXTURE_VISUAL_GLB = buildGlb(visualParts())

/* ------------------------------------------------------------------ tank JSON */

/** 夹具坦克数据（形状 = dump-tank-data 物化的 tank/{id}.json；板号/厚度与 GLB 命名对应） */
export const FIXTURE_TANK_DATA = {
  tank_id: FIXTURE_TANK_ID,
  name: 'Fixture Medium',
  tier: 8,
  type: 'mediumTank',
  nation: 'ussr',
  model_url: `/glb/${FIXTURE_TANK_ID}/armor.glb`,
  visual_model_url: `/glb/${FIXTURE_TANK_ID}/visual.glb`,
  armor_model: {
    hull: { plates: { 1: 100 }, spaced: [] },
    // 板 2 = 间隙甲屏幕板（plate 12mm）：与 configs[0].turret_spaced 同步，retag 后归 spaced
    turret: { plates: { 1: 150, 2: 12 }, spaced: [2] },
    gun: { plates: { 1: 200, gun: 60 }, spaced: [] },
    chassis: { left_track: 30, right_track: 30 },
  },
  model_origins: FIXTURE_ORIGINS,
  hull_spaced: [],
  turret_traverse_left: 180,
  turret_traverse_right: 180,
  configs: [{
    label: 'Fixture 105mm',
    turret_name: 'Fixture Turret',
    turret_index: 0,
    gun_index: 0,
    gun_thickness: 60,
    gun_origin: GUN_ORIGIN,
    turret_spaced: [2],
    gun_spaced: [],
    // 俯仰限位（aimFromDrag 无 null 保护：真实配置必带；lower=-max/upper=-min 口径）
    pitch_limits: { min: -8, max: 20, transition: 20 },
    // 不提供 yaw_limits：走 turret_traverse_left/right(=180) 的全向回卷分支
    caliber: 105,
    shells: [{
      type: 'ap',
      name: 'AP',
      penetration: 200,
      damage: 320,
      module_damage: 100,
      explosion_radius: 0,
      caliber: 105,
      normalization: 5,
      ricochet: 70,
    }],
    shell_global_ids: [1],
  }],
  shells: [{ type: 'ap', name: 'AP', penetration: 200, damage: 320, module_damage: 100, explosion_radius: 0, caliber: 105, normalization: 5, ricochet: 70 }],
  caliber: 105,
}

/** 夹具名册（tank_cache.json：{id: info}）——populateTankLists 依赖该资产 */
export const FIXTURE_TANK_CACHE = {
  [FIXTURE_TANK_ID]: { id: FIXTURE_TANK_ID, name: 'Fixture Medium', tier: 8, nation: 'ussr', type: 'mediumTank' },
}

/* ------------------------------------------------------------------ 服务器 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store',
}

/**
 * 起一个极小的资产源（127.0.0.1 随机端口，CORS 放行）。路由与真实资产包同形：
 * /data/tank_cache.json、/tank/{id}.json、/glb/{id}/{armor,visual}.glb。
 * @param {{tankCache?: typeof FIXTURE_TANK_CACHE}} [options] 仅覆盖本实例名册，用于大列表布局回归。
 * @returns {Promise<{server: import('node:http').Server, origin: string, close: () => Promise<void>, requests: string[]}>}
 */
export async function startFixtureAssetPack({ tankCache = FIXTURE_TANK_CACHE } = {}) {
  const requests = []
  const routes = new Map([
    ['/data/tank_cache.json', { type: 'application/json', body: Buffer.from(JSON.stringify(tankCache)) }],
    [`/tank/${FIXTURE_TANK_ID}.json`, { type: 'application/json', body: Buffer.from(JSON.stringify(FIXTURE_TANK_DATA)) }],
    [`/glb/${FIXTURE_TANK_ID}/armor.glb`, { type: 'model/gltf-binary', body: FIXTURE_ARMOR_GLB }],
    [`/glb/${FIXTURE_TANK_ID}/visual.glb`, { type: 'model/gltf-binary', body: FIXTURE_VISUAL_GLB }],
  ])
  const server = createServer((req, res) => {
    const path = (req.url || '').split('?')[0]
    requests.push(path)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS)
      res.end()
      return
    }
    const route = routes.get(path)
    if (!route) {
      res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`fixture asset pack: no such asset ${path}（可用：${[...routes.keys()].join(', ')}）`)
      return
    }
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': route.type, 'Content-Length': route.body.length })
    res.end(route.body)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  return {
    server,
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
