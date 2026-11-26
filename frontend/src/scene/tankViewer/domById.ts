export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`[tankViewer] missing #${id}`)
  return el as T
}
