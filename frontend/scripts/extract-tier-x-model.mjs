#!/usr/bin/env node
/**
 * BlitzKit vehicle model extractor（任务 2–13）— 开发者专用确定性几何提取。
 *
 * 从 BlitzKit 真实模型确定性生成俯视战术 SVG（替代 AI 手绘路线）：
 *   tankId → model.glb + models.pb + tanks.pb → 节点分组（复刻 BlitzKit TankModel）
 *   → 俯视投影 → 分组凸包 silhouette → 统一 fit 320×320 → hull.svg / turret.svg / metadata.json
 *
 * 用法（frontend 目录）：
 *   node scripts/extract-tier-x-model.mjs --tank-id 6929
 *   node scripts/extract-tier-x-model.mjs --model-key maus
 *   node scripts/extract-tier-x-model.mjs --model-key maus --force   # 刷新缓存
 *   node scripts/extract-tier-x-model.mjs --model-key maus --out-dir ../tmp/maus
 *
 * 网络边界（任务 17）：本脚本是唯一允许访问 BlitzKit 网络的位置；
 * production / Battle Playback / backend / CI 校验均只消费仓库内静态资产。
 * 缓存目录 gitignored：frontend/scripts/.vehicle-model-refs/
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import protobuf from 'protobufjs'
import { NodeIO } from '@gltf-transform/core'
import * as THREE from 'three'
import tankopedia from '../../common/tankopedia-tier10.json' with { type: 'json' }
import { MODEL_DEFINITIONS, TANK_ID_TO_MODEL } from '../src/vehicle-models/mapping.js'
import { VIEWBOX } from '../src/vehicle-models/types.js'
import {
  bounds2D,
  buildMetadata,
  computeFit,
  correctZYTuple,
  projectTopDown,
  projectTriangles,
  silhouetteToSvgPaths,
  svgDocument,
  trianglesFromGeometry,
  unionTriangles,
} from './extractor-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE_DIR = join(ROOT, 'frontend', 'scripts', '.vehicle-model-refs')
const API = 'https://api.blitzkit.app'
const PADDING_RATIO = 0.88

const args = process.argv.slice(2)
const tankIdArg = argValue(args, '--tank-id')
const modelKeyArg = argValue(args, '--model-key')
const force = args.includes('--force')
const includeWheels = args.includes('--include-wheels')
const outDirArg = argValue(args, '--out-dir')

function argValue(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

async function download(url, dest) {
  if (!force && existsSync(dest)) return dest
  mkdirSync(dirname(dest), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败 ${url}: HTTP ${res.status}`)
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  return dest
}

function resolveTank() {
  if (tankIdArg) {
    const key = TANK_ID_TO_MODEL[String(tankIdArg)]
    if (!key) throw new Error(`tankId ${tankIdArg} 不在 Tier X mapping 中`)
    return { tankId: Number(tankIdArg), modelKey: key }
  }
  if (modelKeyArg) {
    const def = MODEL_DEFINITIONS[modelKeyArg]
    if (!def) throw new Error(`modelKey ${modelKeyArg} 不在 MODEL_DEFINITIONS 中`)
    return { tankId: def.tankIds[0], modelKey: modelKeyArg }
  }
  throw new Error('必须提供 --tank-id 或 --model-key')
}

const MODELS_PROTO = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'protos/models.proto'), 'utf8')
const TANK_MIN_PROTO = `
syntax = "proto2";
package blitzkit;
message TankDefinitions { map<uint32, TankDefinition> tanks = 1; }
message TankDefinition {
  optional uint32 id = 1;
  repeated TurretDefinition turrets = 20;
  repeated TrackDefinition tracks = 22;
}
message TurretDefinition {
  optional uint32 id = 1;
  repeated GunDefinition guns = 9;
}
message GunDefinition { optional uint32 id = 4; }
message TrackDefinition { optional uint32 id = 1; }
`

/** protobufjs toObject 的 map 键可能是 number 或 string，统一容错取数。 */
function mapGet(map, key) {
  if (map == null) return undefined
  return map[key] ?? map[String(key)]
}

function decodePb(buffer, typeName, protoText) {
  const root = protobuf.parse(protoText).root
  const Type = root.lookupType(typeName)
  const message = Type.decode(new Uint8Array(buffer))
  return Type.toObject(message, { longs: Number, defaults: true, keepCase: true })
}

const io = new NodeIO()

/**
 * 收集节点子树所有 mesh 的三角形（POSITION + INDEX，应用节点/世界矩阵）。
 * 递归时跳过 *_hide_elements* 子树（可隐藏元素，不参与正式 silhouette）。
 */
function collectTriangles(node, out, matrix) {
  const m = matrix.clone()
  // @gltf-transform v3 的 Vector3/Quaternion 为数组 [x,y,z](,[w])
  const t = node.getTranslation()
  const r = node.getRotation()
  const s = node.getScale()
  if (t || r || s) {
    const e = new THREE.Matrix4().compose(
      new THREE.Vector3(t ? t[0] : 0, t ? t[1] : 0, t ? t[2] : 0),
      new THREE.Quaternion(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, r ? r[3] : 1),
      new THREE.Vector3(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1),
    )
    m.multiply(e)
  }
  const mesh = node.getMesh()
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION')
      if (!posAcc) continue
      const idxAcc = prim.getIndices()
      const positions = posAcc.getArray()
      const v = new THREE.Vector3()
      const transformed = new Float32Array(positions.length)
      for (let i = 0; i < positions.length; i += 3) {
        v.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(m)
        transformed[i] = v.x
        transformed[i + 1] = v.y
        transformed[i + 2] = v.z
      }
      out.push({
        positions: transformed,
        indices: idxAcc ? Array.from(idxAcc.getArray()) : null,
      })
    }
  }
  for (const c of node.listChildren()) {
    if (c.getName().includes('_hide_elements')) continue
    collectTriangles(c, out, m)
  }
}

/**
 * 节点分组（复刻 TankModel.tsx 契约 + Blocker 3 修正）：
 * - hull 层：hull + chassis_track_*（+ 可选 wheels）；
 * - turret 层：turret_{id:02d} + gun_{id:02d}_mask（mask = mantlet 炮盾，静态 0° 属于
 *   炮塔正面轮廓——TankModel 源码确认 mask 与 gun 同层渲染，但它是炮塔视觉的一部分，
 *   不参与 gun silhouette，避免扩大炮管轮廓）；
 * - gun 层：仅 gun_{id:02d}（炮管）。
 */
function groupNodes(rootNodes, { turretId, gunId, withWheels }) {
  const turretName = `turret_${String(turretId).padStart(2, '0')}`
  const gunName = `gun_${String(gunId).padStart(2, '0')}`
  const groups = { hull: [], turret: [], gun: [] }
  const identity = new THREE.Matrix4()
  for (const node of rootNodes) {
    const name = node.getName()
    if (name.includes('_hide_elements')) continue
    if (name === 'hull' || name.startsWith('chassis_track_') || (withWheels && name.startsWith('chassis_wheel_'))) {
      collectTriangles(node, groups.hull, identity)
    } else if (name === turretName) {
      collectTriangles(node, groups.turret, identity)
    } else if (name === gunName) {
      collectTriangles(node, groups.gun, identity)
    } else if (name === `${gunName}_mask`) {
      // mantlet（炮盾）→ turret 层（静态 0° 属于炮塔正面轮廓）
      collectTriangles(node, groups.turret, identity)
    }
  }
  return groups
}

async function main() {
  const { tankId, modelKey } = resolveTank()
  const tank = tankopedia.vehicles.find((v) => v.id === tankId)
  if (!tank) throw new Error(`Tankopedia 无 tankId ${tankId}`)
  const def = MODEL_DEFINITIONS[modelKey]
  console.log(`== ${modelKey} (${tankId} ${tank.name}) kind=${def.kind} ==`)

  const glbPath = await download(`${API}/tanks/${tankId}/model.glb`, join(CACHE_DIR, 'models', `${tankId}.glb`))
  const modelsPbPath = await download(`${API}/definitions/models.pb`, join(CACHE_DIR, 'definitions', 'models.pb'))
  const tanksPbPath = await download(`${API}/definitions/tanks.pb`, join(CACHE_DIR, 'definitions', 'tanks.pb'))

  const modelDefs = decodePb(readFileSync(modelsPbPath), 'blitzkit.ModelDefinitions', MODELS_PROTO)
  const modelDef = modelDefs.models[String(tankId)]
  if (!modelDef) throw new Error(`models.pb 无 tankId ${tankId} 的 ModelDefinition`)

  const tankDefs = decodePb(readFileSync(tanksPbPath), 'blitzkit.TankDefinitions', TANK_MIN_PROTO)
  const tankDef = tankDefs.tanks[String(tankId)]
  if (!tankDef || !tankDef.turrets || tankDef.turrets.length === 0) {
    throw new Error(`tanks.pb 无 tankId ${tankId} 的 turrets 配置`)
  }
  const turretDef = tankDef.turrets[tankDef.turrets.length - 1]
  const gunDef = turretDef.guns[turretDef.guns.length - 1]
  const trackDef = tankDef.tracks[tankDef.tracks.length - 1]
  const turretModelId = mapGet(modelDef.turrets, turretDef.id)?.modelId
  const gunModelId = mapGet(mapGet(modelDef.turrets, turretDef.id)?.guns, gunDef.id)?.modelId
  if (turretModelId === undefined || gunModelId === undefined) {
    throw new Error(`models.pb 缺 turret/gun model_id（turret=${turretDef.id} gun=${gunDef.id}）`)
  }
  console.log(`  selected: turret=${turretDef.id} model_id=${turretModelId} gun=${gunDef.id} model_id=${gunModelId} track=${trackDef.id}`)

  const tmpGlb = join(CACHE_DIR, 'models', `${tankId}.tmp.glb`)
  mkdirSync(dirname(tmpGlb), { recursive: true })
  writeFileSync(tmpGlb, readFileSync(glbPath))
  const doc = await io.read(tmpGlb)
  // TankModel.tsx 的 nodes = Object.values(gltf.nodes)——遍历全部节点按名匹配
  const allNodes = doc.getRoot().listNodes()
  const groups = groupNodes(allNodes, { turretId: turretModelId, gunId: gunModelId, withWheels: includeWheels })
  const countTri = (g) => g.reduce((n, m) => n + (m.indices ? m.indices.length / 3 : m.positions.length / 9), 0)
  const hullTri = countTri(groups.hull)
  const turretTri = countTri(groups.turret)
  const gunTri = countTri(groups.gun)
  if (hullTri < 3) throw new Error(`hull 几何为空（${hullTri} 三角形）`)
  if (def.kind === 'turreted') {
    if (turretTri < 3) throw new Error('turreted 车型未找到 selected turret 几何')
    if (gunTri < 3) throw new Error('turreted 车型未找到 selected gun 几何')
  }
  console.log(`  hull tris=${hullTri} turret tris=${turretTri} gun tris=${gunTri}`)

  // Blocker 1 — projected triangle polygon union（真实 silhouette，非 convex hull）
  const tri2d = (group) => projectTriangles(group.flatMap((m) => trianglesFromGeometry(m)))
  const hullTris2d = tri2d(groups.hull)
  const turretTris2d = tri2d(groups.turret)
  const gunTris2d = tri2d(groups.gun)
  const hullPoly = unionTriangles(hullTris2d)
  const turretPoly = unionTriangles(turretTris2d)
  const gunPoly = unionTriangles(gunTris2d)
  if (hullPoly.length === 0) throw new Error('hull silhouette union 为空')

  // fit bounds = hull + turret 主体（不含 gun——炮管允许 overflow）
  const polyPoints = (polys) => polys.flatMap((p) => p.ring.map(([x, y]) => ({ x, y })))
  const fitBounds = bounds2D(polyPoints(hullPoly).concat(polyPoints(turretPoly)))
  const fit = computeFit(fitBounds, VIEWBOX, PADDING_RATIO)
  console.log(`  fit: scale=${fit.scale.toFixed(4)} bounds=(${fitBounds.minX.toFixed(2)},${fitBounds.minY.toFixed(2)})..(${fitBounds.maxX.toFixed(2)},${fitBounds.maxY.toFixed(2)})`)

  const hullSvg = svgDocument(silhouetteToSvgPaths(hullPoly, fit, '#6d736f'), VIEWBOX)
  const turretSvgContent = [
    ...silhouetteToSvgPaths(turretPoly, fit, '#7a817c'),
    ...silhouetteToSvgPaths(gunPoly, fit, '#4d534f'),
  ]
  const turretSvg = svgDocument(turretSvgContent, VIEWBOX)

  const origin = modelDef.turretOrigin || { x: 0, y: 0, z: 0 }
  const modelPivot = correctZYTuple({ x: origin.x, y: origin.y, z: origin.z })
  const pivot2d = projectTopDown(modelPivot)
  const svgPivot = { x: pivot2d.x * fit.scale + fit.tx, y: -pivot2d.y * fit.scale + fit.ty }
  console.log(`  raw turret_origin=(${origin.x},${origin.y},${origin.z}) -> projected turretPivot=(${svgPivot.x.toFixed(2)},${svgPivot.y.toFixed(2)})`)

  const outDir = outDirArg ? join(ROOT, outDirArg) : join(ROOT, 'frontend', 'src', 'vehicle-models', 'assets', modelKey)
  mkdirSync(outDir, { recursive: true })
  const hb = bounds2D(polyPoints(hullPoly))
  const tb = bounds2D(polyPoints(turretPoly))
  const gb = bounds2D(polyPoints(gunPoly))
  // Blocker 2 evidence：raw projected bounds / center / origin（模型坐标，单位米）
  const tCenter = { x: (tb.minX + tb.maxX) / 2, y: (tb.minY + tb.maxY) / 2 }
  console.log('  [evidence] hull raw bbox:', JSON.stringify({ min: [hb.minX, hb.minY], max: [hb.maxX, hb.maxY] }))
  console.log('  [evidence] turret raw bbox:', JSON.stringify({ min: [tb.minX, tb.minY], max: [tb.maxX, tb.maxY] }))
  console.log('  [evidence] turret center:', JSON.stringify(tCenter))
  console.log('  [evidence] turretOrigin 引擎:', JSON.stringify(origin), '模型:', JSON.stringify(modelPivot))
  console.log('  [evidence] gun raw bbox:', JSON.stringify({ min: [gb.minX, gb.minY], max: [gb.maxX, gb.maxY] }))
  console.log('  [evidence] hull.svg 顶点数（简化后）:', hullSvg.split('L').length)
  console.log('  [evidence] turret.svg 顶点数（简化后）:', turretSvg.split('L').length)
  writeFileSync(join(outDir, 'hull.svg'), hullSvg)
  if (def.kind === 'turreted') writeFileSync(join(outDir, 'turret.svg'), turretSvg)
  const metadata = buildMetadata({
    modelKey,
    kind: def.kind,
    tankId,
    modelGlbUrl: `https://api.blitzkit.app/tanks/${tankId}/model.glb`,
    modelsPbUrl: `https://api.blitzkit.app/definitions/models.pb`,
    turretPivot: svgPivot,
    hullBounds: { min: [hb.minX, hb.minY], max: [hb.maxX, hb.maxY] },
    turretBounds: { min: [tb.minX, tb.minY], max: [tb.maxX, tb.maxY] },
    gunBounds: { min: [gb.minX, gb.minY], max: [gb.maxX, gb.maxY] },
    viewBox: VIEWBOX,
    generationNotes: '确定性提取自 BlitzKit model.glb（hull + tracks + selected turret/gun 节点；projected triangle union silhouette）',
  })
  writeFileSync(join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n')
  console.log(`  输出: ${join(outDir, 'hull.svg')} / turret.svg / metadata.json`)
  console.log('RESULT: EXTRACTION OK')
}

main().catch((e) => {
  console.error(`[FAIL] ${e.message}`)
  process.exit(1)
})
