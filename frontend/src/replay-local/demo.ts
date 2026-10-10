import manifest from '../../../common/assets/onboarding/manifest.json'
import { toRaw } from 'vue'

/** Bundled allowlist: neither query parameters nor a remote manifest can grant demo access. */
export const OFFICIAL_DEMO = Object.freeze({ ...manifest, cue: Object.freeze(manifest.cue) })
const verifiedFiles = new WeakSet<File>()

export function isOfficialDemo(file: File | null | undefined): file is File {
  return file != null && verifiedFiles.has(toRaw(file))
}

/** Download once on explicit use; the real File follows the ordinary parser/session path. */
export async function loadOfficialDemo(signal?: AbortSignal): Promise<File> {
  const response = await fetch(OFFICIAL_DEMO.path, { signal })
  if (!response.ok) throw new Error('Official replay download failed')
  const bytes = await response.arrayBuffer()
  signal?.throwIfAborted()
  if (bytes.byteLength !== OFFICIAL_DEMO.bytes) throw new Error('Official replay size mismatch')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  signal?.throwIfAborted()
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  if (hash !== OFFICIAL_DEMO.sha256) throw new Error('Official replay hash mismatch')
  const file = new File([bytes], OFFICIAL_DEMO.filename, { type: 'application/octet-stream', lastModified: 0 })
  verifiedFiles.add(file)
  return file
}
