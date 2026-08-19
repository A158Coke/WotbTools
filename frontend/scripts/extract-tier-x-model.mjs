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
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {NodeIO} from '@gltf-transform/core'
import tankopedia from '../../common/tankopedia-tier10.json' with {type: 'json'}
import {MODEL_DEFINITIONS, TANK_ID_TO_MODEL} from '../src/vehicle-models/mapping.js'
import {VIEWBOX} from '../src/vehicle-models/types.js'
import {
    BLITZKIT_MODELS_PROTO,
    BLITZKIT_TANKS_MIN_PROTO,
    bounds2D,
    buildFeatureAudit,
    buildMetadata,
    classifyDetail,
    clusterEdges,
    computeFit,
    correctZYTuple,
    decodeBlitzkitPb,
    edgesToSvgPath,
    extractMajorEdges,
    filterDegeneratePolys,
    groupRenderNodes,
    mergeVisualSurfaces,
    projectTopDown,
    projectTopFacingPolygons,
    projectTriangles,
    rasterVisibility,
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

// BlitzKit definitions 解析共享：BLITZKIT_MODELS_PROTO / BLITZKIT_TANKS_MIN_PROTO /
// mapGet / decodeBlitzkitPb / selectDefaultModules 在 extractor-lib.mjs（extractor 与 bake 共用）。

const io = new NodeIO()

// collectNodeTriangles / groupRenderNodes 已移至 extractor-lib.mjs（可测试）：
// 复刻 TankModel.tsx 顶层名匹配 + 完整子树采集（含 *_hide_elements*，无名字黑名单）。

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
  // TankModel.tsx 的 nodes = Object.values(gltf.nodes)——遍历全部节点按名匹配
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

  // —— Layer A：projected triangle polygon union（真实 silhouette）——
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

  // fit bounds = hull + turret 主体（不含 gun——炮管允许 overflow）
  const polyPoints = (polys) => polys.flatMap((p) => p.ring.map(([x, y]) => ({ x, y })))
  const fitBounds = bounds2D(polyPoints(hullPoly).concat(polyPoints(turretPoly)))
  const fit = computeFit(fitBounds, VIEWBOX, PADDING_RATIO)
  console.log(`  fit: scale=${fit.scale.toFixed(4)} bounds=(${fitBounds.minX.toFixed(2)},${fitBounds.minY.toFixed(2)})..(${fitBounds.maxX.toFixed(2)},${fitBounds.maxY.toFixed(2)})`)
  // —— Layer B：top-facing surfaces + bumps + structural edges（HIGH-FIDELITY ASSET）——
  // 高保真策略（2026-08-18）：
  // - 视觉表面合并（Blocker 1/2/4）：triangle tessellation / low-poly topology 合并为
  //   视觉连续表面——连续 roof/deck/斜面是一个/少量 polygon，不输出三角马赛克；
  //   真实结构分离（height step / vertical wall / gap / strong normal break /
  //   isolated feature）保持独立区域；
  // - 真实 top-view 可见结构默认保留（目标 retention >= 90%）；
  // - 不按 20-30px marker 过滤真实 detail（runtime LOD 负责小尺寸显示）；
  // - 不设 edge/path 数量上限——只限制"是不是实际视觉结构"（删 duplicate/overlap/
  //   tessellation 对角线，保留 component/height/normal 边界）。
  const DETAIL_THRESHOLDS = {
    topFacingCos: 0.35,       // 顶面判定（法线 z 分量）
    mergeAngleDeg: 20,        // 视觉连续合并：相邻面片法线差 ≤ 20°（环带/斜面面片间 ~17.5°）
    mergeHeightDeltaM: 0.4,   // 视觉连续合并：相邻面片高度差 ≤ 0.4m（环带面片间 ~0.24m）
    minAreaM2: 0.01,          // surface 区域最小投影面积（≈3 units @320，asset-space 极小）
    heightDeltaM: 0.15,       // feature edge 高度差（surface-edge 壁高 / height 边）
    normalDeltaCos: 0.995,    // ~5.7°：同一平滑曲面的面片法线差不算 feature
    minEdgeLenM: 1.0,         // 边最短投影长度（保留 hatch/panel 级边缘）
    minDetailUnits: 0.3,      // asset-space 微噪声（320px preview 下 0.3px）
  }
  // —— A3：真实 z-buffer 顶视可见性（视觉层基础）——
  // 全量 merge → surface 级可见性（rasterVisibility 分组累计赢家像素）：
  // 部分可见的 surface 保留整面（不切碎成三角形残留）；完全遮挡的 surface
  // （可见像素 < VIS_MIN_PX ≈ 320px 视口 1px²）剔除——tracks 顶视可见 0 → 视觉层不画。
  // silhouette 契约仍由完整几何 union 提供（hullPoly/turretPoly，见 Layer A）。
  const VIS_RES = 1024
  const VIS_MIN_PX = Number(process.env.VIS_MIN_PX ?? 13) // 1024 栅格 1px ≈ 8.8mm；13px² ≈ 10cm² ≈ 320px 视口 1px²
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
      .filter((s) => s.areaM2 >= DETAIL_THRESHOLDS.minAreaM2) // 320 下 <1px² 的 surface 不输出
      .map((s) => ({ z: s.zMean, polys: s.polys, areaM2: s.areaM2, faceCount: s.faceCount }))
  const hullSurfaces = surfacesFromMerge(hullMergeAll, hullVis, 0)
  // turret 场景 = turret + mantlet + gun（联合 z-buffer：mantlet 后部被屋顶遮挡剔除）
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
  // source 统计（audit 对照：全量几何的 merge，不参与视觉层）
  const hullMerge = hullMergeAll.stats
  const turretMerge = turretMergeAll.stats
  // 结构边从全量几何提取（surface-edge 需要垂直壁邻居配对，壁面非 top-facing），
  // 再按"边中点是否真实可见"过滤（A3：被遮挡结构不画边）——保留顶视可见结构边。
  const hullEdgesRaw = extractMajorEdges(hullTris, DETAIL_THRESHOLDS)
  const turretEdgesRaw = extractMajorEdges(turretTris, DETAIL_THRESHOLDS)
  // 沿边多点采样判定可见比例（≥60% 采样点可见才保留）——长结构边（如屋顶轮廓）
  // 部分被遮挡时仍保留可见段，避免"中点恰被遮 → 整条丢失"。
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
  // asset-space 微噪声过滤（320 viewBox units）：只删宽/高 < 0.3 units（<1cm）的 path；
  // A2：真实长条不再按纵横比删除——退化判定改为几何退化（filterDegeneratePolys）：
  //   自交 ring / near-zero 面积 / bbox 窄边 <5mm 数值 sliver / 完全重合重复。
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
  // 去重聚类：duplicate/overlapping edge 合并为同一条结构线（保留最长边）；不截断数量
  const dedupeEdges = (edges) => clusterEdges(edges, { angleDeg: 5, maxDistM: 0.2 })
  const hullSurfacesF = filterSurfaces(hullSurfaces)
  const turretSurfacesF = filterSurfaces(turretSurfaces)
  const mantletSurfacesF = filterSurfaces(mantletSurfaces)
  const gunSurfacesF = filterSurfaces(gunSurfaces)
  const hullEdgesF = dedupeEdges(hullEdges)
  const turretEdgesF = dedupeEdges(turretEdges)
  console.log(`  visibility: hull surfaces ${hullMergeAll.surfaces.length}→${hullSurfaces.length} tracksVisible=${trackVisibleCount} | turret ${turretMergeAll.surfaces.length}→${turretSurfaces.length} mantlet ${mantletMergeAll.surfaces.length}→${mantletSurfaces.length} gun ${gunMergeAll.surfaces.length}→${gunSurfaces.length}`)
  console.log(`  detail: hull surfaces ${hullSurfaces.length}→${hullSurfacesF.length} edges=${hullEdgesF.length} | turret ${turretSurfaces.length}→${turretSurfacesF.length} mantlet ${mantletSurfaces.length}→${mantletSurfacesF.length} gun ${gunSurfaces.length}→${gunSurfacesF.length} edges=${turretEdgesF.length}`)

  // —— SVG 输出（detail-level grouping：primary/secondary/micro，为未来 runtime LOD 准备结构）——
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
  // 绘制顺序 = 视觉层次：轮廓 → 顶视可见主面 → 结构边。
  // A3：视觉层基于真实顶视可见性（rasterVisibility）——tracks 顶视可见 0，
  // 不再画 2D union 深色条；mantlet/gun 只画顶视可见表面（不再画完整 2D 轮廓）。
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
  // A3：mantlet/gun 视觉层 = 顶视可见表面（z-buffer），不再画完整 2D union 轮廓
  for (const s of mantletSurfacesF) put(turretGroups, surfacesToSvgPaths([s], fit, '#656c67'), 'mantlet', s.areaM2)
  {
    const { sec, mic } = splitEdges(turretEdgesF)
    const secP = edgesToSvgPath(sec, fit, '#4a504c')
    const micP = edgesToSvgPath(mic, fit, '#4a504c')
    if (secP) put(turretGroups, [secP], 'edge', 0, 3.0)
    if (micP) put(turretGroups, [micP], 'edge', 0, 0.5)
  }
  for (const s of gunSurfacesF) put(turretGroups, surfacesToSvgPaths([s], fit, '#4d534f'), 'gun', s.areaM2) // 炮管顶面（primary，组内最后）
  const turretSvg = svgDocument({ groups: [
    { group: GROUPS.primary, paths: turretGroups[GROUPS.primary] },
    { group: GROUPS.secondary, paths: turretGroups[GROUPS.secondary] },
    { group: GROUPS.micro, paths: turretGroups[GROUPS.micro] },
  ] }, VIEWBOX)
  // —— debug artifacts（gitignored 缓存目录，不提交正式 repo）——
  // HIGH-FIDELITY evidence：
  //   source-top-projection（真正的 raw ground truth：每个 top-facing 三角形独立投影，
  //     无 merge / 无遮挡 / 无微小过滤——可显示 source 三角化结构）
  //   merged-surfaces（视觉表面合并后、过滤前）
  //   retained-surfaces / removed-tiny-details / feature-edges
  //   final-hull / final-turret（最终 SVG）
  //   feature-fidelity-report.json（source vs final feature audit）
  const debugDir = join(CACHE_DIR, 'debug', modelKey)
  mkdirSync(debugDir, { recursive: true })
  // hull/turret 几何 bounds（由真实投影计算，非硬编码——feature audit 用）
  const hb = bounds2D(polyPoints(hullPoly))
  const tb = bounds2D(polyPoints(turretPoly))
  // raw ground truth：top-facing 三角形逐个投影（不做视觉表面合并）
  const sourceHullRaw = projectTopFacingPolygons(hullTris, DETAIL_THRESHOLDS)
  const sourceTurretRaw = projectTopFacingPolygons(turretTris, DETAIL_THRESHOLDS)
  writeFileSync(join(debugDir, 'source-top-projection.svg'), svgDocument(
    [...silhouetteToSvgPaths(sourceHullRaw, fit, '#5c635e'),
     ...silhouetteToSvgPaths(sourceTurretRaw, fit, '#717873')], VIEWBOX))
  writeFileSync(join(debugDir, 'retained-surfaces.svg'), svgDocument(
    [...surfacesToSvgPaths(hullSurfacesF, fit, '#5c635e'),
     ...surfacesToSvgPaths(turretSurfacesF, fit, '#717873')], VIEWBOX))
  // merged visual surfaces（合并后、过滤前）
  writeFileSync(join(debugDir, 'merged-surfaces.svg'), svgDocument(
    [...surfacesToSvgPaths(hullSurfaces, fit, '#5c635e'),
     ...surfacesToSvgPaths(turretSurfaces, fit, '#717873')], VIEWBOX))
  // removed tessellation：raw faces 中不属于任何保留表面的（即合并吸收的三角形）
  // —— 由 report 的 mergedFaces 统计表达；removed-tiny-details 表达 asset 过滤 ——
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
  // —— feature fidelity audit（Blocker 3：region count ≠ visual fidelity）——
  // 基于几何（z 带 / 位置 / 面积）自动分类 source-visible 结构类别，
  // 每类标记 detected（source 合并后）/ retained（final 过滤后）/
  // filtered（仅微小/遮挡/退化过滤）/ merged-into（合并进主表面）。
  // bounds 来自真实投影计算（hb/tb），无车型专属硬编码；
  // source 用合并后表面（merge 是视觉连续性处理，非过滤）——final 与其比较。
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
  // 分组 path 统计（primary/secondary/micro）
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

  // 正式资产契约已迁移为 texture-baked webp（bake-tier-x-topview.mjs 生成）——
  // SVG 仅作 debug/reference：默认输出到 gitignored debug 目录，不再写入 assets/。
  const outDir = outDirArg ? join(ROOT, outDirArg) : debugDir
  mkdirSync(outDir, { recursive: true })
  // hb/tb 已在 debug 段计算（feature audit 共用）
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