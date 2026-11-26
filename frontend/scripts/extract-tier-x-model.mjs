#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import protobuf from 'protobufjs'
import { NodeIO } from '@gltf-transform/core'
import tankopedia from '../../common/tankopedia-tier10.json' with { type: 'json' }
import { MODEL_DEFINITIONS, TANK_ID_TO_MODEL } from '../src/vehicle-models/mapping.js'
import { VIEWBOX } from '../src/vehicle-models/types.js'
import {
  BLITZKIT_MODELS_PROTO,
  BLITZKIT_TANKS_MIN_PROTO,
  bounds2D,
  buildFeatureAudit,
  buildMetadata,
  collectNodeTriangles,
  groupRenderNodes,
  classifyDetail,
  clusterEdges,
  computeFit,
  correctZYTuple,
  decodeBlitzkitPb,
  edgesToSvgPath,
  extractMajorEdges,
  extractTopSurfaces,
  filterDegeneratePolys,
  mergeVisualSurfaces,
  rasterVisibility,
  projectTopDown,
  projectTopFacingPolygons,
  projectTriangles,
  selectDefaultModules,
  silhouetteToSvgPaths,
  simplifyRing,
  surfacesToSvgPaths,
  svgDocument,
  trianglesFromGeometry,
  unionTriangles,
  visibilityPixel,
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


const io = new NodeIO()


async function main() {
  const { tankId, modelKey } = resolveTank()
  const tank = tankopedia.vehicles.find((v) => v.id === tankId)
  if (!tank) throw new Error(`Tankopedia 无 tankId ${tankId}`)
  const def = MODEL_DEFINITIONS[modelKey]
  console.log(`== ${modelKey} (${tankId} ${tank.name}) kind=${def.kind} ==`)

  const glbPath = await download(`${API}/tanks/${tankId}/model.glb`, join(CACHE_DIR, 'models', `${tankId}.glb`))
  const modelsPbPath = await download(`${API}/definitions/models.pb`, join(CACHE_DIR, 'definitions', 'models.pb'))
  const tanksPbPath = await download(`${API}/definitions/tanks.pb`, join(CACHE_DIR, 'definitions', 'tanks.pb'))

  const modelDefs = decodeBlitzkitPb(readFileSync(modelsPbPath), 'blitzkit.ModelDefinitions', BLITZKIT_MODELS_PROTO)
  const tankDefs = decodeBlitzkitPb(readFileSync(tanksPbPath), 'blitzkit.TankDefinitions', BLITZKIT_TANKS_MIN_PROTO)
  const modules = selectDefaultModules(tankDefs, modelDefs, tankId)
  const { turretModelId, gunModelId, trackId, turretId, gunId } = modules
  console.log(`  selected: turret=${turretId} model_id=${turretModelId} gun=${gunId} model_id=${gunModelId} track=${trackId}`)

  const tmpGlb = join(CACHE_DIR, 'models', `${tankId}.tmp.glb`)
  mkdirSync(dirname(tmpGlb), { recursive: true })
  writeFileSync(tmpGlb, readFileSync(glbPath))
  const doc = await io.read(tmpGlb)
  const allNodes = doc.getRoot().listNodes()
  const groups = groupRenderNodes(allNodes, { turretId: turretModelId, gunId: gunModelId, withWheels: includeWheels })
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

  const tri3d = (group) => group.flatMap((m) => trianglesFromGeometry(m))
  const hullTris = tri3d(groups.hullBody)
  const trackTris = tri3d(groups.tracks)
  const turretTris = tri3d(groups.turret)
  const mantletTris = tri3d(groups.mantlet)
  const gunTris = tri3d(groups.gun)
  const hullPoly = unionTriangles(projectTriangles(hullTris))
  const turretPoly = unionTriangles(projectTriangles(turretTris))
  const gunPoly = unionTriangles(projectTriangles(gunTris))
  if (hullPoly.length === 0) throw new Error('hull silhouette union 为空')

  const polyPoints = (polys) => polys.flatMap((p) => p.ring.map(([x, y]) => ({ x, y })))
  const fitBounds = bounds2D(polyPoints(hullPoly).concat(polyPoints(turretPoly)))
  const fit = computeFit(fitBounds, VIEWBOX, PADDING_RATIO)
  console.log(`  fit: scale=${fit.scale.toFixed(4)} bounds=(${fitBounds.minX.toFixed(2)},${fitBounds.minY.toFixed(2)})..(${fitBounds.maxX.toFixed(2)},${fitBounds.maxY.toFixed(2)})`)
  const DETAIL_THRESHOLDS = {
    topFacingCos: 0.35,
    mergeAngleDeg: 20,
    mergeHeightDeltaM: 0.4,
    minAreaM2: 0.01,
    heightDeltaM: 0.15,
    normalDeltaCos: 0.995,
    minEdgeLenM: 1.0,
    minDetailUnits: 0.3,      // asset-space 微噪声（320px preview 下 0.3px）
  }
  const VIS_RES = 1024
  const VIS_MIN_PX = Number(process.env.VIS_MIN_PX ?? 13)
  const hullMergeAll = mergeVisualSurfaces(hullTris, DETAIL_THRESHOLDS)
  const hullSurfaceGroups = new Array(hullTris.length).fill(-1)
  hullMergeAll.surfaces.forEach((s, si) => { for (const fi of s.faceIdx) hullSurfaceGroups[fi] = si })
  const hullVis = rasterVisibility([...hullTris, ...trackTris], {
    ...DETAIL_THRESHOLDS, resolution: VIS_RES,
    groups: [...hullSurfaceGroups, ...new Array(trackTris.length).fill(-1)],
  })
  const trackVisibleCount = trackTris.filter((_, i) => hullVis.visiblePx[hullTris.length + i] > 0).length
  const surfacesFromMerge = (mergeAll, vis, startGid) =>
    mergeAll.surfaces
      .filter((_, si) => (vis.visibleGroupPx[startGid + si] ?? 0) >= VIS_MIN_PX)
      .filter((s) => s.areaM2 >= DETAIL_THRESHOLDS.minAreaM2)
      .map((s) => ({ z: s.zMean, polys: s.polys, areaM2: s.areaM2, faceCount: s.faceCount }))
  const hullSurfaces = surfacesFromMerge(hullMergeAll, hullVis, 0)
  const turretMergeAll = mergeVisualSurfaces(turretTris, DETAIL_THRESHOLDS)
  const mantletMergeAll = mergeVisualSurfaces(mantletTris, DETAIL_THRESHOLDS)
  const gunMergeAll = mergeVisualSurfaces(gunTris, DETAIL_THRESHOLDS)
  const sceneTris = [...turretTris, ...mantletTris, ...gunTris]
  const sceneGroups = new Array(sceneTris.length).fill(-1)
  let gid = 0
  const partRanges = []
  for (const { tris, mergeAll } of [
    { tris: turretTris, mergeAll: turretMergeAll },
    { tris: mantletTris, mergeAll: mantletMergeAll },
    { tris: gunTris, mergeAll: gunMergeAll },
  ]) {
    const base = 0
    mergeAll.surfaces.forEach((s, si) => {
      for (const fi of s.faceIdx) sceneGroups[base + fi] = gid + si
    })
    partRanges.push([gid, gid + mergeAll.surfaces.length])
    gid += mergeAll.surfaces.length
  }
  const turretVis = rasterVisibility(sceneTris, { ...DETAIL_THRESHOLDS, resolution: VIS_RES, groups: sceneGroups })
  const [tStart, tEnd] = partRanges[0]
  const [mStart, mEnd] = partRanges[1]
  const [gStart, gEnd] = partRanges[2]
  const visibleAndSized = (mergeAll, vis, startGid) =>
    mergeAll.surfaces
      .filter((_, si) => (vis.visibleGroupPx[startGid + si] ?? 0) >= VIS_MIN_PX)
      .filter((s) => s.areaM2 >= DETAIL_THRESHOLDS.minAreaM2)
      .map((s) => ({ z: s.zMean, polys: s.polys, areaM2: s.areaM2, faceCount: s.faceCount }))
  const turretSurfaces = visibleAndSized(turretMergeAll, turretVis, tStart)
  const mantletSurfaces = visibleAndSized(mantletMergeAll, turretVis, mStart)
  const gunSurfaces = visibleAndSized(gunMergeAll, turretVis, gStart)
  const hullMerge = hullMergeAll.stats
  const turretMerge = turretMergeAll.stats
  const hullEdgesRaw = extractMajorEdges(hullTris, DETAIL_THRESHOLDS)
  const turretEdgesRaw = extractMajorEdges(turretTris, DETAIL_THRESHOLDS)
  const edgesVisible = (e, vis) => {
    const len = Math.hypot(e.p2[0] - e.p1[0], e.p2[1] - e.p1[1])
    const steps = Math.max(2, Math.ceil(len / 0.3))
    let visCount = 0
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const wx = e.p1[0] + (e.p2[0] - e.p1[0]) * t
      const wy = e.p1[1] + (e.p2[1] - e.p1[1]) * t
      const pi = visibilityPixel(wx, wy, vis)
      if (pi >= 0 && vis.visibleMask[pi] === 1) visCount++
    }
    return visCount / (steps + 1) >= 0.6
  }
  const hullEdges = hullEdgesRaw.filter((e) => edgesVisible(e, hullVis))
  const turretEdges = turretEdgesRaw.filter((e) => edgesVisible(e, turretVis))
  const minUnits = DETAIL_THRESHOLDS.minDetailUnits
  const removedTiny = []
  const assetFilterPolys = (polys) => {
    const rest = []
    for (const p of polys) {
      const ring = simplifyRing(p.ring)
      const b = bounds2D(ring.map(([x, y]) => ({ x, y })))
      const wUnits = (b.maxX - b.minX) * fit.scale
      const hUnits = (b.maxY - b.minY) * fit.scale
      if (wUnits >= minUnits && hUnits >= minUnits) rest.push(p)
      else removedTiny.push(p)
    }
    const { kept, removed } = filterDegeneratePolys(rest)
    removedTiny.push(...removed)
    return kept
  }
  const filterSurfaces = (surfaces) =>
    surfaces
      .map((s) => ({ ...s, polys: assetFilterPolys(s.polys) }))
      .filter((s) => s.polys.length > 0)
  const dedupeEdges = (edges) => clusterEdges(edges, { angleDeg: 5, maxDistM: 0.2 })
  const hullSurfacesF = filterSurfaces(hullSurfaces)
  const turretSurfacesF = filterSurfaces(turretSurfaces)
  const mantletSurfacesF = filterSurfaces(mantletSurfaces)
  const gunSurfacesF = filterSurfaces(gunSurfaces)
  const hullEdgesF = dedupeEdges(hullEdges)
  const turretEdgesF = dedupeEdges(turretEdges)
  console.log(`  visibility: hull surfaces ${hullMergeAll.surfaces.length}→${hullSurfaces.length} tracksVisible=${trackVisibleCount} | turret ${turretMergeAll.surfaces.length}→${turretSurfaces.length} mantlet ${mantletMergeAll.surfaces.length}→${mantletSurfaces.length} gun ${gunMergeAll.surfaces.length}→${gunSurfaces.length}`)
  console.log(`  detail: hull surfaces ${hullSurfaces.length}→${hullSurfacesF.length} edges=${hullEdgesF.length} | turret ${turretSurfaces.length}→${turretSurfacesF.length} mantlet ${mantletSurfaces.length}→${mantletSurfacesF.length} gun ${gunSurfaces.length}→${gunSurfacesF.length} edges=${turretEdgesF.length}`)

  const GROUPS = { primary: 'vehicle-primary', secondary: 'vehicle-secondary', micro: 'vehicle-micro-detail' }
  const splitEdges = (edges) => {
    const sec = []
    const mic = []
    for (const e of edges) {
      const len = Math.hypot(e.p2[0] - e.p1[0], e.p2[1] - e.p1[1])
      ;(len >= 3.0 ? sec : mic).push(e)
    }
    return { sec, mic }
  }
  const put = (groups, paths, kind, areaM2 = 0, lengthM = 0) => {
    const g = classifyDetail({ kind, areaM2, lengthM })
    groups[g].push(...paths)
  }
  const hullGroups = { [GROUPS.primary]: [], [GROUPS.secondary]: [], [GROUPS.micro]: [] }
  const turretGroups = { [GROUPS.primary]: [], [GROUPS.secondary]: [], [GROUPS.micro]: [] }
  put(hullGroups, silhouetteToSvgPaths(hullPoly, fit, '#6d736f'), 'silhouette')
  for (const s of hullSurfacesF) put(hullGroups, surfacesToSvgPaths([s], fit, '#565e58'), 'surface', s.areaM2)
  {
    const { sec, mic } = splitEdges(hullEdgesF)
    const secP = edgesToSvgPath(sec, fit, '#333833')
    const micP = edgesToSvgPath(mic, fit, '#333833')
    if (secP) put(hullGroups, [secP], 'edge', 0, 3.0)
    if (micP) put(hullGroups, [micP], 'edge', 0, 0.5)
  }
  const hullSvg = svgDocument({ groups: [
    { group: GROUPS.primary, paths: hullGroups[GROUPS.primary] },
    { group: GROUPS.secondary, paths: hullGroups[GROUPS.secondary] },
    { group: GROUPS.micro, paths: hullGroups[GROUPS.micro] },
  ] }, VIEWBOX)

  put(turretGroups, silhouetteToSvgPaths(turretPoly, fit, '#7a817c'), 'silhouette')
  for (const s of turretSurfacesF) put(turretGroups, surfacesToSvgPaths([s], fit, '#6d756f'), 'surface', s.areaM2)
  for (const s of mantletSurfacesF) put(turretGroups, surfacesToSvgPaths([s], fit, '#656c67'), 'mantlet', s.areaM2)
  {
    const { sec, mic } = splitEdges(turretEdgesF)
    const secP = edgesToSvgPath(sec, fit, '#4a504c')
    const micP = edgesToSvgPath(mic, fit, '#4a504c')
    if (secP) put(turretGroups, [secP], 'edge', 0, 3.0)
    if (micP) put(turretGroups, [micP], 'edge', 0, 0.5)
  }
  for (const s of gunSurfacesF) put(turretGroups, surfacesToSvgPaths([s], fit, '#4d534f'), 'gun', s.areaM2)
  const turretSvg = svgDocument({ groups: [
    { group: GROUPS.primary, paths: turretGroups[GROUPS.primary] },
    { group: GROUPS.secondary, paths: turretGroups[GROUPS.secondary] },
    { group: GROUPS.micro, paths: turretGroups[GROUPS.micro] },
  ] }, VIEWBOX)
  const debugDir = join(CACHE_DIR, 'debug', modelKey)
  mkdirSync(debugDir, { recursive: true })
  const hb = bounds2D(polyPoints(hullPoly))
  const tb = bounds2D(polyPoints(turretPoly))
  const sourceHullRaw = projectTopFacingPolygons(hullTris, DETAIL_THRESHOLDS)
  const sourceTurretRaw = projectTopFacingPolygons(turretTris, DETAIL_THRESHOLDS)
  writeFileSync(join(debugDir, 'source-top-projection.svg'), svgDocument(
    [...silhouetteToSvgPaths(sourceHullRaw, fit, '#5c635e'),
     ...silhouetteToSvgPaths(sourceTurretRaw, fit, '#717873')], VIEWBOX))
  writeFileSync(join(debugDir, 'retained-surfaces.svg'), svgDocument(
    [...surfacesToSvgPaths(hullSurfacesF, fit, '#5c635e'),
     ...surfacesToSvgPaths(turretSurfacesF, fit, '#717873')], VIEWBOX))
  writeFileSync(join(debugDir, 'merged-surfaces.svg'), svgDocument(
    [...surfacesToSvgPaths(hullSurfaces, fit, '#5c635e'),
     ...surfacesToSvgPaths(turretSurfaces, fit, '#717873')], VIEWBOX))
  if (removedTiny.length > 0) {
    writeFileSync(join(debugDir, 'removed-tiny-details.svg'), svgDocument(
      silhouetteToSvgPaths(removedTiny, fit, '#aa3a3a'), VIEWBOX))
  }
  const dbgEdges = []
  const he = edgesToSvgPath(hullEdgesF, fit, '#333833')
  const te = edgesToSvgPath(turretEdgesF, fit, '#4a504c')
  if (he) dbgEdges.push(he)
  if (te) dbgEdges.push(te)
  writeFileSync(join(debugDir, 'feature-edges.svg'), svgDocument(dbgEdges, VIEWBOX))
  writeFileSync(join(debugDir, 'final-hull.svg'), hullSvg)
  writeFileSync(join(debugDir, 'final-turret.svg'), turretSvg)
  const mergeResultHull = mergeVisualSurfaces(hullTris, DETAIL_THRESHOLDS)
  const mergeResultTurret = mergeVisualSurfaces(turretTris, DETAIL_THRESHOLDS)
  const featureAudit = buildFeatureAudit({
    modelKey,
    sourceHull: mergeResultHull.surfaces,
    sourceTurret: mergeResultTurret.surfaces,
    finalHull: hullSurfacesF,
    finalTurret: turretSurfacesF,
    hullBounds: { min: [hb.minX, hb.minY], max: [hb.maxX, hb.maxY] },
    turretBounds: { min: [tb.minX, tb.minY], max: [tb.maxX, tb.maxY] },
  })
  writeFileSync(join(debugDir, 'feature-fidelity-report.json'), JSON.stringify(featureAudit, null, 2) + '\n')
  const groupStats = (groups) => ({
    primary: groups[GROUPS.primary].length,
    secondary: groups[GROUPS.secondary].length,
    micro: groups[GROUPS.micro].length,
  })
  const retainedRegionsOf = (surfaces) => surfaces.reduce((n, s) => n + s.polys.length, 0)
  writeFileSync(join(debugDir, 'extraction-report.json'), JSON.stringify({
    modelKey, tankId,
    fidelity: 'high',
    visibleDetailRetentionTarget: 0.9,
    thresholds: DETAIL_THRESHOLDS,
    fit: { scale: fit.scale, tx: fit.tx, ty: fit.ty },
    merge: {
      hull: hullMerge,
      turret: turretMerge,
    },
    counts: {
      hull: {
        tris: hullTri,
        rawProjectedRegions: hullMerge.rawFaces,
        mergedVisualSurfaces: hullSurfaces.length,
        tessellationRegionsMerged: hullMerge.mergedFaces,
        retainedRegions: retainedRegionsOf(hullSurfacesF),
        removedTinyRegions: removedTiny.length,
        edgesRaw: hullEdges.length,
        edges: hullEdgesF.length,
        groupPaths: groupStats(hullGroups),
      },
      turret: {
        tris: turretTri,
        rawProjectedRegions: turretMerge.rawFaces,
        mergedVisualSurfaces: turretSurfaces.length,
        tessellationRegionsMerged: turretMerge.mergedFaces,
        retainedRegions: retainedRegionsOf(turretSurfacesF),
        removedTinyRegions: removedTiny.length,
        edgesRaw: turretEdges.length,
        edges: turretEdgesF.length,
        groupPaths: groupStats(turretGroups),
      },
      tracks: countTri(groups.tracks),
      tracksVisibleTopFacing: trackVisibleCount,
      mantlet: countTri(groups.mantlet),
      mantletRetainedRegions: retainedRegionsOf(mantletSurfacesF),
      gun: gunTri,
      gunRetainedRegions: retainedRegionsOf(gunSurfacesF),
    },
  }, null, 2) + '\n')
  console.log(`  debug: ${debugDir}`)

  const origin = modules.turretOrigin || { x: 0, y: 0, z: 0 }
  const modelPivot = correctZYTuple({ x: origin.x, y: origin.y, z: origin.z })
  const pivot2d = projectTopDown(modelPivot)
  const svgPivot = { x: pivot2d.x * fit.scale + fit.tx, y: -pivot2d.y * fit.scale + fit.ty }
  console.log(`  raw turret_origin=(${origin.x},${origin.y},${origin.z}) -> projected turretPivot=(${svgPivot.x.toFixed(2)},${svgPivot.y.toFixed(2)})`)

  const outDir = outDirArg ? join(ROOT, outDirArg) : debugDir
  mkdirSync(outDir, { recursive: true })
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
    generationNotes: 'SVG debug/reference（正式资产为 texture-baked webp）；真实 LOD0 geometry 提取，仅滤 tiny/hidden/tessellation',
  })
  metadata.generation.fidelity = 'high'
  metadata.generation.geometryScale = 'faithful'
  metadata.generation.visibleDetailRetentionTarget = 0.9
  metadata.generation.detailMethod = 'top-surface-and-major-edge-extraction'
  metadata.generation.detailThresholds = DETAIL_THRESHOLDS
  writeFileSync(join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n')
  console.log(`  输出(debug): ${join(outDir, 'hull.svg')} / turret.svg / metadata.json`)
  console.log('RESULT: EXTRACTION OK')
}

main().catch((e) => {
  console.error(`[FAIL] ${e.message}`)
  process.exit(1)
})