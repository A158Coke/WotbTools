#!/usr/bin/env node
/**
 * turretPivot 独立几何验证（PR #92 Review B1，第三轮——collectVerts matrix traversal 修复）。
 *
 * 数据流（不变量：待验证的 metadata.turretPivot / computeTurretModelPivot 不参与生成样本）：
 * - GLB 旋转层原始顶点（模型坐标，yaw=0 装配姿态）经 collectNodeVerts 采集——
 *   与 extractor-lib.mjs::collectNodeTriangles **同一 hierarchy 语义**（单源复用，
 *   不维护两套 traversal）：
 *     worldMatrix = parentMatrix · nodeLocalMatrix（node 自身 TRS 乘入后作用于自己的 mesh，
 *     children 递归传 worldMatrix）；
 * - 逐行复刻 BlitzKit useTankTransform.ts scene graph：
 *     turretContainer.position = turretPosition(yaw)
 *       = R_z(yaw)·(-(hullOrigin+turretOrigin))
 *         [若有 initial_turret_rotation：再 .applyAxisAngle(I, pitch).applyAxisAngle(J, roll).applyAxisAngle(K, yaw)]
 *         + hullOrigin + turretOrigin
 *     turretContainer.rotation = Euler(initialPitch, initialRoll, yaw + initialYaw)（three.js XYZ 序）
 *     world(yaw) = R(rotation)·v + position（origins 直接取自 models.pb 原始数据）；
 * - 只根据 world(yaw0) 与 world(yawN) 两批顶点反求 2D rotation center（垂直平分线最小二乘），
 *   最后才经 bake-report.fit 反投影与 metadata.turretPivot 比对（err < 0.05m）。
 *
 * 旋转角：无 yaw 限位 0°/90°；limited-traverse 自动读 models.pb yaw 限位（grille-15 65°、
 * nc-70 10°、fv215b-183/xm66f/minotauro 45°）。
 *
 * minotauro：真实包含 initial_turret_rotation（pitch=3°）——完整复刻；pitch 使顶视投影
 * 非纯 2D 旋转，反推中心有 ~2-3cm 物理偏差，报告原值不放宽阈值。
 *
 * 另输出（可复现工程证据）：
 * - 每台 selected 节点（turret_01 / gun_01 / gun_01_mask）的实际 local TRS；
 * - **bottom turret-ring anchor**：turret_01 子树底部带（z ∈ [minZ, minZ+0.2]）顶视质心
 *   vs pivot 模型坐标距离——座圈环中心应落在 pivot 附近（数值仅作几何佐证，不作为
 *   PASS/FAIL 判据；输出可复现，供 QA/评审核对）。
 *
 * 依赖 developer 缓存（frontend/scripts/.vehicle-model-refs/）；CI 不执行。
 *
 * 用法（frontend 目录）：
 *   node scripts/verify-pivot-independent.mjs                # 全部 turreted
 *   node scripts/verify-pivot-independent.mjs maus grille-15
 */
import {existsSync, readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {NodeIO} from '@gltf-transform/core'
import * as THREE from 'three'
import {BLITZKIT_MODELS_PROTO, BLITZKIT_TANKS_MIN_PROTO, collectNodeVerts, decodeBlitzkitPb,} from './extractor-lib.mjs'
import {MODEL_DEFINITIONS} from '../src/vehicle-models/mapping.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE = join(ROOT, 'frontend', 'scripts', '.vehicle-model-refs')
const ASSETS = join(ROOT, 'frontend', 'src', 'vehicle-models', 'assets')

const models = decodeBlitzkitPb(readFileSync(join(CACHE, 'definitions', 'models.pb')), 'blitzkit.ModelDefinitions', BLITZKIT_MODELS_PROTO)
const tanks = decodeBlitzkitPb(readFileSync(join(CACHE, 'definitions', 'tanks.pb')), 'blitzkit.TankDefinitions', BLITZKIT_TANKS_MIN_PROTO)
const io = new NodeIO()

/** 节点 local TRS 摘要（用于报告；无 TRS 时显示 null）。 */
function trsSummary(node) {
  const t = node.getTranslation() || null
  const r = node.getRotation() || null
  const s = node.getScale() || null
  const fmt = (a) => (a ? a.map((v) => +(+v).toFixed(4)).join(',') : 'null')
  return 't=(' + fmt(t) + ') r=(' + fmt(r) + ') s=(' + fmt(s) + ')'
}

/**
 * 复刻 BlitzKit useTankTransform.ts（权威源码逐行）：
 * 返回把容器局部顶点 v 变换到 world 的函数 world(yawDeg) = R(rotation)·v + position。
 * @param {{hullOrigin:{x,y,z}, turretOrigin:{x,y,z}, initial:object|null}} o 模型坐标 origins
 */
function buildTurretContainer(o) {
  const c = { x: o.hullOrigin.x + o.turretOrigin.x, y: o.hullOrigin.y + o.turretOrigin.y, z: o.hullOrigin.z + o.turretOrigin.z }
  const init = o.initial
  const ip = init ? (-init.pitch * Math.PI) / 180 : 0
  const ir = init ? (-init.roll * Math.PI) / 180 : 0
  const iy = init ? (-init.yaw * Math.PI) / 180 : 0
  return (yawDeg) => {
    const rad = (yawDeg * Math.PI) / 180
    const pos = new THREE.Vector3(-c.x, -c.y, -c.z).applyAxisAngle(new THREE.Vector3(0, 0, 1), rad)
    if (init) {
      pos.applyAxisAngle(new THREE.Vector3(1, 0, 0), ip)
      pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), ir)
      pos.applyAxisAngle(new THREE.Vector3(0, 0, 1), iy)
    }
    pos.add(new THREE.Vector3(c.x, c.y, c.z))
    const rot = new THREE.Euler(ip, ir, rad + iy, 'XYZ')
    const rotM = new THREE.Matrix4().makeRotationFromEuler(rot)
    return (v) => {
      const p = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(rotM).add(pos)
      return [p.x, p.y, p.z]
    }
  }
}

/** 垂直平分线最小二乘求 2D 旋转中心（顶视投影）。 */
function solveRotationCenter(pairs) {
  let A = 0, B = 0, C = 0, D = 0, E = 0, used = 0
  for (const [[x0, y0], [x1, y1]] of pairs) {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2
    const dx = x1 - x0, dy = y1 - y0
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue
    A += dx * dx; B += dx * dy; C += dx * (dx * mx + dy * my)
    D += dy * dy; E += dy * (dx * mx + dy * my)
    used++
  }
  const det = A * D - B * B
  if (Math.abs(det) < 1e-12 || used < 8) return null
  return { x: (C * D - B * E) / det, y: (A * E - B * C) / det, used }
}

/** 模型坐标 → metadata 同坐标系（bake-report.fit 的逆变换）。 */
function pivotModelFromMetadata(metaPivot, fit) {
  return { x: (metaPivot.x - fit.tx) / fit.scale, y: (fit.ty - metaPivot.y) / fit.scale }
}

/** models.pb turret 模块 yaw 限位（±max，用于 limited-traverse 车型的样本角）。 */
function yawMaxDeg(mdef, turretId) {
  const tm = mdef.turrets[String(turretId)]
  const yaw = tm?.yaw
  if (!yaw || yaw.min == null || yaw.max == null) return 90
  const max = Math.max(Math.abs(yaw.min), Math.abs(yaw.max))
  return max > 0.5 && max < 90 ? max : 90
}

/** bottom turret-ring anchor：turret 网格底部带顶视质心（模型坐标；z∈[minZ, minZ+0.2]）。 */
function bottomRingCenter(verts) {
  if (!verts.length) return null
  let minZ = Infinity
  for (const p of verts) if (p[2] < minZ) minZ = p[2]
  const band = verts.filter((p) => p[2] <= minZ + 0.2)
  if (band.length < 12) return null
  let bx = 0, by = 0
  for (const p of band) { bx += p[0]; by += p[1] }
  return { x: bx / band.length, y: by / band.length, n: band.length, zMin: minZ }
}

async function verify(modelKey) {
  const def = MODEL_DEFINITIONS[modelKey]
  if (!def || def.kind !== 'turreted') return { skipped: 'non-turreted' }
  const tankId = def.tankIds[0]
  const glbPath = join(CACHE, 'models', tankId + '.glb')
  if (!existsSync(glbPath)) return { skipped: 'GLB 未缓存' }
  const mdef = models.models[String(tankId)]
  const tankDef = tanks.tanks[String(tankId)]
  if (!mdef || !tankDef) return { skipped: 'definitions 缺失' }
  const trackId = tankDef.tracks[tankDef.tracks.length - 1].id
  const turretDef = tankDef.turrets[tankDef.turrets.length - 1]
  const turretModelId = mdef.turrets[String(turretDef.id)].modelId
  const gunDef = turretDef.guns[turretDef.guns.length - 1]
  const gunModelId = mdef.turrets[String(turretDef.id)].guns[String(gunDef.id)].modelId
  if (turretModelId === undefined || gunModelId === undefined) return { skipped: 'model_id 缺失' }

  const doc = await io.read(glbPath)
  const nodes = doc.getRoot().listNodes()
  const turretName = 'turret_' + String(turretModelId).padStart(2, '0')
  const gunName = 'gun_' + String(gunModelId).padStart(2, '0')
  const pts = []
  const trsReport = []
  for (const name of [turretName, gunName, gunName + '_mask']) {
    const n = nodes.find((node) => node.getName() === name)
    if (n) {
      trsReport.push(name + ' ' + trsSummary(n))
      // collectNodeVerts：与 collectNodeTriangles 同一 hierarchy 语义
      // （自身 TRS → 自己的 mesh；children 递归传 worldMatrix）
      collectNodeVerts(n, pts, new THREE.Matrix4())
    }
  }
  if (!pts.length) return { skipped: '旋转层 mesh 缺失' }

  // —— bottom turret-ring anchor（turret_01 子树，几何佐证，可复现输出）——
  const tNode = nodes.find((node) => node.getName() === turretName)
  let ring = null
  if (tNode) {
    const tpts = []
    collectNodeVerts(tNode, tpts, new THREE.Matrix4())
    ring = bottomRingCenter(tpts)
  }

  // —— origins（models.pb 原始数据；不调用 computeTurretModelPivot）——
  const trackOrigin = (mdef.tracks && mdef.tracks[String(trackId)] && mdef.tracks[String(trackId)].origin) || { x: 0, y: 0, z: 0 }
  const turretOrigin = mdef.turretOrigin || { x: 0, y: 0, z: 0 }
  const correctZY = (v) => ({ x: v.x ?? 0, y: v.z ?? 0, z: v.y ?? 0 })
  const o = {
    hullOrigin: correctZY(trackOrigin),
    turretOrigin: correctZY(turretOrigin),
    initial: mdef.initialTurretRotation || null,
  }
  const container = buildTurretContainer(o)

  const yawA = 0
  const yawB = yawMaxDeg(mdef, turretDef.id)
  const wA = container(yawA)
  const wB = container(yawB)

  // —— 只根据 world positions 反推（不接触 metadata）——
  const step = Math.max(1, Math.floor(pts.length / 1200))
  const pairs = []
  for (let i = 0; i < pts.length; i += step) {
    const a = wA(pts[i])
    const b = wB(pts[i])
    pairs.push([[a[0], a[1]], [b[0], b[1]]])
  }
  const solved = solveRotationCenter(pairs)

  // —— 与 metadata.turretPivot 比较（经 bake-report.fit 反投影）——
  const brPath = join(ASSETS, modelKey, 'bake-report.json')
  const metaPath = join(ASSETS, modelKey, 'metadata.json')
  let pivotModel = null
  let err = NaN
  let ringD = null
  if (existsSync(brPath) && existsSync(metaPath)) {
    const br = JSON.parse(readFileSync(brPath, 'utf8'))
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    pivotModel = pivotModelFromMetadata(meta.turretPivot, br.fit)
    if (solved) err = Math.hypot(solved.x - pivotModel.x, solved.y - pivotModel.y)
    if (ring) ringD = Math.hypot(ring.x - pivotModel.x, ring.y - pivotModel.y)
  }
  return { modelKey, tankId, yawA, yawB, solved, pivotModel, err, initial: o.initial, verts: pts.length, trsReport, ring, ringD }
}

async function main() {
  const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MODEL_DEFINITIONS)
  const explicit = process.argv.slice(2).length > 0
  let failed = 0
  for (const key of keys) {
    const r = await verify(key)
    if (r.skipped) { console.log('  SKIP ' + key + '（' + r.skipped + '）'); continue }
    if (!r.solved) { console.log('  [WARN] ' + r.modelKey + ' 反推退化'); failed++; continue }
    const pass = r.err < 0.05
    if (!pass) failed++
    console.log(
      '  ' + (pass ? 'PASS' : '[FAIL]') + ' ' + r.modelKey.padEnd(20) +
      ' yaw=' + r.yawA + '/' + r.yawB + '°' +
      ' solved=(' + r.solved.x.toFixed(4) + ',' + r.solved.y.toFixed(4) + ')' +
      ' metadataPivotModel=(' + r.pivotModel.x.toFixed(4) + ',' + r.pivotModel.y.toFixed(4) + ')' +
      ' err=' + r.err.toFixed(4) + 'm' +
      (r.initial ? ' initial=' + JSON.stringify(r.initial) : '') +
      (r.ringD != null ? ' ringAnchorD=' + r.ringD.toFixed(3) + 'm' : ''),
    )
  }
  if (explicit) {
    console.log('')
    console.log('—— selected node local TRS + bottom-ring anchor（显式车型）——')
    for (const key of keys) {
      const r = await verify(key)
      if (r.skipped || !r.solved) continue
      console.log('== ' + r.modelKey + ' ==')
      for (const line of r.trsReport) console.log('  ' + line)
      if (r.ring) {
        console.log(
          '  ringAnchor=(' + r.ring.x.toFixed(3) + ',' + r.ring.y.toFixed(3) + ') n=' + r.ring.n +
          ' zMin=' + r.ring.zMin.toFixed(2) + ' vs pivotD=' + r.ringD.toFixed(3) + 'm',
        )
      } else {
        console.log('  ringAnchor: n/a（底部带顶点不足）')
      }
    }
  }
  console.log(failed === 0 ? '\nRESULT: ALL PASS——scene-graph 独立反推与 metadata.turretPivot 一致（err<0.05m）' : '\nRESULT: ' + failed + ' FAILURE(S)')
  if (failed > 0) process.exit(1)
}

await main()
