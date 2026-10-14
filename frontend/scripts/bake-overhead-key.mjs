// 俯视烘焙的逐图产物生命周期（Node 侧；scripts/bake-ground-overhead.mjs 逐图调用。CLI 模块带
// 顶层 main、不可导入，独立成文件以便 vitest 直接驱动：伪 page + 临时目录）。
//
// fail-closed（PR #621 re-review P2）：tools/composite_overhead.py 只按 <key>.rgba / <key>.meta.json
// 是否存在读取，不校验是否本轮产出——本图失败而上一轮成品还在，合成即会消费旧结果。故：
//   · 开烘前删除本图上一轮的两份产物（及残留 .tmp）：失败 = 本图无产物；
//   · 像素上传前删除 upload.rgba：上一张图的像素不得冒充本图（存在性/字节数校验才有意义）；
//   · 成功时先写 .tmp 再 rename，meta 最后落盘：meta 在 ⇒ 同轮 .rgba 已完整。
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {{ page: { evaluate: (expr: string) => Promise<any> }, key: string, outDir: string, span: number,
 *           size: number, mapId?: number|null, uploadPath: string }} opts
 *   uploadPath = /pixel-upload 中间件的落盘路径（与 CLI 中间件同一常量）
 */
export async function bakeKey({ page, key, outDir, span, size, mapId = null, uploadPath }) {
  const t0 = Date.now()
  const rgbaPath = join(outDir, `${key}.rgba`)
  const metaPath = join(outDir, `${key}.meta.json`)
  for (const p of [metaPath, rgbaPath, `${metaPath}.tmp`, `${rgbaPath}.tmp`]) rmSync(p, { force: true })
  const load = await page.evaluate(`window.__bake.load(${JSON.stringify(key)}, ${span}, ${mapId})`)
  // 有效跨度 = terrain.json 自愈后的 span（页面加载时确定；相机必须与地面材质/海岸线同值）
  const spanEff = load && Number.isFinite(load.span) ? load.span : span
  const stats = await page.evaluate(`window.__bake.render(${spanEff})`)
  const total = size * size * 4
  rmSync(uploadPath, { force: true })
  await page.evaluate(`fetch('/pixel-upload', { method: 'POST', body: window.__buf }).then(r => r.text())`)
  if (!existsSync(uploadPath)) throw new Error('pixel upload missing')
  const raw = readFileSync(uploadPath)
  if (raw.length !== total) throw new Error(`pixel upload ${raw.length}B != expected ${total}B`)
  writeFileSync(`${rgbaPath}.tmp`, raw)
  writeFileSync(`${metaPath}.tmp`,
    JSON.stringify({ key, span: spanEff, size, ground: !!(load && load.ground), ...stats }))
  renameSync(`${rgbaPath}.tmp`, rgbaPath)
  renameSync(`${metaPath}.tmp`, metaPath)
  return { key, coverPct: stats.coverPct, mb: +(raw.length / 1048576).toFixed(1), ms: Date.now() - t0 }
}
