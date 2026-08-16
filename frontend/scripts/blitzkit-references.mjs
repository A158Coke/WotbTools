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
const DOCS_MD = path.join(ROOT, 'docs', 'assets', 'tier-x-models', 'tier-x-inventory.md')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitIdx = args.indexOf('--limit')
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity
const emitDocs = args.includes('--emit-docs')

/** 尽力而为的 BlitzKit 页面 slug（非 ASCII 字母会被剥离，页面链接仅作辅助）。 */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildInventory() {
  const byId = new Map(tankopedia.vehicles.map((v) => [v.id, v]))
  const groups = new Map() // modelKey -> { kind, entries: [] }
  for (const [modelKey, def] of Object.entries(MODEL_DEFINITIONS)) {
    groups.set(modelKey, { kind: def.kind, entries: def.tankIds.map((id) => byId.get(id)).filter(Boolean) })
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
  lines.push('## 按 baseModelKey 分组')
  lines.push('')
  lines.push('| modelKey | kind | tankId | display name | class | nation | BlitzKit 参考 |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const item of inv) {
    lines.push(
      `| ${item.modelKey} | ${item.kind} | ${item.tankId} | ${item.name} | ${item.class} | ${item.nation} | [icon](${item.iconUrl}) · [page](${item.pageUrl}) |`,
    )
  }
  lines.push('')
  lines.push('## 统计')
  lines.push('')
  lines.push(`- Tankopedia Tier X 总数：${tankopedia.vehicles.length}（meta.count=${tankopedia.meta.count}，generated_at=${tankopedia.meta.generated_at}）`)
  lines.push(`- baseModelKey 数：${groups.size}`)
  lines.push(`- turreted：${[...groups.values()].filter((g) => g.kind === 'turreted').length}；turretless：${[...groups.values()].filter((g) => g.kind === 'turretless').length}`)
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
    for (const item of rows) console.log(`  ${item.tankId} ${item.modelKey} [${item.kind}] ${item.name} ${item.iconUrl}`)
    return
  }

  fs.mkdirSync(REFS_DIR, { recursive: true })
  let ok = 0
  let failed = 0
  for (const item of rows) {
    const target = path.join(REFS_DIR, `${item.tankId}.webp`)
    if (fs.existsSync(target) && fs.statSync(target).size > 0) {
      ok += 1
      continue
    }
    try {
      const res = await fetch(item.iconUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()))
      ok += 1
      console.log(`  ok   ${item.tankId} ${item.name}`)
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
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
