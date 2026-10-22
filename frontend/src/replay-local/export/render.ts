/** Replay-owned archive packaging for the per-battle XLSX exports. */

/** Multiple workbooks to zip (UTF-8 filenames; entry order follows the input). */
export async function zipFiles(files: readonly { name: string; data: Uint8Array }[]): Promise<Uint8Array> {
  const { zipSync } = await import('fflate')
  const entries: Record<string, Uint8Array> = {}
  for (const file of files) entries[file.name] = file.data
  return zipSync(entries, { level: 6 })
}
