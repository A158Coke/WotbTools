// 坦克百科/详情纯函数工具：自上游 Agent 前端 utils/tankSearch.js + tankStats.js
// 语义平移（无依赖纯函数，消费方唯一是 Agent 数据面组件）。

// 归一化：小写 + 去除空格/连字符/点等符号（e100↔E 100、t34↔T-34、obj261↔Object 261）。
// 保留 Unicode 字母/数字（\p{L}\p{N}）：中文车名归一化后原样保留，可被子串/子序列命中。
const normTank = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

// 单 token 对名称打分：① 归一化子串（越靠前越高，前缀再加分）② 子序列（匹配越紧凑越高）。0 = 不匹配。
function tankTokenScore(name, tok) {
  const nn = normTank(name)
  const nq = normTank(tok)
  if (!nq) return 0
  const idx = nn.indexOf(nq)
  if (idx >= 0) return 200 - Math.min(idx, 50) + (idx === 0 ? 50 : 0)
  let first = -1
  let last = -1
  let pi = 0
  for (let i = 0; i < nn.length && pi < nq.length; i++) {
    if (nn[i] === nq[pi]) {
      if (first < 0) first = i
      last = i
      pi++
    }
  }
  if (pi >= nq.length) return Math.max(40, 100 - (last - first + 1 - nq.length))
  return 0
}

// 多 token AND（空格分隔，如 "t28 def"），总分为排序依据
export function tankFuzzyScore(name, q) {
  const toks = q.split(/\s+/).filter(Boolean)
  if (!toks.length) return 1
  let total = 0
  for (const t of toks) {
    const s = tankTokenScore(name, t)
    if (!s) return 0
    total += s
  }
  return total
}

export const TYPE_LABEL = { lightTank: 'Light', mediumTank: 'Medium', heavyTank: 'Heavy', 'AT-SPG': 'TD' }
export const TYPE_CLS = { lightTank: 't-light', mediumTank: 't-medium', heavyTank: 't-heavy', 'AT-SPG': 't-td' }
export const NATION_LABEL = {
  ussr: 'USSR', usa: 'USA', germany: 'Germany', uk: 'UK', japan: 'Japan',
  china: 'China', france: 'France', european: 'EU', other: 'Other',
}

// 弹种显示名（开发名 ap_cr/hc_premium → APCR/HEAT）
export const normType = (t) => {
  t = (t || '').toLowerCase()
  if (t === 'hc' || t === 'hc_premium' || t === 'heat') return 'heat'
  if (t === 'ap_cr' || t === 'ap_cr_premium' || t === 'apcr') return 'apcr'
  if (t === 'he' || t === 'he_premium') return 'he'
  if (t === 'ap' || t === 'ap_premium') return 'ap'
  return t
}
export const shellLabel = (s) => normType(s.type).toUpperCase()
export const isPremiumShell = (s) => /premium/i.test(s.type || '')

// 装甲厚度热力色：20–300mm 映射 红→黄→绿（HSL 色相 0→120；上游 tankStats 同式）
export function armorColorStyle(mm) {
  if (mm == null) return {}
  const t = Math.max(0, Math.min(1, (mm - 20) / 280))
  const hue = Math.round(t * 120)
  return {
    background: `hsla(${hue},58%,46%,0.22)`,
    color: `hsl(${hue},68%,${68 - t * 8}%)`,
  }
}

export const fmt = (v, d = 0) => (v != null ? Number(v).toFixed(d) : '-')

/**
 * 紧凑数值：最多 d 位小数并去掉尾随 0（816 → "816"、2.299999952316284 → "2.3"）。
 * 上游 per-tank JSON 把 f32 字段以 f64 直出（2.3f32 → 2.299999952316284），
 * 不做收敛就会把二进制尾数带进界面。非数值/缺失 → '-'。
 */
export const fmtNum = (v, d = 1) => {
  if (v == null) return '-'
  const n = Number(v)
  return Number.isFinite(n) ? String(Number(n.toFixed(d))) : '-'
}
