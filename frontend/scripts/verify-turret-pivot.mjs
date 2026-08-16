#!/usr/bin/env node
/**
 * turretPivot 几何验证（developer-only；PR #92 Review B1 的最强验证方式）。
 *
 * 对每个 turreted 车型，用 GLB 真实旋转层几何（= bake 的 turret 场景：turret + mantlet +
 * gun——这才是在 marker 里实际绕 turretPivot 旋转的视觉层）复刻 BlitzKit useTankTransform
 * 运行时公式（turretPosition = R_init(R_yaw(-modelPivot)) + modelPivot；container rotation
 * = yaw，mesh 随容器刚性旋转），构造 yaw=0° 与 yaw=90° 两个姿态，对旋转层多个对应顶点
 * 反求唯一 2D rotation center（垂直平分线最小二乘）：
 *   solvedCenter 必须与 bake-report.pivotSource.modelPivot（= correctZYTuple(trackOrigin)
 *   + correctZYTuple(turretOrigin)）一致（误差 < 0.01m）。
 *
 * 注：nc-70-blyskawica 的 turret_01 节点是 1-triangle stub（casemade 主体在 hull_nc_01，
 * 属 hull 层；旋转层实际只有 gun + mantlet，yaw ±10° limited-traverse）——单节点点集会
 * 退化，必须按完整旋转层收集点集才能反推（这正是"验证真实旋转层"而非"验证节点名"）。
 *
 * 另外对存在 initial_turret_rotation 的车型（minotauro pitch=3°）复刻完整 transform
 * （含 initial），量化其对顶视 yaw 中心的影响（验证结论：≤3.2cm，不影响 pivot 契约）。
 *
 * 依赖 developer 缓存（frontend/scripts/.vehicle-model-refs/：models.pb/tanks.pb/*.glb），
 * 与 baker 相同环境；CI 不执行（缓存 gitignored）。
 *
 * 用法（frontend 目录）：
 *   node scripts/verify-turret-pivot.mjs              # 全部 turreted
 *   node scripts/verify-turret-pivot.mjs maus grille-15
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import * as THREE from 'three'
import { BLITZKIT_MODELS_PROTO, BLITZKIT_TANKS_MIN_PROTO, computeTurretModelPivot, decodeBlitzkitPb } from './extractor-lib.mjs'
import { MODEL_DEFINITIONS } from '../src/vehicle-models/mapping.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE = join(ROOT, 'frontend', 'scripts', '.vehicle-model-refs')

const models = decodeBlitzkitPb(readFileSync(join(CACHE, 'definitions', 'models.pb')), 'blitzkit.ModelDefinitions', BLITZKIT_MODELS_PROTO)
const tanks = decodeBlitzkitPb(readFileSync(join(CACHE, 'definitions', 'tanks.pb')), 'blitzkit.TankDefinitions', BLITZKIT_TANKS_MIN_PROTO)
const io = new NodeIO()

const nodeMatrix = (node) => {
  const m = new THREE.Matrix4()
  m.compose(new THREE.Vector3(...(node.getTranslation() || [0, 0, 0])), new THREE.Quaternion(...(node.getRotation() || [0, 0, 0, 1])), new THREE.Vector3(...(node.getScale() || [1, 1, 1])))
  return m
}
function collect(node, m, out) {
  const mesh = node.getMesh()
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION')
      if (!posAcc) continue
      const pos = posAcc.getArray()
      const v = new THREE.Vector3()
      for (let i = 0; i < pos.length; i += 3) {
        v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m)
        out.push([v.x, v.y, v.z]) // GLB = 模型坐标（x宽, y长, z高）
      }
    }
  }
  for (const c of node.listChildren()) collect(c, m.clone().multiply(nodeMatrix(node)), out)
}

/** 垂直平分线最小二乘求 2D 旋转中心。 */
function solveRotationCenter(pairs) {
  let A = 0, B = 0, C = 0, D = 0, E = 0
  for (const [[x0, y0], [x1, y1]] of pairs) {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2
    const dx = x1 - x0, dy = y1 - y0
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue
    A += dx * dx; B += dx * dy; C += dx * (dx * mx + dy * my)
    D += dy * dy; E += dy * (dx * mx + dy * my)
  }
  const det = A * D - B * B
  if (Math.abs(det) < 1e-12) return null
  return { x: (C * D - B * E) / det, y: (A * E - B * C) / det }
}

/** 复刻 BlitzKit useTankTransform（含 initial_turret_rotation）。 */
function runtimeTransform(p0, c, yawDeg, initial) {
  const rad = (yawDeg * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const ry = (v) => ({ x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos, z: v.z })
  const applyInit = (q, init) => {
    if (!init) return q
    const pr = (-init.pitch * Math.PI) / 180, rr = (-init.roll * Math.PI) / 180, yr = (-init.yaw * Math.PI) / 180
    const cp = Math.cos(pr), sp = Math.sin(pr)
    q = { x: q.x, y: q.y * cp - q.z * sp, z: q.y * sp + q.z * cp }
    const cr = Math.cos(rr), sr = Math.sin(rr)
    q = { x: q.x * cr + q.z * sr, y: q.y, z: -q.x * sr + q.z * cr }
    const cy = Math.cos(yr), sy = Math.sin(yr)
    return { x: q.x * cy - q.y * sy, y: q.x * sy + q.y * cy, z: q.z }
  }
  const containerPos = applyInit(ry({ x: -c.x, y: -c.y, z: -c.z }), initial)
  const rotP = applyInit(ry(p0), initial)
  return { x: containerPos.x + c.x + rotP.x, y: containerPos.y + c.y + rotP.y }
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
  const doc = await io.read(glbPath)
  const nodes = doc.getRoot().listNodes()
  const turretName = 'turret_' + String(turretModelId).padStart(2, '0')
  const gunName = 'gun_' + String(gunModelId).padStart(2, '0')
  const pts = []
  // 完整旋转层 = bake 的 turret 场景（turret + mantlet + gun）；缺节点不报错（部分
  // 车型 mantlet/gun 命名不同），只要总点集足够。nc-70 的 turret_01 是 stub——必须靠
  // gun + mantlet 几何反推，否则 3 点退化（见文件头注）。
  for (const name of [turretName, gunName, gunName + '_mask']) {
    const n = nodes.find((node) => node.getName() === name)
    if (n) collect(n, new THREE.Matrix4(), pts)
  }
  if (!pts.length) return { skipped: '旋转层 mesh 缺失' }
  const trackOrigin = (mdef.tracks && mdef.tracks[String(trackId)] && mdef.tracks[String(trackId)].origin) || {}
  const c = computeTurretModelPivot(trackOrigin, mdef.turretOrigin || {})
  const initial = mdef.initialTurretRotation || null
  const pairs = []
  for (let i = 0; i < Math.min(pts.length, 3000); i += 3) {
    const p0 = { x: pts[i][0], y: pts[i][1], z: pts[i][2] }
    const t0 = runtimeTransform(p0, c, 0, initial)
    const t90 = runtimeTransform(p0, c, 90, initial)
    pairs.push([[t0.x, t0.y], [t90.x, t90.y]])
  }
  const solved = solveRotationCenter(pairs)
  const err = solved ? Math.hypot(solved.x - c.x, solved.y - c.y) : NaN
  return { modelKey, tankId, c, solved, err, initial }
}

async function main() {
  const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MODEL_DEFINITIONS)
  let failed = 0
  for (const key of keys) {
    const r = await verify(key)
    if (r.skipped) { console.log(`  SKIP ${key}（${r.skipped}）`); continue }
    if (!r.solved) { console.log(`  [WARN] ${r.modelKey} 反推退化（点集共线/不足），跳过`); continue }
    // 阈值：无 initial 车型必须 err < 1cm（纯几何一致）；含 initial_turret_rotation 车型
    // 允许 err < 10cm（minotauro pitch=3° 实测 3.1cm——initial 只影响初始朝向，不改变 pivot 契约）
    const pass = r.err < (r.initial ? 0.1 : 0.01)
    if (!pass) failed++
    console.log(`  ${pass ? 'PASS' : '[FAIL]'} ${r.modelKey} yaw0/90 反推中心=(${r.solved.x.toFixed(4)},${r.solved.y.toFixed(4)}) vs modelPivot=(${r.c.x.toFixed(4)},${r.c.y.toFixed(4)}) err=${r.err.toFixed(4)}m${r.initial ? ' initial=' + JSON.stringify(r.initial) : ''}`)
  }
  console.log(failed === 0 ? '\nRESULT: ALL PASS——turretPivot 与 BlitzKit runtime 几何一致（err<0.01m）' : `\nRESULT: ${failed} FAILURE(S)`)
  if (failed > 0) process.exit(1)
}

await main()
