
const normTank = (s: string | null | undefined): string => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

function tankTokenScore(name: string, tok: string): number {
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

export function tankFuzzyScore(name: string, q: string): number {
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

export const TYPE_CLS: Record<string, string> = { lightTank: 't-light', mediumTank: 't-medium', heavyTank: 't-heavy', 'AT-SPG': 't-td' }
const TYPE_SLUG: Record<string, string> = { lightTank: 'light', mediumTank: 'medium', heavyTank: 'heavy', 'AT-SPG': 'td' }

export function tankNationLabel(t: (key: string) => string, te: (key: string) => boolean, nation: string): string {
  const key = `agentTanks.nations.${nation}`
  return te(key) ? t(key) : nation
}
export function tankTypeLabel(t: (key: string) => string, te: (key: string) => boolean, type: string): string {
  const key = `agentTanks.types.${TYPE_SLUG[type] || type}`
  return te(key) ? t(key) : type
}

export const normType = (t: string | null | undefined): string => {
  t = (t || '').toLowerCase()
  if (t === 'hc' || t === 'hc_premium' || t === 'heat') return 'heat'
  if (t === 'ap_cr' || t === 'ap_cr_premium' || t === 'apcr') return 'apcr'
  if (t === 'he' || t === 'he_premium') return 'he'
  if (t === 'ap' || t === 'ap_premium') return 'ap'
  return t
}
export const shellLabel = (s: { type?: string | null }): string => normType(s.type).toUpperCase()
export const isPremiumShell = (s: { type?: string | null }): boolean => /premium/i.test(s.type || '')


export const fmt = (v: number | string | null | undefined, d = 0): string => (v != null ? Number(v).toFixed(d) : '-')

export const fmtNum = (v: number | string | null | undefined, d = 1): string => {
  if (v == null) return '-'
  const n = Number(v)
  return Number.isFinite(n) ? String(Number(n.toFixed(d))) : '-'
}

export function armorPartLabel(name: unknown, t: (key: string, params?: { plate?: string }) => string): string {
  const raw = typeof name === 'string' ? name : ''
  const known: Record<string, string> = { 'Track (Left)': 'track_left', 'Track (Right)': 'track_right', 'Gun Barrel': 'gun_barrel' }
  if (Object.hasOwn(known, raw)) return t(`armor.parts.${known[raw]}`)
  const plate = /^(Hull|Turret|Gun|Spaced) Plate (\d+)$/.exec(raw)
  if (plate) return t(`armor.parts.${plate[1].toLowerCase()}_plate`, { plate: plate[2] })
  if (/^Gap [\d.]+m$/.test(raw)) return t('armor.parts.gap')
  return raw
}

export function armorResultLabel(result: unknown, t: (key: string) => string): string {
  const keys: Record<string, string> = {
    PENETRATION: 'penetration', BLOCKED: 'blocked', RICOCHET: 'ricochet', SPLASH: 'splash',
    ERROR: 'error', MISS: 'miss', 'NO PENETRATION': 'blocked', 'HE BLAST': 'he_blast', HIT: 'hit',
  }
  return String(result ?? '').split('→').map(value => {
    const raw = value.trim()
    return Object.hasOwn(keys, raw) ? t(`armor.outcomes.${keys[raw]}`) : raw
  }).join(' → ')
}
