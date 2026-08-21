#!/usr/bin/env node
/**
 * BlitzKit 辅助脚本（计划 §38）— 为 ChatGPT SVG 生成准备输入资料。
 *
 * 职责：
 * 1. 读取真实项目 Tankopedia（common/tankopedia-tier10.json）+ 车型 mapping；
 * 2. 输出完整 Tier X inventory（含 baseModelKey / kind / BlitzKit 参考 URL）；
 * 3. 自动下载车型 reference images 到本地缓存（gitignored）；
 * 4. 输出覆盖/缺失情况；
 * 5. --emit-docs 时生成 docs/assets/tier-x-models/tier-x-inventory.md（提交入库）。
 *
 * 用法（仓库根）：
 *   node frontend/scripts/blitzkit-references.mjs            # 下载参考图 + 写缓存 inventory
 *   node frontend/scripts/blitzkit-references.mjs --dry-run  # 只看清单，不下载
 *   node frontend/scripts/blitzkit-references.mjs --limit 5  # 只处理前 5 辆（调试）
 *   node frontend/scripts/blitzkit-references.mjs --emit-docs# 生成 tier-x-inventory.md
 *   node frontend/scripts/blitzkit-references.mjs --emit-portraits # 下载并发布 Details Panel 车型图
 *
 * BlitzKit 不是 production/CI 依赖：脚本只在本机手动运行。
 * 参考图 URL 已验证：https://api.blitzkit.app/tanks/{tankId}/icons/big.webp
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tankopedia from '../../common/tankopedia-tier10.json' with { type: 'json' }
import { MODEL_DEFINITIONS, TANK_ID_TO_MODEL } from '../src/vehicle-models/mapping.js'
import { blitzkitIconUrl } from '../src/vehicle-models/types.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE_DIR = path.join(ROOT, 'frontend', 'scripts', '.vehicle-model-refs')
const REFS_DIR = path.join(CACHE_DIR, 'references')
const PORTRAITS_DIR = path.join(ROOT, 'frontend', 'src', 'assets', 'tank-portraits', 'tier-x')
const DOCS_MD = path.join(ROOT, 'docs', 'assets', 'tier-x-models', 'tier-x-inventory.md')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitIdx = args.indexOf('--limit')
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity
const emitDocs = args.includes('--emit-docs')
const emitPortraits = args.includes('--emit-portraits')

function isWebp(bytes) {
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
}

/**
 * kind 核验依据（2026-08-17，全 81 modelKey 逐组核验）。
 * 依据来源：官方 tankopedia 描述 / fandom wiki / 车辆实际俯视结构知识。
 * 注意：不采用 BlitzKit TURRET module 或 turretRotationSpeed 字段判定
 * （casemate 也有 turret module 且转速非零，不可判）。
 * 未列出的 turreted modelKey 均为「标准可旋转炮塔（HT/MT/LT，结构知识核验）」。
 */
const KIND_EVIDENCE = {
  'ho-ri': 'fandom：无炮塔，仅 14° 总射界（casemate）',
  'foch-155': 'fandom specs turret=no（固定/微转前向炮塔）',
  'minotauro': 'fandom：有炮塔，约 45° 限位后置炮塔',
  'xm66f': '官方 tankopedia：non-fully-rotating turret（前置炮塔）',
  '114-sp2': '官方 tankopedia：360° 可旋转炮塔',
  'gsor-the-tank': '官方 tankopedia：摇摆式炮塔',
  'bzt-70': '官方 news：turret 正面装甲描述（有炮塔）',
  'ac-atlas': 'fandom：炮塔正面坚不可摧 + Modules/Turret',
  'waffen-f1-0': 'fandom：huge turret + 极慢炮塔旋转',
  'wz-113g-ft': 'casemate 固定战斗室 TD（结构知识）',
  'jgpz-e-100': 'casemate 固定战斗室 TD（结构知识）',
  'obj-268': 'casemate 固定战斗室 TD（结构知识）',
  't110e3': 'casemate 固定战斗室 TD（结构知识）',
  'obj-263': 'casemate 固定战斗室 TD（结构知识）',
  'fv217-badger': 'casemate 固定战斗室 TD（结构知识）',
  'object-268-4': 'casemate 固定战斗室 TD（结构知识）',
  // 2026-08-19 BlitzKit 真实模型数据确认（GLB 节点结构 + models.pb turret yaw 限位），
  // confirmPending 全部清零，contract 冻结；turretPivot 均已通过 yaw0/90 几何反推验证（err=0.0000m）。
  'spht': '2026-08-19 BlitzKit 数据确认：GLB turret_01 + gun_01 + gun_01_mask、models.pb turret 模块无 yaw 限位 → 确认 turreted',
  'ac-teichos': '2026-08-19 BlitzKit 数据确认：GLB turret_01（631+1540 顶点）+ gun_01 + gun_01_mask、models.pb turret 模块无 yaw 限位 → 确认 turreted',
  'nc-70-blyskawica': '2026-08-19 BlitzKit 数据确认：GLB turret_01 为 1-triangle stub（casemate 主体在 hull_nc_01，属 hull 层；旋转层实际 = gun_01 + gun_01_mask）、models.pb turret 模块 yaw ±10°（limited-traverse，同 grille-15）→ 确认 turreted',
}

/** 尽力而为的 BlitzKit 页面 slug（非 ASCII 字母会被剥离，页面链接仅作辅助）。 */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildInventory() {
  const byId = new Map(tankopedia.vehicles.map((v) => [v.id, v]))
  const groups = new Map() // modelKey -> { kind, confirmPending, entries: [] }
  for (const [modelKey, def] of Object.entries(MODEL_DEFINITIONS)) {
    groups.set(modelKey, {
      kind: def.kind,
      confirmPending: Boolean(def.confirmPending),
      entries: def.tankIds.map((id) => byId.get(id)).filter(Boolean),
    })
  }
  const inventory = []
  for (const [modelKey, group] of groups) {
    for (const v of group.entries) {
      inventory.push({
        tankId: v.id,
        name: v.name,
        class: v.class,
        nation: v.nation,
        modelKey,
        kind: group.kind,
        confirmPending: group.confirmPending,
        kindEvidence: KIND_EVIDENCE[modelKey] || '标准可旋转炮塔（HT/MT/LT，结构知识核验）',
        iconUrl: blitzkitIconUrl(v.id),
        pageUrl: `https://blitzkit.app/tanks/${slugify(v.name)}`,
      })
    }
  }
  return { inventory, groups }
}

function renderMarkdown(inv, groups) {
  const lines = []
  lines.push('# Tier X Inventory（Tankopedia 权威，84 辆 → 81 baseModelKey）')
  lines.push('')
  lines.push('> 由 `node frontend/scripts/blitzkit-references.mjs --emit-docs` 从')
  lines.push('> `common/tankopedia-tier10.json` + `frontend/src/vehicle-models/mapping.js` 生成；')
  lines.push('> 覆盖完整性由 CI（coverage.test.js）强制。')
  lines.push('')
  lines.push('## kind 核验（2026-08-17，全 81 modelKey 逐组核验）')
  lines.push('')
  lines.push('> 依据：官方 tankopedia 描述 / fandom wiki / 车辆实际俯视结构知识；')
  lines.push('> 不采用 BlitzKit TURRET module 或 turretRotationSpeed 字段（casemate 也有 turret module 且转速非零，不可判）。')
  lines.push('> 修正记录：minotauro → turreted（有炮塔 45° 限位）；foch-155 → turretless（fandom specs turret=no）；')
  lines.push('> xm66f → turreted（官方：non-fully-rotating turret）。')
  lines.push('> **confirmPending 已全部清零（2026-08-19）**：spht / ac-teichos / nc-70-blyskawica')
  lines.push('> 均经 BlitzKit 真实模型数据确认 kind（GLB 节点结构 + models.pb turret yaw 限位），contract 冻结；')
  lines.push('> 三车已生成正式资产，turretPivot 通过 yaw0/90 几何反推验证（err=0.0000m）。')
  lines.push('')
  lines.push('## 按 baseModelKey 分组')
  lines.push('')
  lines.push('| modelKey | kind | confirmPending | tankId | display name | class | nation | kind 核验依据 | BlitzKit 参考 |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  for (const item of inv) {
    lines.push(
      `| ${item.modelKey} | ${item.kind} | ${item.confirmPending ? '⚠️ 待确认' : '—'} | ${item.tankId} | ${item.name} | ${item.class} | ${item.nation} | ${item.kindEvidence} | [icon](${item.iconUrl}) · [page](${item.pageUrl}) |`,
    )
  }
  lines.push('')
  lines.push('## 统计')
  lines.push('')
  lines.push(`- Tankopedia Tier X 总数：${tankopedia.vehicles.length}（meta.count=${tankopedia.meta.count}，generated_at=${tankopedia.meta.generated_at}）`)
  lines.push(`- baseModelKey 数：${groups.size}`)
  lines.push(`- turreted：${[...groups.values()].filter((g) => g.kind === 'turreted').length}；turretless：${[...groups.values()].filter((g) => g.kind === 'turretless').length}；confirmPending：${[...groups.values()].filter((g) => g.confirmPending).length}`)
  lines.push('')
  return lines.join('\n') + '\n'
}

async function main() {
  const { inventory, groups } = buildInventory()
  const missing = tankopedia.vehicles.filter((v) => !TANK_ID_TO_MODEL[String(v.id)])
  const rows = dryRun ? inventory : inventory.slice(0, limit)

  console.log(`Tier X inventory: ${inventory.length} vehicles / ${groups.size} modelKeys`)
  console.log(`turreted=${[...groups.values()].filter((g) => g.kind === 'turreted').length} turretless=${[...groups.values()].filter((g) => g.kind === 'turretless').length}`)
  if (missing.length > 0) {
    console.error(`[MISSING] 无 mapping 的 Tier X：${missing.map((v) => v.id + ' ' + v.name).join('; ')}`)
    process.exitCode = 1
  }

  if (emitDocs) {
    fs.mkdirSync(path.dirname(DOCS_MD), { recursive: true })
    fs.writeFileSync(DOCS_MD, renderMarkdown(inventory, groups))
    console.log(`docs written: ${path.relative(ROOT, DOCS_MD)}`)
  }

  if (dryRun) {
    for (const item of rows) {
      const flag = item.confirmPending ? ' ⚠️confirmPending' : ''
      console.log(`  ${item.tankId} ${item.modelKey} [${item.kind}]${flag} ${item.name} ${item.iconUrl}`)
    }
    return
  }

  fs.mkdirSync(REFS_DIR, { recursive: true })
  if (emitPortraits) fs.mkdirSync(PORTRAITS_DIR, { recursive: true })
  let ok = 0
  let failed = 0
  for (const item of rows) {
    const target = path.join(REFS_DIR, `${item.tankId}.webp`)
    try {
      let bytes = fs.existsSync(target) ? fs.readFileSync(target) : null
      if (!bytes || !isWebp(bytes)) {
        const res = await fetch(item.iconUrl)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        bytes = Buffer.from(await res.arrayBuffer())
        if (!isWebp(bytes)) throw new Error('response is not WebP')
        fs.writeFileSync(target, bytes)
      }
      if (emitPortraits) {
        fs.writeFileSync(path.join(PORTRAITS_DIR, `${item.tankId}.webp`), bytes)
      }
      ok += 1
      console.log(`  ok   ${item.tankId} ${item.name}${emitPortraits ? ' → portrait' : ''}`)
    } catch (e) {
      failed += 1
      console.error(`  FAIL ${item.tankId} ${item.name}: ${e.message}`)
    }
  }
  fs.writeFileSync(
    path.join(CACHE_DIR, 'inventory.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), vehicles: inventory }, null, 2),
  )
  console.log(`downloads: ok=${ok} failed=${failed}（缓存 ${path.relative(ROOT, CACHE_DIR)}）`)
  if (emitPortraits && failed === 0) {
    console.log(`portraits: ${rows.length} → ${path.relative(ROOT, PORTRAITS_DIR)}`)
  }
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
