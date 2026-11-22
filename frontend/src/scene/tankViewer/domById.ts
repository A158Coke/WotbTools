// DOM 取节点 helper（2026-11-22）：拆分后的 tank 模块沿用原闭包"节点必在"假设，
// 缺失时立即抛出带 id 的错误，而不是在空引用处留下难以定位的 TypeError。
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`[tankViewer] missing #${id}`)
  return el as T
}
