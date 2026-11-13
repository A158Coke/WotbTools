#!/usr/bin/env node
/**
 * Issue #827 F1/F2 — 台账统计与 D 项安全门禁表生成器。
 *
 * 统计单位 = test case（u:'case' 行）；u:'clause' 行附着到 case 不计数。
 * 稳定 ID = <文件slug>:<case起始行>（floor 对齐台账行号）。
 * 台账行与 inventory text case 的差异（classifier 漏判/行号偏移）列入「对齐异常」人工复核。
 * D 项无接替者证据 → BLOCKED，不允许删除；validation_status 初始 PENDING。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blocks } from './ledger-data.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const inv = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/testing/source-text-inventory.json'), 'utf8'));

const fileBySlug = new Map();
for (const f of inv.files) {
  const slug = path.basename(f.testFile).replace(/\.(js|ts|mjs)$/, '');
  fileBySlug.set(slug, f);
}

const anomalies = [];
const perFile = [];
const coveredSlugs = new Set();

for (const b of blocks) {
  const f = fileBySlug.get(b.file);
  if (!f) { anomalies.push(`${b.file}: inventory 中无此文件`); continue; }
  coveredSlugs.add(b.file);
  const cases = f.cases.filter((c) => c.textAssertion);
  const starts = cases.map((c) => ({ id: c.id, line: c.startLine, name: c.name }));
  const counts = { R: 0, K: 0, D: 0, PK: 0 };
  let clauseRows = 0;
  const dGate = [];
  for (const row of b.rows) {
    const [key, d, u, t, p] = row;
    const from = typeof key === 'object' ? key.from : key;
    const to = typeof key === 'object' ? key.to : key;
    if (u === 'clause') { clauseRows++; continue; }
    counts[d]++;
    // 对齐到 floor case（供稳定 ID 与人工复核；区间行取区间内 case）
    const TOL = 8;
    const floorLine = Math.max(...starts.filter((x) => x.line <= from).map((x) => x.line), -1);
    let aligned = null;
    if (typeof key === 'object') {
      aligned = starts.filter((x) => x.line >= from - TOL && x.line <= to).map((x) => x.id);
    } else if (floorLine >= 0) {
      aligned = [starts.find((x) => x.line === floorLine).id];
    }
    if (!aligned || !aligned.length) anomalies.push(`${b.file}:${from}-${to} [${d}] 未对齐任何 text case`);
    if (d === 'D') {
      for (const id of aligned?.length ? aligned : ['(未对齐)']) {
        dGate.push({ id, t, p });
      }
    }
  }
  perFile.push({ file: f.testFile, textCases: cases.length, counts, clauseRows, dGate });
}

// 台账未覆盖的 text 文件（scope 缺口）
const scopeGaps = inv.files
  .filter((f) => f.textAssertionCases > 0)
  .map((f) => ({ file: f.testFile, n: f.textAssertionCases }))
  .filter((x) => !coveredSlugs.has(path.basename(x.file).replace(/\.(js|ts|mjs)$/, '')));

let tot = { R: 0, K: 0, D: 0, PK: 0 };
let md = '# Issue #827 台账统计与 D 项门禁（F1/F2 交付，2026-11-11）\n\n';
md += '统计单位统一为 **test case**（u=case 的台账行）；clause 行附着到所属 case，不单独计数。稳定 ID = `<文件slug>:<case起始行>`。台账行与 classifier text case 的出入列入「对齐异常」，人工复核后以台账为准。`validation_status` 初始 PENDING：删除批次实际执行 + 接替测试本地/CI 绿 + 故障注入抽查通过后才置 DONE。\n\n';

md += '## 统计（case 单位）\n\n| 文件 | inventory text cases | R | K | D | PK | clause 行 |\n|---|---|---|---|---|---|---|\n';
for (const p of perFile) {
  md += `| ${p.file} | ${p.textCases} | ${p.counts.R} | ${p.counts.K} | ${p.counts.D} | ${p.counts.PK} | ${p.clauseRows} |\n`;
  tot.R += p.counts.R; tot.K += p.counts.K; tot.D += p.counts.D; tot.PK += p.counts.PK;
}
md += `| **合计（已映射 28 文件）** | — | **${tot.R}** | **${tot.K}** | **${tot.D}** | **${tot.PK}** | **${perFile.reduce((a, p) => a + p.clauseRows, 0)}** |\n\n`;

md += '## 台账未覆盖的 text 断言文件（scope 缺口，Wave 2/3 前需补映射）\n\n';
md += scopeGaps.length ? scopeGaps.map((g) => `- ${g.file}（${g.n} 例）`).join('\n') + '\n' : '（无）\n';
md += `\nscope 缺口合计 ${scopeGaps.reduce((a, g) => a + g.n, 0)} 例 / inventory 全量 181 例。\n\n`;

md += '## D 项安全门禁（F2）\n\n删除前置：① 接替者证据存在；② 接替测试实际执行（本地/CI）；③ 旧守卫独有失败模式抽查（故障注入）；④ validation_status 置 DONE。任何 BLOCKED 项不得删除。\n\n| case ID | 优先级 | 接替者证据 | validation_status |\n|---|---|---|---|\n';
let blocked = 0;
for (const p of perFile) {
  for (const g of p.dGate) {
    if (!g.t || g.t === '(未对齐)') blocked++;
    md += `| ${g.id} | ${g.p || 'MED'} | ${g.t || '**BLOCKED: 无证据**'} | PENDING |\n`;
  }
}
md += `\nD 项合计 ${tot.D}；BLOCKED ${blocked}。\n\n`;

md += '## 对齐异常（人工复核清单）\n\n';
md += anomalies.length ? anomalies.map((a) => `- ${a}`).join('\n') + '\n' : '（无）\n';

fs.writeFileSync(path.join(REPO, 'docs/research/testing/2026-11-11-ledger-stats.md'), md);
console.error(`# files=${perFile.length} R=${tot.R} K=${tot.K} D=${tot.D} PK=${tot.PK} clauseRows=${perFile.reduce((a, p) => a + p.clauseRows, 0)} scopeGaps=${scopeGaps.reduce((a, g) => a + g.n, 0)} anomalies=${anomalies.length}`);
