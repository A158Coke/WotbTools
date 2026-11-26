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
