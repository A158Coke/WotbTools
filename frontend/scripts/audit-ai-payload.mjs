#!/usr/bin/env node
// AI Review payload audit（开发/测试用途，plan §9）。
//
// 收集并打印：
//   - 原始 .wotbreplay 字节数，以及 zip 内每个成员的压缩/未压缩字节（含 data.wotreplay）
//   - 一个 AiReviewRequest JSON 的总字节、gzip 后字节（level 6/9）、按 section 的字节
//     （battle / reconstruction 及其 participants、events、coverage、checkpoints、finalState）
//   - 事件按 type 的计数与序列化字节
//
// 无第三方依赖：zip 只读 central directory 取成员名与压缩/未压缩字节。
//
// 用法：
//   node scripts/audit-ai-payload.mjs --replay ../../common/fixtures/replays/random-battle-example.wotbreplay
//   node scripts/audit-ai-payload.mjs --request ./request.json
//   node scripts/audit-ai-payload.mjs --request ./request.json --json
//
// 注意：--request 只做形状统计，不校验 contract；wire authority 仍是 contracts/http/openapi.yaml。

import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50

function fail(message) {
  console.error(`audit-ai-payload: ${message}`)
  process.exit(1)
}

/** 读取 zip central directory 的成员表（name/method/compressedSize/uncompressedSize/localOffset）。 */
function readZipEntries(buf) {
  const maxBack = Math.min(buf.length, 66_000)
  let eocd = -1
  for (let i = buf.length - 22; i >= buf.length - maxBack && i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) fail('not a zip container (EOCD not found)')

  const count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  const entries = []
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIG) fail(`bad central directory header at ${offset}`)
    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const uncompressedSize = buf.readUInt32LE(offset + 24)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen)
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** JSON 序列化后的字节数（重算 per-section / per-event 用量）。 */
function bytesOf(value) {
  return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8')
}

function reportReplay(path) {
  const buf = readFileSync(path)
  const entries = readZipEntries(buf)
  const lines = []
  lines.push(`replay            ${path}`)
  lines.push(`original bytes    ${buf.length}`)
  lines.push(`zip entries       ${entries.length}`)
  const sorted = [...entries].sort((a, b) => b.uncompressedSize - a.uncompressedSize)
  for (const e of sorted) {
    lines.push(
      `  ${e.name.padEnd(32)} uncompressed=${String(e.uncompressedSize).padStart(9)} compressed=${String(e.compressedSize).padStart(9)} method=${e.method}`,
    )
  }
  const dataEntry = entries.find((e) => e.name === 'data.wotreplay')
  if (dataEntry) {
    lines.push(`data.wotreplay bytes  ${dataEntry.uncompressedSize} (compressed ${dataEntry.compressedSize})`)
  }
  return { lines, json: { path, originalBytes: buf.length, entries } }
}

function reportRequest(path) {
  const raw = readFileSync(path)
  let parsed
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch (error) {
    fail(`--request is not valid JSON: ${error.message}`)
  }
  const gzip6 = gzipSync(raw, { level: 6 }).length
  const gzip9 = gzipSync(raw, { level: 9 }).length
  // AiReviewRequestV1 把事实放在 reconstruction 下；上游 facet 样例把 events 放在顶层。
  // 两种形状都支持，按顶层键逐项计量。
  const reconstruction = parsed?.reconstruction
  const eventList = Array.isArray(reconstruction?.events)
    ? reconstruction.events
    : (Array.isArray(parsed?.events) ? parsed.events : [])
  const byType = new Map()
  for (const event of eventList) {
    const type = typeof event?.type === 'string' ? event.type : '<missing>'
    const acc = byType.get(type) ?? { count: 0, bytes: 0 }
    acc.count += 1
    acc.bytes += bytesOf(event)
    byType.set(type, acc)
  }
  const sections = {}
  for (const key of Object.keys(parsed ?? {})) sections[key] = bytesOf(parsed[key])
  if (reconstruction && typeof reconstruction === 'object') {
    for (const key of Object.keys(reconstruction)) sections[`reconstruction.${key}`] = bytesOf(reconstruction[key])
  }
  const eventCount = eventList.length
  const lines = []
  lines.push(`request           ${path}`)
  lines.push(`raw JSON bytes    ${raw.length}`)
  lines.push(`gzip level 6      ${gzip6}  (ratio ${(gzip6 / raw.length).toFixed(3)})`)
  lines.push(`gzip level 9      ${gzip9}  (ratio ${(gzip9 / raw.length).toFixed(3)})`)
  lines.push(`schemaVersion     ${parsed?.schemaVersion ?? '<missing>'}`)
  lines.push(`locale            ${parsed?.locale ?? '<missing>'}`)
  lines.push('sections')
  for (const [name, bytes] of Object.entries(sections)) {
    lines.push(`  ${name.padEnd(28)} ${String(bytes).padStart(10)}`)
  }
  lines.push(`events            count=${eventCount} types=${byType.size}`)
  const rows = [...byType.entries()].sort((a, b) => b[1].bytes - a[1].bytes)
  for (const [type, acc] of rows) {
    lines.push(`  ${type.padEnd(34)} count=${String(acc.count).padStart(6)} bytes=${String(acc.bytes).padStart(10)}`)
  }
  return { lines, json: { path, rawBytes: raw.length, gzip6, gzip9, sections, eventTypes: Object.fromEntries(rows) } }
}

function main() {
  const argv = process.argv.slice(2)
  const asJson = argv.includes('--json')
  const replayIdx = argv.indexOf('--replay')
  const requestIdx = argv.indexOf('--request')
  if (replayIdx < 0 && requestIdx < 0) {
    fail('usage: --replay <file.wotbreplay> and/or --request <request.json> [--json]')
  }
  const output = []
  if (replayIdx >= 0) output.push(reportReplay(argv[replayIdx + 1]))
  if (requestIdx >= 0) output.push(reportRequest(argv[requestIdx + 1]))
  if (asJson) {
    console.log(JSON.stringify(output.map((o) => o.json), null, 2))
    return
  }
  for (const section of output) {
    console.log(section.lines.join('\n'))
    console.log('')
  }
}

main()
