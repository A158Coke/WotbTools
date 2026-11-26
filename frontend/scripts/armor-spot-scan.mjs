
/**
 * @param {object} opts
 * @param {string[]} opts.need 需要的部位（'gun' | 'turret' | 'hull'）
 * @param {string[]} opts.primarySections 主装甲（Primary）的 section 取值
 * @returns {string} 一个在页面里求值的 IIFE 表达式，返回 { gun, turret, hull } 候选
 */
export function buildFindSpotsExpr({ need, primarySections }) {
  return `(() => {
    const H = window.__armorRicochet;
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const need = ${JSON.stringify(need)};
    const PRIMARY = ${JSON.stringify(primarySections)};
    const found = { gun: null, turret: null, hull: null };      // 首选：射线触达主装甲
    const fallback = { gun: null, turret: null, hull: null };   // 次选：仅间隙甲/外部模块
    const scan = (step) => {
      for (let cy = 20; cy < c.height - 20; cy += step) {
        for (let cx = 20; cx < c.width - 20; cx += step) {
          const px = r.left + cx, py = r.top + cy;
          if (document.elementFromPoint(px, py) !== c) continue;
          const hits = H.__raytrace(px, py);
          if (!hits || !hits.length) continue;
          const n = hits[0].name;
          const cls = H.__aimPart(px, py);
          const primary = hits.some((h) => PRIMARY.includes(h.sec));
          // 两档分开缓存：次选不得阻止后续首选写入（扫描顺序不决定优先级——先扫到的
          // 间隙甲/外部模块像素若占位，后面真遇到主装甲像素就写不进去了）
          const take = (part, rec) => {
            if (primary) { if (!found[part]) found[part] = rec; }
            else if (!fallback[part]) fallback[part] = rec;
          };
          if (/^gun_/.test(n) && cls === 'gun') take('gun', { x: px, y: py, name: n, cls, primary });
          if (/^turret_/.test(n) && cls === 'turret') take('turret', { x: px, y: py, name: n, cls, primary });
          if (/^hull_/.test(n) && cls === null) take('hull', { x: px, y: py, name: n, cls: 'camera', primary });
          if (need.every((p) => found[p])) return true;
        }
      }
      return false;
    };
    // 先粗后细：步长 8 已足够命中（最细的炮管在屏上也有 ~20px 宽），漏找才回退步长 4。
    // 全画布逐像素双射线（__raytrace + __aimPart）在 CI 的 3fps runner 上要 20s+，粗扫省 4 倍。
    // 仅当某部位连"首选"像素都没有时才细扫（次选已找到不触发细扫，避免无谓整帧扫描）。
    if (!scan(8)) scan(4);
    return { gun: found.gun || fallback.gun, turret: found.turret || fallback.turret, hull: found.hull || fallback.hull };
  })()`
}
