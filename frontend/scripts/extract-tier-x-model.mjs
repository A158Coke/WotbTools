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
  clusterEdges,
  bumpsToSvgPaths,
  computeFit,
  correctZYTuple,
  edgesToSvgPath,
  extractMajorEdges,
  extractTopSurfaces,
  minSvgUnits,
  projectTopDown,
  projectTriangles,
  silhouetteToSvgPaths,
  simplifyRing,
  surfacesToSvgPaths,
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
/**
 * 节点分组（复刻 TankModel.tsx 契约 + Blocker 3 修正 + 本轮细化）：
 * - hullBody：hull 节点本体（不含 tracks）；
 * - tracks：chassis_track_{L,R}（独立区域——履带/车体分界以区域色差表达）；
 * - turret：turret_{id:02d}（不含 hide_elements）；
 * - mantlet：gun_{id:02d}_mask（炮盾，独立区域显示边界）；
 * - gun：gun_{id:02d}（炮管）。
 */
function groupNodes(rootNodes, { turretId, gunId, withWheels }) {
  const turretName = `turret_${String(turretId).padStart(2, '0')}`
  const gunName = `gun_${String(gunId).padStart(2, '0')}`
  const groups = { hullBody: [], tracks: [], turret: [], mantlet: [], gun: [] }
  const identity = new THREE.Matrix4()
  for (const node of rootNodes) {
    const name = node.getName()
    if (name.includes('_hide_elements')) continue
    if (name === 'hull') {
      collectTriangles(node, groups.hullBody, identity)
    } else if (name.startsWith('chassis_track_') || (withWheels && name.startsWith('chassis_wheel_'))) {
      collectTriangles(node, groups.tracks, identity)
    } else if (name === turretName) {
      collectTriangles(node, groups.turret, identity)
    } else if (name === gunName) {
      collectTriangles(node, groups.gun, identity)
    } else if (name === `${gunName}_mask`) {
      collectTriangles(node, groups.mantlet, identity)
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
  const hullTri = countTri(groups.hullBody)
  const turretTri = countTri(groups.turret)
  const gunTri = countTri(groups.gun)
  if (hullTri < 3) throw new Error(`hull 几何为空（${hullTri} 三角形）`)
  if (def.kind === 'turreted') {
    if (turretTri < 3) throw new Error('turreted 车型未找到 selected turret 几何')
    if (gunTri < 3) throw new Error('turreted 车型未找到 selected gun 几何')
  }
  console.log(`  hull tris=${hullTri} tracks tris=${countTri(groups.tracks)} turret tris=${turretTri} mantlet tris=${countTri(groups.mantlet)} gun tris=${gunTri}`)

  // —— Layer A：projected triangle polygon union（真实 silhouette）——
  const tri3d = (group) => group.flatMap((m) => trianglesFromGeometry(m))
  const hullTris = tri3d(groups.hullBody)
  const trackTris = tri3d(groups.tracks)
  const turretTris = tri3d(groups.turret)
  const mantletTris = tri3d(groups.mantlet)
  const gunTris = tri3d(groups.gun)
  const hullPoly = unionTriangles(projectTriangles(hullTris))
  const trackPoly = unionTriangles(projectTriangles(trackTris))
  const turretPoly = unionTriangles(projectTriangles(turretTris))
  const mantletPoly = unionTriangles(projectTriangles(mantletTris))
  const gunPoly = unionTriangles(projectTriangles(gunTris))
  if (hullPoly.length === 0) throw new Error('hull silhouette union 为空')

  // fit bounds = hull + turret 主体（不含 gun——炮管允许 overflow）
  const polyPoints = (polys) => polys.flatMap((p) => p.ring.map(([x, y]) => ({ x, y })))
  const fitBounds = bounds2D(polyPoints(hullPoly).concat(polyPoints(turretPoly)))
  const fit = computeFit(fitBounds, VIEWBOX, PADDING_RATIO)
  console.log(`  fit: scale=${fit.scale.toFixed(4)} bounds=(${fitBounds.minX.toFixed(2)},${fitBounds.minY.toFixed(2)})..(${fitBounds.maxX.toFixed(2)},${fitBounds.maxY.toFixed(2)})`)

  // —— Layer B：top-facing major surfaces + major structural edges ——
  // 阈值说明（2026-08-17 调校，适用全部车型，非 Maus 专属）：
  // - zTolerance 0.5：连续曲面（甲板/屋顶）合并为单层，只分离明显高度带；
  // - minEdgeLenM 1.5：只保留明显结构边（≈4px @28px），过滤格栅/碎边；
  // - heightDeltaM 0.15 + normal 辅助：高度差驱动，防密集线；
  // - bumpSignificanceRatio 0.1：凸起在该层凸起总量占比过低 = 粗糙面片伪影（噪声），
  //   只保留有语义的大特征（hatch / cupola / 甲板条带）——"少而强"。
  const DETAIL_THRESHOLDS = {
    topFacingCos: 0.35,
    zTolerance: 0.5,
    minAreaM2: 0.25,
    bumpDelta: 0.08,
    minBumpAreaM2: 0.05,
    bumpSignificanceRatio: 0.1,
    heightDeltaM: 0.15,
    normalDeltaCos: 0.92,
    minEdgeLenM: 1.5,
    minDetailPx: 0.8,
  }
  const hullSurfaces = extractTopSurfaces(hullTris, DETAIL_THRESHOLDS)
  const turretSurfaces = extractTopSurfaces(turretTris, DETAIL_THRESHOLDS)
  const hullEdges = extractMajorEdges(hullTris, DETAIL_THRESHOLDS)
  const turretEdges = extractMajorEdges(turretTris, DETAIL_THRESHOLDS)
  const minSvg = minSvgUnits(DETAIL_THRESHOLDS.minDetailPx, VIEWBOX.width, 28)
  // 屏幕空间过滤：区域最小边长 + 边最小长度（SVG units ≥ ~0.8px）。
  // 用 simplifyRing 后的 ring 计算（与最终渲染形状一致——修复重复点后
  // polygon-clipping 产生的发丝状退化 polygon 在此被正确过滤）。
  const screenFilterPolys = (polys) =>
    polys.filter((p) => {
      const ring = simplifyRing(p.ring)
      const b = bounds2D(ring.map(([x, y]) => ({ x, y })))
      return (b.maxX - b.minX) * fit.scale >= minSvg && (b.maxY - b.minY) * fit.scale >= minSvg
    })
  const screenSurfaces = (surfaces) =>
    surfaces
      .map((s) => ({
        ...s,
        polys: screenFilterPolys(s.polys),
        bumps: s.bumps
          .map((b) => ({ ...b, polys: screenFilterPolys(b.polys) }))
          .filter((b) => b.polys.length > 0),
      }))
      .filter((s) => s.polys.length > 0 || s.bumps.length > 0)
  const screenEdges = (edges) =>
    edges.filter((e) => {
      const len = Math.hypot(e.p2[0] - e.p1[0], e.p2[1] - e.p1[1]) * fit.scale
      return len >= minSvg
    })
  // 少而强：先聚类去重（同一条结构线只保留最长边，防斜切台阶交叉线），
  // 再按投影长度降序保留上限条数
  const capEdges = (edges, cap) =>
    clusterEdges(edges, { angleDeg: 15, maxDistM: 0.15 })
      .map((e) => ({ ...e, len: Math.hypot(e.p2[0] - e.p1[0], e.p2[1] - e.p1[1]) }))
      .sort((a, b) => b.len - a.len)
      .slice(0, cap)
      .map(({ len, ...e }) => e)
  const hullSurfacesF = screenSurfaces(hullSurfaces)
  const turretSurfacesF = screenSurfaces(turretSurfaces)
  const hullEdgesF = capEdges(screenEdges(hullEdges), 8)
  const turretEdgesF = capEdges(screenEdges(turretEdges), 6)
  const bumpCount = (s) => s.reduce((n, x) => n + x.bumps.length, 0)
  console.log(`  detail: hull surfaces ${hullSurfaces.length}→${hullSurfacesF.length} bumps=${bumpCount(hullSurfacesF)} edges→${hullEdgesF.length} | turret surfaces ${turretSurfaces.length}→${turretSurfacesF.length} bumps=${bumpCount(turretSurfacesF)} edges→${turretEdgesF.length}`)

  // —— SVG 输出（多 path，neutral gray，内嵌样式；detail 与 silhouette 同一 fit）——
  // 绘制顺序 = 视觉层次：车体轮廓 → 主面（甲板/glacis 等）→ 履带（深色侧带，
  // 覆盖在甲板之上才可见——Maus 甲板全宽，履带投影被甲板遮住）→ 凸起 → 结构边。
  const hullSvgContent = [
    ...silhouetteToSvgPaths(hullPoly, fit, '#6d736f'),      // Layer A 车体
    ...surfacesToSvgPaths(hullSurfacesF, fit, '#565e58'),   // 主面高度层（稍深，层次更强）
    ...silhouetteToSvgPaths(trackPoly, fit, '#454b47'),     // 履带独立区域（深色侧带，压在主面之上）
    ...bumpsToSvgPaths(hullSurfacesF, fit, '#6f776f'),      // 层内凸起（hatch / 甲板凸块，稍浅）
  ]
  const hullEdgePath = edgesToSvgPath(hullEdgesF, fit, '#333833')
  if (hullEdgePath) hullSvgContent.push(hullEdgePath)
  const hullSvg = svgDocument(hullSvgContent, VIEWBOX)

  const turretSvgContent = [
    ...silhouetteToSvgPaths(turretPoly, fit, '#7a817c'),    // 炮塔主体
    ...surfacesToSvgPaths(turretSurfacesF, fit, '#6d756f'), // 屋顶/环主面（稍深）
    ...bumpsToSvgPaths(turretSurfacesF, fit, '#838b85'),    // 屋顶凸起（cupola / hatch，稍浅）
    ...silhouetteToSvgPaths(mantletPoly, fit, '#656c67'),   // 炮盾独立区域
  ]
  const turretEdgePath = edgesToSvgPath(turretEdgesF, fit, '#4a504c')
  if (turretEdgePath) turretSvgContent.push(turretEdgePath)
  turretSvgContent.push(...silhouetteToSvgPaths(gunPoly, fit, '#4d534f')) // 炮管
  const turretSvg = svgDocument(turretSvgContent, VIEWBOX)

  // —— debug artifacts（gitignored 缓存目录，不提交正式 repo）——
  const debugDir = join(CACHE_DIR, 'debug', modelKey)
  mkdirSync(debugDir, { recursive: true })
  writeFileSync(join(debugDir, 'silhouette.svg'), svgDocument(
    [...silhouetteToSvgPaths(hullPoly, fit, '#6d736f'), ...silhouetteToSvgPaths(turretPoly, fit, '#7a817c')], VIEWBOX))
  writeFileSync(join(debugDir, 'top-surfaces.svg'), svgDocument(
    [...surfacesToSvgPaths(hullSurfacesF, fit, '#5c635e'), ...bumpsToSvgPaths(hullSurfacesF, fit, '#6f776f'),
     ...surfacesToSvgPaths(turretSurfacesF, fit, '#717873'), ...bumpsToSvgPaths(turretSurfacesF, fit, '#838b85')], VIEWBOX))
  const dbgEdges = []
  const he = edgesToSvgPath(hullEdgesF, fit, '#333833')
  const te = edgesToSvgPath(turretEdgesF, fit, '#4a504c')
  if (he) dbgEdges.push(he)
  if (te) dbgEdges.push(te)
  writeFileSync(join(debugDir, 'major-edges.svg'), svgDocument(dbgEdges, VIEWBOX))
  writeFileSync(join(debugDir, 'final.svg'), hullSvg)
  writeFileSync(join(debugDir, 'extraction-report.json'), JSON.stringify({
    modelKey, tankId,
    thresholds: DETAIL_THRESHOLDS,
    fit: { scale: fit.scale, tx: fit.tx, ty: fit.ty },
    counts: {
      hull: { tris: hullTri, surfacesRaw: hullSurfaces.length, surfaces: hullSurfacesF.length, bumps: bumpCount(hullSurfacesF), edgesRaw: hullEdges.length, edges: hullEdgesF.length },
      turret: { tris: turretTri, surfacesRaw: turretSurfaces.length, surfaces: turretSurfacesF.length, bumps: bumpCount(turretSurfacesF), edgesRaw: turretEdges.length, edges: turretEdgesF.length },
      tracks: countTri(groups.tracks),
      mantlet: countTri(groups.mantlet),
      gun: gunTri,
    },
  }, null, 2) + '\n')
  console.log(`  debug: ${debugDir}`)

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
  const tCenter = { x: (tb.minX + tb.maxX) / 2, y: (tb.minY + tb.maxY) / 2 }
  console.log('  [evidence] hull raw bbox:', JSON.stringify({ min: [hb.minX, hb.minY], max: [hb.maxX, hb.maxY] }))
  console.log('  [evidence] turret raw bbox:', JSON.stringify({ min: [tb.minX, tb.minY], max: [tb.maxX, tb.maxY] }))
  console.log('  [evidence] turret center:', JSON.stringify(tCenter))
  console.log('  [evidence] turretOrigin 引擎:', JSON.stringify(origin), '模型:', JSON.stringify(modelPivot))
  console.log('  [evidence] gun raw bbox:', JSON.stringify({ min: [gb.minX, gb.minY], max: [gb.maxX, gb.maxY] }))
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
    generationNotes: '确定性提取自 BlitzKit model.glb（Layer A silhouette + Layer B top-surface/major-edge details）',
  })
  metadata.generation.detailMethod = 'top-surface-and-major-edge-extraction'
  metadata.generation.detailThresholds = DETAIL_THRESHOLDS
  writeFileSync(join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n')
  console.log(`  输出: ${join(outDir, 'hull.svg')} / turret.svg / metadata.json`)
  console.log('RESULT: EXTRACTION OK')
}

main().catch((e) => {
  console.error(`[FAIL] ${e.message}`)
  process.exit(1)
})