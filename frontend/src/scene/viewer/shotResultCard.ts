/**
 * 射击结果卡（armor viewer #traj-info）的 presentation 渲染（Issue #820 Wave B3A）。
 *
 * 从 tankViewer.js `showTrajectory()` 原样搬出的 HTML 拼装：纯函数、不访问
 * window/document、不持有 runtime state、不做 Three.js 或资源生命周期调用。
 * 概率链（`evaluateProbabilityChain`）、伤害与轨迹几何等判定仍由场景内核
 * （tankViewer）完成并经显式 input 传入；本模块只把已算好的结果格式化成与
 * 原实现等价的卡片 HTML（结构、class、style、escaping、显示顺序、概率格式不变）。
 */
import { formatProbabilityPercent } from '../armorInspectorChance.js'
import type { shotResultCardMetrics } from '../../utils/shotResultCardMetrics.js'

/** 卡片尺寸口径（utils/shotResultCardMetrics.js 的返回）。 */
export type ShotResultCardMetrics = ReturnType<typeof shotResultCardMetrics>

/** 卡片层链条目：兼容概率链（snake_case）与 trajLayers（camelCase）的展示字段。 */
export interface ShotResultCardLayer {
  name?: string | null
  thickness?: number | null
  eff?: number | null
  angle?: number | null
  chance?: number | null
  penetrated?: boolean
  ricochet?: boolean
  seg?: number | null
  [key: string]: unknown
}

/** HE 溅射采样结果（penetration.js `he` 字段的展示子集）。 */
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

/** 卡片消费的 labels 子集（三语文案由宿主经 tankViewer labels 注入）。 */
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
}

/** renderShotResultCardHtml 的显式输入（全部由调用方计算）。 */
export interface ShotResultCardInput {
  /** 判定结果串（可含 `→` 多段，如 `RICOCHET → PENETRATION`）。 */
  result: string
  /** 最终层链（概率模式下为 evaluateProbabilityChain 的累计链）。 */
  layers: ReadonlyArray<ShotResultCardLayer>
  /** 非概率模式且 1–99% 时调用方预算好的累计概率链（逐层着色用）；其余 null。 */
  partialChainLayers: ReadonlyArray<ShotResultCardLayer> | null
  /** 有效穿深（距离衰减后），顶行展示。 */
  chancePen: number
  dmgVal: number
  distVal: number
  dmgDealt: number
  /** 轨迹/结果色（场景按最终判定算出的数值色）。 */
  trajectoryColor: number
  cardChance: number
  heInfo: ShotResultCardHeInfo | null
  heChance: number
  heDirectHit: { name: string; thickness: number } | null
  probabilityMode: boolean
  /** 仅 probabilityMode 分支读取；非概率模式调用方传 0。 */
  overallChance: number
  hasChance: boolean
  chancePartial: boolean
  blockedNoPrimary: boolean
  cardMetrics: ShotResultCardMetrics
  cardMaxWidth: number | null
  labels: ShotResultCardLabels
}

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}
const escapeText = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch])

/**
 * 结果卡 HTML：与原 showTrajectory() 的拼装等价。
 * 卡片宽度/紧凑档由调用方按画布容器与视口算好（cardMetrics/cardMaxWidth）传入；
 * renderer 不读 window/document。
 */
export function renderShotResultCardHtml(input: ShotResultCardInput): string {
  const {
    result, layers, partialChainLayers, chancePen,
    dmgVal, distVal, dmgDealt, trajectoryColor,
    cardChance, heInfo, heChance, heDirectHit,
    probabilityMode, overallChance, hasChance, chancePartial, blockedNoPrimary,
    cardMetrics, cardMaxWidth, labels: L,
  } = input
  // ===== 结果面板（对照 BlitzKit ShotDisplayCard）=====
  // 结构：状态+伤害标题（按状态着色）→ 逐层行（主/间隙=等效@角度+名义厚度、
  // 外部模块=flat 厚度、HEAT 间隙=距离+穿深损耗）；跳弹时中间分隔「-25% 穿深」
  // 再出第二段标题。无 Dist / Remain / 汇总行（BlitzKit 卡片不展示这些）。
  const ST_COLOR: Record<string, string> = {
    PENETRATION: 'var(--green)', BLOCKED: 'var(--red)', RICOCHET: 'var(--orange)',
    SPLASH: 'var(--orange)', ERROR: 'var(--red)',
  }
  const stColor = (st: string) => ST_COLOR[st] || 'var(--orange)';
  const fmtNum = (v: number) => {
    const r = Math.round(v);
    return Math.abs(r - v) < 0.05 ? String(r) : (Math.round(v * 10) / 10).toFixed(1);
  };
  // 装甲厚度最多 2 位小数：6.35 不应显示成 6.4。（null/undefined 沿用原 Number(v) 语义。）
  const fmtArmor = (v: number | null | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(Number(n.toFixed(2))) : '-';
  };
  const segments = result.split('→').map(x => x.trim()).filter(Boolean);
  const colorHex = '#' + trajectoryColor.toString(16).padStart(6, '0');
  const probabilityColorCss = (chance: number) => chance >= 1 ? 'var(--green)' : (chance > 0 ? 'var(--yellow)' : 'var(--red)');
  const cardChanceCss = probabilityColorCss(cardChance);
  // HE 结果标题/圆点：0% 但仍有溅射 → 橙色（有效溅射），0% 且无伤害 → 红色；
  // 概率行本身仍用统一的 0 红 / 1–99 黄 / 100 绿。
  const heTitleCss = heInfo
    ? (heChance > 0 ? cardChanceCss : (heInfo.splash_avg > 0 ? 'var(--orange)' : 'var(--red)'))
    : cardChanceCss;
  // Armor Inspector 面板口径：HE 的 "damage" 始终显示满伤（元素
  // elements["damage"] = getDamageArmorForDistance），未击穿/浮动信息走
  // summary_min_damage（he_min）。这里主伤害保持满伤；min/max/avg/expected
  // 在下一行单独列出，避免把 avg 当成 AI 的 damage 对比。
  const displayDamage = heInfo
    ? dmgVal
    : (probabilityMode
      ? (hasChance ? dmgVal : 0)
      // 跳弹续飞的非概率分支：最终段 1–99% 时标题是“可能击穿”，
      // 伤害必须对应满伤（与概率模式 hasChance 同口径），不能沿用
      // 确定性 BLOCKED 的 0。0%/100% 仍按终态伤害。
      : (chancePartial ? dmgVal : dmgDealt));
  // 概率模式：0% 红、1–99% 黄、100% 绿；HE/跳弹保持确定性/黄色补充规则。
  const cardBorder = heInfo
    ? heTitleCss
    : (probabilityMode ? cardChanceCss : (chancePartial ? 'var(--yellow)' : colorHex));
  let html = `<div style="background:var(--tooltip-bg);border-radius:${cardMetrics.radius}px;border-left:${cardMetrics.borderWidth}px solid ${cardBorder};padding:${cardMetrics.padding};font-family:'Segoe UI',sans-serif;white-space:normal;box-sizing:border-box;${cardMaxWidth ? `max-width:${cardMaxWidth}px;` : ''}box-shadow:0 4px 20px rgba(0,0,0,0.5);">`;
  // 顶行：交战距离 · 有效穿深（距离衰减后） · 溅射半径（仅 HE）。
  // 有效穿深取判定链的 probability_penetration（d>100 时已按 far 衰减；
  // HE 恒 near），不再单独占一行。
  if (distVal > 0 || Number.isFinite(chancePen)) {
    const top = [];
    if (distVal > 0) top.push(`${escapeText(L.shotDistance)}: ${fmtNum(distVal)} ${escapeText(L.distanceUnit)}`);
    if (Number.isFinite(chancePen)) top.push(`${escapeText(L.effectivePenetration)}: ${fmtNum(chancePen)}mm`);
    if (heInfo && Number.isFinite(heInfo.explosion_radius) && heInfo.explosion_radius > 0) {
      top.push(`${escapeText(L.heRadius)}: ${fmtNum(heInfo.explosion_radius)} ${escapeText(L.distanceUnit)}`);
    }
    html += `<div style="font-size:${cardMetrics.topFont}px;color:var(--muted);margin-bottom:${cardMetrics.marginTight}px;white-space:normal;overflow-wrap:anywhere;">${top.join(' · ')}</div>`;
  }
  // HE 卡片数值：判定结果右侧显示主伤害值；溅射情形把范围放小字。
  const heFull = heInfo ? Math.round(dmgVal) : 0;
  const heMin = heInfo ? fmtNum(heInfo.splash_min) : '';
  const heMax = heInfo ? fmtNum(heInfo.splash_max) : '';
  const heAvg = heInfo ? fmtNum(heInfo.splash_avg) : '';
  const titleHtml = (st: string, final = false) => {
    let title: string, titleColor: string;
    if (heInfo && final) {
      // 采样器跑不了：显式报错，不给“看起来正常”的溅射数字。
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
    // 伤害数值贴在判定结果右侧：HE 击穿/可能击穿 = 满伤；纯溅射 = 平均伤害 + 范围小字；
    // 可能击穿的 HE 同时用小字保留溅射平均/范围。非 HE 显示本次判定伤害（未击穿也显式给 0）。
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
    // data-card-title：小屏收起态只留最终判定这一行作为顶部胶囊（AgentArmorView 样式所有）
    return `<div data-card-title="${final ? 'final' : 'segment'}" style="display:flex;flex-wrap:wrap;align-items:baseline;font-size:${cardMetrics.titleFont}px;font-weight:bold;color:${titleColor};margin-bottom:${cardMetrics.marginTight}px;white-space:normal;overflow-wrap:anywhere;">`
      + `<span>${escapeText(title)}</span>${damageHtml}</div>`;
  };
  // 击穿概率行：跳弹链只在【最终判定结果】下侧出现，不能挂在第一段“跳弹”下面。
  const chanceRowHtml = () => {
    if (heInfo && heInfo.unavailable) {
      // 采样不可用时概率行是误导（0% 看起来像“挡下”），换成显式原因。
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
  if (segments.length === 1) html += chanceRowHtml();
  if (blockedNoPrimary) {
    html += `<div style="font-size:${cardMetrics.expectedFont}px;color:var(--muted);margin-bottom:${cardMetrics.marginTight}px;white-space:normal;overflow-wrap:anywhere;">${escapeText(L.noPrimaryBlocked)}</div>`;
  }
  if (heInfo) {
    // 直接命中（爆炸面）紧贴最佳样本上方，只显示位置 + 名义厚度，
    // 不显示等效/角度/概率链。
      const hit = heDirectHit || (layers[0]
        // 与原实现等价：escapeText/partName 对空串与缺失字段同形（layers[0] 恒有名/thickness）。
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
      // 最佳射线可能穿过 17 层履带/模块：只展示前 4 层 + 剩余层数，
      // 并允许窄屏换行（卡片容器是 nowrap，评审 P2：360/390px 会横向溢出）。
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
  // 跳弹续飞的非 probabilityMode 分支也保留逐层概率色：最终段 1–99%
  // 时标题是“可能击穿”，对应装甲板不能仍是确定性红色；按概率链的
  // 累计 chance 着色，首段跳弹仍保持橙色。（累计链由调用方预算。）
  let partialCursor = 0;
  const nextPartialChance = (layer: ShotResultCardLayer) => {
    const layerSeg = layer.seg ?? 0;
    if (!partialChainLayers || !(layerSeg > 0)) return null;
    while (partialCursor < partialChainLayers.length && (partialChainLayers[partialCursor].seg ?? 0) < layerSeg) partialCursor++;
    const ev = partialChainLayers[partialCursor];
    if (!ev || (ev.seg ?? 0) !== layerSeg) return null;
    partialCursor++;
    return Number.isFinite(ev.chance) ? (ev.chance ?? 0) : null;
  };
  // 有效穿深已并入顶行（距离衰减后），不再重复一行。
  if (!heInfo) {
    let layerNo = 0;
    let prevSeg = 0;
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      const segNo = l.seg ?? 0;
      // 每一段跳弹都在首层前插分隔线 + 该段标题；只有最后一段显示最终结果和概率。
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
      const layerChance = probabilityMode ? (l.chance ?? 0) : null;
      const partialChance = probabilityMode ? null : nextPartialChance(l);
      const pc = blockedNoPrimary
        ? 'var(--red)'
        : (probabilityMode
          ? probabilityColorCss(layerChance ?? 0)
          : (partialChance != null
            ? probabilityColorCss(partialChance)
            : (l.penetrated ? 'var(--green)' : (l.ricochet ? 'var(--orange)' : 'var(--red)'))));
      const th = Number(l.thickness);
      const isGap = /^Gap /.test(l.name || '');
      let main: string, sub: string;
      if (isGap) {
        // HEAT 间隙层：距离（mm）+ 跳弹损耗（BlitzKit：max(-100, -50×距离米)）
        const distM = parseFloat((l.name || '').slice(4)) || 0;
        main = `${Math.round(distM * 1000)}mm`;
        sub = `${L.shotLoss} ${Math.max(-100, -50 * distM).toFixed(0)}%`;
      } else if (l.eff != null && l.eff > 0 && l.angle != null) {
        // 主/间隙装甲：等效厚度 @ 入射角 + 名义厚度（BlitzKit thickness_and_angle + nominal）
        main = `${fmtNum(l.eff)}mm @ ${Math.round(l.angle)}°`;
        sub = `${L.shotNominal} ${fmtArmor(th)}mm`;
      } else if (l.angle != null) {
        // 有入射角但非跳弹的层（含 0mm 口径碾压板）只显示厚度/角度；
        // “跳弹 (-25% 穿深)”只能挂在真正 ricochet=true 的层上。
        main = `${fmtArmor(th)}mm @ ${Math.round(l.angle)}°`;
        sub = l.ricochet ? L.shotRicochetSeg : '';
      } else {
        // 外部模块：flat 厚度（BlitzKit External 只显示厚度）
        main = `${fmtArmor(th)}mm`;
        sub = probabilityMode
          ? ((l.chance ?? 0) > 0 ? '' : L.shotBlocked)
          : (l.penetrated ? '' : L.shotBlocked);
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
