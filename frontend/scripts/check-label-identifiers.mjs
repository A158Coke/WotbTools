// 检查 playbackScene 名牌绘制区引用的模块级常量是否都有声明（import 或模块内定义）。
//
// 为什么需要它：场景内核依赖 WebGL，现有测试只读源码文本、从不执行 drawLabel——
// 于是 drawLabel 引用一个没进 import 列表的常量（`LABEL_DESIGN_W`）时全部单测照绿，
// 只有真实加载回放才炸「回放加载失败：LABEL_DESIGN_W is not defined」。
//
// 做法：收集模块的**声明集**（import 绑定 + import 重命名 + 模块内 const/let/var/function/class），
// 再列出绘制区里出现的 **CONSTANT_CASE 标识符**（去注释、去字符串），比对差集。
// 只认带下划线的大写常量名，避免把局部变量与注释里的缩写卷进来。
//
// 用法：node scripts/check-label-identifiers.mjs frontend/src/scene/playbackScene.js
import { readFileSync } from 'node:fs'

const scenePath = process.argv[2]
if (!scenePath) {
  console.error('用法: node scripts/check-label-identifiers.mjs <playbackScene.js>')
  process.exit(2)
}
const src = readFileSync(scenePath, 'utf8')

const start = src.indexOf('function paintText')
const end = src.indexOf('function buildVehicles')
if (start < 0 || end < 0 || end <= start) {
  console.error('ANCHOR_MISSING: 找不到 paintText .. buildVehicles 区间（绘制区被改名或移动？）')
  process.exit(2)
}

/** 去注释 + 去字符串字面量：避免注释里的缩写被当成标识符 */
function codeOnly(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
}

const clean = codeOnly(src)
const declared = new Set()

// import 子句直接从**原始源码**里取（不要在去字符串字面量之后再找 `from ''`：
// 那一步是否命中取决于引号处理，脆弱且难查）。子句本身的注释再单独去掉。
const importClauses = [...src.matchAll(/^import\s+([\s\S]*?)\s+from\s+['"]/gm)]
  .map((m) => codeOnly(m[1]))
if (process.env.LABEL_IDENT_DEBUG) {
  console.error(`[debug] import 子句 ${importClauses.length} 条；含 LABEL_ 的：`,
    JSON.stringify(importClauses.filter((c) => c.includes('LABEL_'))))
}
for (const clause of importClauses) {
  const braced = /\{([\s\S]*?)\}/.exec(clause)
  if (braced) {
    for (const part of braced[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) declared.add(name)
    }
  }
  const def = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, ' ').trim()
  if (def && !def.startsWith('*')) declared.add(def.replace(/^\*\s+as\s+/, ''))
}

// 模块内声明（含 initPlayback 内部的缩进层级）
const DECL = /(?:^|[\s;{(,])(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g
for (const m of clean.matchAll(DECL)) declared.add(m[1])
// 解构声明：const { a, b: c } = …
for (const m of clean.matchAll(/(?:const|let|var)\s*\{([\s\S]*?)\}\s*=/g)) {
  for (const part of m[1].split(',')) {
    const name = part.trim().split(/[:\s]+/).pop()?.trim()
    if (name && /^[A-Za-z_$][\w$]*$/.test(name)) declared.add(name)
  }
}

const body = codeOnly(src.slice(start, end))
const referenced = new Set(body.match(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g) || [])
const undeclared = [...referenced].filter((id) => !declared.has(id)).sort()

if (undeclared.length) {
  console.error(`MISSING_IDENTIFIERS: ${undeclared.join(', ')}`)
  console.error(`（已声明 ${declared.size} 个模块级标识符；绘制区引用 ${referenced.size} 个常量）`)
  process.exit(1)
}
console.log(`label identifier check OK（${referenced.size} 个常量全部有声明）`)
