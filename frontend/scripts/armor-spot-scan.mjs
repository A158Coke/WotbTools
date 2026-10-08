/**
 * 装甲查看器门禁的「部位像素扫描」表达式构造器（browser-armor-aiming.mjs 用）。
 *
 * 表达式在页面里求值（page.evaluate）：用 __raytrace 找炮管/炮塔壳/车体三处部位的
 * client 坐标像素。每处候选分两档：
 *   - 首选：射线触达主装甲板（Primary）→ 短按必出结论，断言最强；
 *   - 次选：仅触达间隙甲/外部模块（记 primary:false）→ 按 BlitzKit 触发面语义必须无结论
 *     （真实资产覆盖下炮管装甲可能全归 spaced，此时该部位只有次选）。
 * 返回时首选优先于次选；两档分开缓存——**次选不得阻止后续首选写入**（扫描顺序不决定
 * 优先级，见 armor-spot-scan.test.mjs 的回归用例）。
 *
 * 独立成模块是为了让这套选择逻辑能被单测确定性驱动（假 window/document + 假射线）；
 * 判定分类由调用方传入（与 scene/penetration.js 的 isPrimary 同源），脚本里不另抄一份。
 */

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
