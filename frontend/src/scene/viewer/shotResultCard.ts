import { formatProbabilityPercent } from '../armorInspectorChance.js'
import { RESULT_CSS_VAR, layerResultRole, resultRoleForOutcome, type ShotResultRole } from './shotResultPalette.js'
import type { shotResultCardMetrics } from '../../utils/shotResultCardMetrics.js'

export type ShotResultCardMetrics = ReturnType<typeof shotResultCardMetrics>

export interface ShotResultCardLayer {
  name?: string | null
  thickness?: number | null
  eff?: number | null
  angle?: number | null
  chance?: number | null
  layerChance?: number | null
  reached?: boolean
  penetrated?: boolean
  ricochet?: boolean
  seg?: number | null
  [key: string]: unknown
}

export interface ShotResultCardHeInfo {
  splash_min: number
  splash_max: number
  splash_avg: number
  explosion_radius: number
  expected_damage?: number
  unavailable?: boolean
  reason?: string | null
  best?: {
    distance: number
    armor?: number | null
    layers: ReadonlyArray<{ section?: string | null; armor?: number | null }>
  } | null
  best_lower?: {
    distance: number
    armor?: number | null
    layers: ReadonlyArray<{ section?: string | null; armor?: number | null }>
  } | null
  [key: string]: unknown
}

export interface ShotResultCardLabels {
  shotDistance: string
  distanceUnit: string
  effectivePenetration: string
  heRadius: string
  shotSplashDamage: string
  shotAvgShort: string
  mayPenetrate: string
  resultName: (result: string) => string
  shotPenChance: string
  expectedDamage: string
  heSamplingUnavailable: string
  noPrimaryBlocked: string
  directHit: string
  partName: (name: string | null | undefined) => string
  sectionName: (section: string | null | undefined) => string
  heBestSample: string
  heBestSampleUpper: string
  heBestSampleLower: string
  shotRicochetSeg: string
  shotLoss: string
  shotNominal: string
  shotBlocked: string
  fragMismatch: string
}

export interface ShotResultCardInput {
  result: string
  layers: ReadonlyArray<ShotResultCardLayer>
  partialChainLayers: ReadonlyArray<ShotResultCardLayer> | null
  chancePen: number
  dmgVal: number
  distVal: number
  dmgDealt: number
  resultRole: ShotResultRole
  layerRoles?: ReadonlyArray<ShotResultRole>
  cardChance: number
  heInfo: ShotResultCardHeInfo | null
  heChance: number
  heDirectHit: { name: string; thickness: number } | null
  probabilityMode: boolean
  overallChance: number
  hasChance: boolean
  chancePartial: boolean
  blockedNoPrimary: boolean
  fragValidated?: boolean | null
  cardMetrics: ShotResultCardMetrics
  cardMaxWidth: number | null
  labels: ShotResultCardLabels
}

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}
const escapeText = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch])

export function createPartialChanceResolver(
  partialChainLayers: ReadonlyArray<ShotResultCardLayer> | null,
): (layer: ShotResultCardLayer) => number | null {
  let partialCursor = 0
  return (layer) => {
    const layerSeg = layer.seg ?? 0;
    if (!partialChainLayers || !(layerSeg > 0)) return null;
    while (partialCursor < partialChainLayers.length && (partialChainLayers[partialCursor].seg ?? 0) < layerSeg) partialCursor++;
    const ev = partialChainLayers[partialCursor];
    if (!ev || (ev.seg ?? 0) !== layerSeg) return null;
    partialCursor++;
    const local = Number.isFinite(ev.layerChance) ? (ev.layerChance ?? 0) : ev.chance;
    return Number.isFinite(local) ? (local ?? 0) : null;
  };
}

export function renderShotResultCardHtml(input: ShotResultCardInput): string {
  const {
    result, layers, partialChainLayers, chancePen,
    dmgVal, distVal, dmgDealt, resultRole, layerRoles,
    cardChance, heInfo, heChance, heDirectHit,
    probabilityMode, overallChance, hasChance, chancePartial, blockedNoPrimary,
    fragValidated = null,
    cardMetrics, cardMaxWidth, labels: L,
  } = input
  const stColor = (st: string) => RESULT_CSS_VAR[resultRoleForOutcome(st)];
  const fmtNum = (v: number) => {
    const r = Math.round(v);
    return Math.abs(r - v) < 0.05 ? String(r) : (Math.round(v * 10) / 10).toFixed(1);
  };
  const fmtArmor = (v: number | null | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(Number(n.toFixed(2))) : '-';
  };
  const segments = result.split('→').map(x => x.trim()).filter(Boolean);
  const probabilityColorCss = (chance: number) => chance >= 1 ? 'var(--green)' : (chance > 0 ? 'var(--yellow)' : 'var(--red)');
  const cardChanceCss = probabilityColorCss(cardChance);
  const heTitleCss = heInfo
    ? (heChance > 0 ? cardChanceCss : (heInfo.splash_avg > 0 ? 'var(--orange)' : 'var(--red)'))
    : cardChanceCss;
  const displayDamage = heInfo
    ? dmgVal
    : (probabilityMode
      ? (hasChance ? dmgVal : 0)
      : (chancePartial ? dmgVal : dmgDealt));
  const cardBorder = heInfo
    ? heTitleCss
    : (probabilityMode ? cardChanceCss : (chancePartial ? 'var(--yellow)' : RESULT_CSS_VAR[resultRole]));
  let html = `<div style="background:var(--tooltip-bg);border-radius:${cardMetrics.radius}px;border-left:${cardMetrics.borderWidth}px solid ${cardBorder};padding:${cardMetrics.padding};font-family:'Segoe UI',sans-serif;white-space:normal;box-sizing:border-box;${cardMaxWidth ? `max-width:${cardMaxWidth}px;` : ''}box-shadow:0 4px 20px rgba(0,0,0,0.5);">`;
  if (distVal > 0 || Number.isFinite(chancePen)) {
    const top = [];
    if (distVal > 0) top.push(`${escapeText(L.shotDistance)}: ${fmtNum(distVal)} ${escapeText(L.distanceUnit)}`);
    if (Number.isFinite(chancePen)) top.push(`${escapeText(L.effectivePenetration)}: ${fmtNum(chancePen)}mm`);
    if (heInfo && Number.isFinite(heInfo.explosion_radius) && heInfo.explosion_radius > 0) {
      top.push(`${escapeText(L.heRadius)}: ${fmtNum(heInfo.explosion_radius)} ${escapeText(L.distanceUnit)}`);
    }
    html += `<div style="font-size:${cardMetrics.topFont}px;color:var(--muted);margin-bottom:${cardMetrics.marginTight}px;white-space:normal;overflow-wrap:anywhere;">${top.join(' · ')}</div>`;
  }
  const heFull = heInfo ? Math.round(dmgVal) : 0;
  const heMin = heInfo ? fmtNum(heInfo.splash_min) : '';
  const heMax = heInfo ? fmtNum(heInfo.splash_max) : '';
  const heAvg = heInfo ? fmtNum(heInfo.splash_avg) : '';
  const titleHtml = (st: string, final = false) => {
    let title: string, titleColor: string;
    if (heInfo && final) {
      title = heInfo.unavailable
        ? L.resultName('ERROR')
        : (heChance >= 1
          ? L.resultName('PENETRATION')
          : (heChance > 0
            ? L.mayPenetrate
            : (heInfo.splash_avg > 0 ? L.resultName('SPLASH') : L.resultName('BLOCKED'))));
      titleColor = heInfo.unavailable ? 'var(--red)' : heTitleCss;
    } else if (probabilityMode && final) {
      const partial = hasChance && overallChance < 1;
      title = partial
        ? L.mayPenetrate
        : L.resultName(overallChance >= 1 ? 'PENETRATION' : 'BLOCKED');
      titleColor = probabilityColorCss(overallChance);
    } else {
      const partial = final && chancePartial;
      title = partial ? L.mayPenetrate : L.resultName(st);
      titleColor = partial ? 'var(--yellow)' : stColor(st);
    }
    let damageHtml = '';
    if (final) {
      const damageValueCss = `font-size:${cardMetrics.damageFont}px;color:var(--txt);font-weight:600;margin-left:${cardMetrics.damageGap}px;`;
      if (heInfo) {
        if (heInfo.unavailable) {
          damageHtml = `<span style="${damageValueCss}">· —</span>`;
        } else if (heChance > 0) {
          const splashDetail = heChance < 1
            ? ` <span style="font-size:${cardMetrics.expectedFont}px;color:var(--muted);font-weight:normal;">(${escapeText(L.shotSplashDamage)} ${heAvg} · ${heMin} - ${heMax})</span>`
            : '';
          damageHtml = `<span style="${damageValueCss}">· ${heFull}${splashDetail}</span>`;
        } else if (heInfo.splash_avg > 0) {
          damageHtml = `<span style="${damageValueCss}">· ${escapeText(L.shotAvgShort)} ${heAvg}`
            + ` <span style="font-size:${cardMetrics.expectedFont}px;color:var(--muted);font-weight:normal;">(${heMin} - ${heMax})</span></span>`;
        } else {
          damageHtml = `<span style="${damageValueCss}">· 0</span>`;
        }
      } else {
        damageHtml = `<span style="${damageValueCss}">· ${Math.round(displayDamage || 0)}</span>`;
      }
    }
    return `<div data-card-title="${final ? 'final' : 'segment'}" style="display:flex;flex-wrap:wrap;align-items:baseline;font-size:${cardMetrics.titleFont}px;font-weight:bold;color:${titleColor};margin-bottom:${cardMetrics.marginTight}px;white-space:normal;overflow-wrap:anywhere;">`
      + `<span>${escapeText(title)}</span>${damageHtml}</div>`;
  };
  const chanceRowHtml = () => {
    if (heInfo && heInfo.unavailable) {
      return `<div style="font-size:${cardMetrics.expectedFont}px;color:var(--red);margin-bottom:${cardMetrics.marginTight}px;overflow-wrap:anywhere;">`
        + `${escapeText(L.heSamplingUnavailable)}<span style="color:var(--muted);"> · ${escapeText(heInfo.reason || 'unknown')}</span></div>`;
    }
    let s = `<div style="font-size:${cardMetrics.chanceFont}px;font-weight:600;color:${cardChanceCss};margin-bottom:${cardMetrics.marginTight}px;font-variant-numeric:tabular-nums;">${L.shotPenChance}: ${formatProbabilityPercent(cardChance)}%</div>`;
    if (heInfo && heChance > 0 && heChance < 1 && Number.isFinite(heInfo.expected_damage)) {
      s += `<div style="font-size:${cardMetrics.expectedFont}px;color:var(--muted);line-height:${cardMetrics.expectedLine}px;">${L.expectedDamage}: ${fmtNum(heInfo.expected_damage as number)}</div>`;
    }
    return s;
  };
  html += titleHtml(segments[0], segments.length === 1);
  if (fragValidated === false) {
    html += `<div data-card-badge="frag-mismatch" style="font-size:${cardMetrics.expectedFont}px;color:var(--yellow);margin-bottom:${cardMetrics.marginTight}px;white-space:normal;overflow-wrap:anywhere;">`
      + `▲ ${escapeText(L.fragMismatch)}</div>`;
  }
  if (segments.length === 1) html += chanceRowHtml();
  if (blockedNoPrimary) {
    html += `<div style="font-size:${cardMetrics.expectedFont}px;color:var(--muted);margin-bottom:${cardMetrics.marginTight}px;white-space:normal;overflow-wrap:anywhere;">${escapeText(L.noPrimaryBlocked)}</div>`;
  }
  if (heInfo) {
      const hit = heDirectHit || (layers[0]
        ? { name: layers[0].name ?? '', thickness: layers[0].thickness }
        : null);
    if (hit) {
      html += `<div style="font-size:${cardMetrics.layerFont}px;line-height:${cardMetrics.layerLine}px;margin-top:${cardMetrics.marginTight}px;">`
        + `<span style="display:inline-block;width:${cardMetrics.bulletWidth}px;color:${heTitleCss};">●</span>`
        + `<span style="color:var(--muted);margin-right:${cardMetrics.damageGap}px;">${escapeText(L.directHit)}:</span>`
        + `<span style="color:var(--txt);">${escapeText(L.partName(hit.name))}</span>`
        + `<span style="color:var(--txt);margin-left:${cardMetrics.inlineGap}px;">${fmtArmor(hit.thickness)}mm</span>`
        + `</div>`;
    }
    if (heInfo.best && Array.isArray(heInfo.best.layers) && heInfo.best.layers.length > 0) {
      const BEST_LAYER_LIMIT = 4;
      const fmtBest = (sample: { distance: number; layers: ReadonlyArray<{ section?: string | null; armor?: number | null }> }) => {
        const bestLayers = sample.layers;
        const shown = bestLayers.slice(0, BEST_LAYER_LIMIT)
          .map(l => `${L.sectionName(l.section)} ${fmtArmor(l.armor)}mm`)
          .join(' → ');
        const more = bestLayers.length > BEST_LAYER_LIMIT
          ? ` → +${bestLayers.length - BEST_LAYER_LIMIT}`
          : '';
        return `${shown}${more} @ ${Number(sample.distance).toFixed(2)} ${L.distanceUnit}`;
      };
      const bestLineStyle = `font-size:${cardMetrics.expectedFont}px;color:var(--muted);margin-bottom:${cardMetrics.marginTight}px;white-space:normal;overflow-wrap:anywhere;`;
      const same = heInfo.best_lower
        && heInfo.best_lower.distance === heInfo.best.distance
        && heInfo.best_lower.armor === heInfo.best.armor;
      if (same || !heInfo.best_lower) {
        html += `<div style="${bestLineStyle}">${L.heBestSample}: ${fmtBest(heInfo.best)}</div>`;
      } else {
        html += `<div style="${bestLineStyle}">${L.heBestSampleUpper}: ${fmtBest(heInfo.best)}</div>`;
        html += `<div style="${bestLineStyle}">${L.heBestSampleLower}: ${fmtBest(heInfo.best_lower)}</div>`;
      }
    }
  }
  const nextPartialChance = createPartialChanceResolver(partialChainLayers);
  if (!heInfo) {
    let layerNo = 0;
    let prevSeg = 0;
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      const segNo = l.seg ?? 0;
      if (segments.length > 1 && segNo > 0 && segNo !== prevSeg) {
        const finalSeg = segNo === segments.length - 1;
        html += `<div style="display:flex;align-items:center;gap:${cardMetrics.damageGap}px;margin:${cardMetrics.marginNormal}px 0;">`;
        html += `<span style="flex:1;border-top:1px solid var(--border);"></span>`;
        html += `<span style="font-size:${cardMetrics.expectedFont}px;color:var(--muted);">${L.shotRicochetSeg}</span>`;
        html += `<span style="flex:1;border-top:1px solid var(--border);"></span></div>`;
        html += titleHtml(segments[segNo] || segments[segments.length - 1], finalSeg);
        if (finalSeg) html += chanceRowHtml();
        prevSeg = segNo;
      }
      const reached = l.reached !== false;
      const partialChance = probabilityMode ? null : nextPartialChance(l);
      const role = layerRoles?.[i] ?? layerResultRole({
        layer: l,
        probabilityMode,
        blockedNoPrimary,
        partialChance,
      });
      const pc = RESULT_CSS_VAR[role];
      const th = Number(l.thickness);
      const isGap = /^Gap /.test(l.name || '');
      let main: string, sub: string;
      if (isGap) {
        const distM = parseFloat((l.name || '').slice(4)) || 0;
        main = `${Math.round(distM * 1000)}mm`;
        sub = `${L.shotLoss} ${Math.max(-100, -50 * distM).toFixed(0)}%`;
      } else if (l.eff != null && l.eff > 0 && l.angle != null) {
        main = `${fmtNum(l.eff)}mm @ ${Math.round(l.angle)}°`;
        sub = `${L.shotNominal} ${fmtArmor(th)}mm`;
      } else if (l.angle != null) {
        main = `${fmtArmor(th)}mm @ ${Math.round(l.angle)}°`;
        sub = l.ricochet ? L.shotRicochetSeg : '';
      } else {
        main = `${fmtArmor(th)}mm`;
        sub = !reached
          ? ''
          : (probabilityMode
            ? ((l.chance ?? 0) > 0 ? '' : L.shotBlocked)
            : (l.penetrated ? '' : L.shotBlocked));
      }
      const idx = isGap ? '' : `${++layerNo}.`;
      html += `<div style="font-size:${cardMetrics.layerFont}px;line-height:${cardMetrics.layerLine}px;">`;
      html += `<span style="display:inline-block;width:${cardMetrics.bulletWidth}px;color:${pc};">●</span>`;
      html += `<span style="color:var(--muted);display:inline-block;min-width:${cardMetrics.indexWidth}px;">${idx}</span>`;
      html += `<span style="color:var(--txt);" title="${escapeText(l.name)}">${escapeText(L.partName(l.name))}</span>`;
      html += `<span style="color:${pc};margin-left:${cardMetrics.inlineGap}px;">${main}</span>`;
      if (sub) html += `<span style="color:var(--muted);margin-left:${cardMetrics.inlineGap}px;">${sub}</span>`;
      html += `</div>`;
    }
  }
  html += `</div>`;
  return html;
}
