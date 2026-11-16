#!/usr/bin/env node
/**
 * Issue #827 F1/F2 — 台账统计与 D 项安全门禁表生成器。
 *
 * 统计单位 = test case（u:'case' 行）；u:'clause' 行附着到 case 不计数。
 * 稳定 ID = <文件slug>:<case起始行>（floor 对齐台账行号）。
 *
 * 对齐基线固定为 Wave 0 快照 `source-text-inventory-wave0.json`（181 例）：
 * ledger-data.mjs 的行号属于改写前的测试树，不能用改写后重生成的 inventory
 * 反推（跨版本行号会把多个历史 case 误并到同一 floor case）。当前树 inventory
 * 只服务探针，不与历史台账混用。
 *
 * 未映射的单行单独计数，不混入 R/K/D case 总数；同一 case 被不同处置行引用时
 * 计入「跨处置冲突」，不把分处置计数解释成唯一 case 数。
 * D 项无接替者证据 → BLOCKED，不允许删除；validation_status 初始 PENDING。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blocks } from './ledger-data.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE_INVENTORY = 'scripts/testing/source-text-inventory-wave0.json';
const inv = JSON.parse(fs.readFileSync(path.join(REPO, BASELINE_INVENTORY), 'utf8'));

const fileBySlug = new Map();
for (const f of inv.files) {
  const slug = path.basename(f.testFile).replace(/\.(js|ts|mjs)$/, '');
  fileBySlug.set(slug, f);
}

const anomalies = [];
const perFile = [];
const coveredSlugs = new Set();
const globalCases = new Map();   // `${file}:${id}` -> Set(disposition)

for (const b of blocks) {
  const f = fileBySlug.get(b.file);
  if (!f) { anomalies.push(`${b.file}: inventory 中无此文件`); continue; }
  coveredSlugs.add(b.file);
  const cases = f.cases.filter((c) => c.textAssertion);
  const starts = cases.map((c) => ({ id: c.id, line: c.startLine, name: c.name }));
  const counts = { R: 0, K: 0, D: 0, PK: 0 };
  // 同一 case 在同类处置的多行里只计一次（review P2）；跨处置另行记录冲突。
  const seenIds = { R: new Set(), K: new Set(), D: new Set(), PK: new Set() };
  const caseDisp = new Map();   // id -> Set(disposition)
  let clauseRows = 0;
  let unmappedRows = 0;
  let unmappedCases = 0;
  const dGate = [];
  const seenGate = new Set();
  for (const row of b.rows) {
    const [key, d, u, t, p] = row;
    const from = typeof key === 'object' ? key.from : key;
    const to = typeof key === 'object' ? key.to : key;
    if (u === 'clause') { clauseRows++; continue; }
    // 对齐到 floor case（供稳定 ID 与人工复核；区间行取区间内 case）
    const TOL = 8;
    const floorLine = Math.max(...starts.filter((x) => x.line <= from).map((x) => x.line), -1);
    let aligned = null;
    if (typeof key === 'object') {
      aligned = starts.filter((x) => x.line >= from - TOL && x.line <= to).map((x) => x.id);
    } else if (floorLine >= 0) {
      aligned = [starts.find((x) => x.line === floorLine).id];
    }
    const unique = [...new Set(aligned ?? [])];
    if (!unique.length) {
      anomalies.push(`${b.file}:${from}-${to} [${d}] 未对齐任何 text case`);
      unmappedRows++;
    }
    for (const id of unique) {
      if (!caseDisp.has(id)) caseDisp.set(id, new Set());
      caseDisp.get(id).add(d);
      const gkey = `${f.testFile}:${id}`;
      if (!globalCases.has(gkey)) globalCases.set(gkey, new Set());
      globalCases.get(gkey).add(d);
    }
    if (typeof key === 'object') {
      const fresh = unique.filter((id) => !seenIds[d].has(id));
      for (const id of fresh) seenIds[d].add(id);
      counts[d] += fresh.length;
    } else {
      const id = unique[0];
      if (!id) {
        // 未映射的单行没有可归属 case：单独计数，不能混入 R/K/D 总数。
        unmappedCases++;
      } else if (!seenIds[d].has(id)) {
        counts[d] += 1;
        seenIds[d].add(id);
      }
    }
    if (d === 'D') {
      for (const id of unique.length ? unique : ['(未对齐)']) {
        if (seenGate.has(id)) continue;
        seenGate.add(id);
        dGate.push({ id, t, p });
      }
    }
  }
  const conflicts = [...caseDisp.entries()].filter(([, set]) => set.size > 1);
  for (const [id, set] of conflicts) {
    anomalies.push(`${b.file}: case ${id} 跨处置冲突（${[...set].join('/')}）`);
  }
  perFile.push({
    file: f.testFile, textCases: cases.length, counts, clauseRows,
    unmappedRows, unmappedCases, uniqueCases: caseDisp.size, conflicts: conflicts.length, dGate,
  });
}

// 台账未覆盖的 text 文件（scope 缺口，按台账同一 baseline 统计）
const scopeGaps = inv.files
  .filter((f) => f.textAssertionCases > 0)
  .map((f) => ({ file: f.testFile, n: f.textAssertionCases }))
  .filter((x) => !coveredSlugs.has(path.basename(x.file).replace(/\.(js|ts|mjs)$/, '')));

const globalConflicts = [...globalCases.entries()].filter(([, set]) => set.size > 1);

let tot = { R: 0, K: 0, D: 0, PK: 0 };
let md = '# Issue #827 台账统计与 D 项门禁（F1/F2 交付，2026-11-11）\n\n';
md += `统计单位统一为 **test case**（u=case 的台账行）；clause 行附着到所属 case，不单独计数。稳定 ID = \`<文件slug>:<case起始行>\`。**对齐基线固定为 \`${BASELINE_INVENTORY}\`（Wave 0 快照，${inv.totalTextAssertionCases} 例）**——台账行号属于改写前的测试树，不能用改写后重生成的当前 inventory 反推。当前树 inventory 只服务探针，不与历史台账混用。台账行与基线 case 的出入列入「对齐异常」，人工复核后以台账为准。\`validation_status\` 初始 PENDING：删除批次实际执行 + 接替测试本地/CI 绿 + 故障注入抽查通过后才置 DONE。\n\n`;

md += '## 统计（case 单位）\n\n区间台账行按区间内实际映射到的 case 数计（去重），单行按 1 计；同一 case 在同类处置的多行里只计一次。未映射的单行单独计数，**不混入 R/K/D**；同一 case 被不同处置引用时列入「跨处置冲突」。\n\n| 文件 | baseline text cases | R | K | D | PK | clause 行 | 未对齐行 | 未映射单行 | 唯一 case | 跨处置冲突 |\n|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const p of perFile) {
  md += `| ${p.file} | ${p.textCases} | ${p.counts.R} | ${p.counts.K} | ${p.counts.D} | ${p.counts.PK} | ${p.clauseRows} | ${p.unmappedRows} | ${p.unmappedCases} | ${p.uniqueCases} | ${p.conflicts} |\n`;
  tot.R += p.counts.R; tot.K += p.counts.K; tot.D += p.counts.D; tot.PK += p.counts.PK;
}
md += `| **合计（已映射 ${perFile.length} 文件）** | — | **${tot.R}** | **${tot.K}** | **${tot.D}** | **${tot.PK}** | **${perFile.reduce((a, p) => a + p.clauseRows, 0)}** | **${perFile.reduce((a, p) => a + p.unmappedRows, 0)}** | **${perFile.reduce((a, p) => a + p.unmappedCases, 0)}** | **${globalCases.size}** | **${globalConflicts.length}** |\n\n`;
md += `> R/K/D/PK 是**处置覆盖计数**（同一 case 跨处置会重复计入，不能相加当唯一 case 数）。全表唯一 case（按 \`testFile:caseId\` 并集）= **${globalCases.size}**；跨处置冲突 **${globalConflicts.length}** 例；未映射单行 **${perFile.reduce((a, p) => a + p.unmappedCases, 0)}** 行（未计入 R/K/D）。\n\n`;

md += '## 台账未覆盖的 text 断言文件（scope 缺口，Wave 2/3 前需补映射）\n\n';
md += scopeGaps.length ? scopeGaps.map((g) => `- ${g.file}（${g.n} 例）`).join('\n') + '\n' : '（无）\n';
const inventoryTextCases = inv.totalTextAssertionCases
  ?? inv.files.reduce((a, f) => a + (f.textAssertionCases || 0), 0);
md += `\nscope 缺口合计 ${scopeGaps.reduce((a, g) => a + g.n, 0)} 例 / baseline inventory 全量 ${inventoryTextCases} 例。\n\n`;

md += '## D 项安全门禁（F2）\n\n删除前置：① 接替者证据存在；② 接替测试实际执行（本地/CI）；③ 旧守卫独有失败模式抽查（故障注入）；④ validation_status 置 DONE。任何 BLOCKED 项不得删除。\n\n| case ID | 优先级 | 接替者证据 | validation_status |\n|---|---|---|---|\n';
let blocked = 0;
for (const p of perFile) {
  for (const g of p.dGate) {
    if (!g.t || g.t === '(未对齐)') blocked++;
    md += `| ${g.id} | ${g.p || 'MED'} | ${g.t || '**BLOCKED: 无证据**'} | PENDING |\n`;
  }
}
md += `\nD 项处置覆盖 ${tot.D}；BLOCKED ${blocked}。\n\n`;

md += '## 跨处置冲突（同一 case 被不同处置行引用，人工复核）\n\n';
md += globalConflicts.length
  ? globalConflicts.map(([key, set]) => `- ${key}：${[...set].join(' / ')}`).join('\n') + '\n'
  : '（无）\n';
md += '\n## 对齐异常（人工复核清单）\n\n';
md += anomalies.length ? anomalies.map((a) => `- ${a}`).join('\n') + '\n' : '（无）\n';

fs.writeFileSync(path.join(REPO, 'docs/research/testing/2026-11-11-ledger-stats.md'), md);
console.error(`# files=${perFile.length} R=${tot.R} K=${tot.K} D=${tot.D} PK=${tot.PK} clauseRows=${perFile.reduce((a, p) => a + p.clauseRows, 0)} unmappedRows=${perFile.reduce((a, p) => a + p.unmappedRows, 0)} unmappedCases=${perFile.reduce((a, p) => a + p.unmappedCases, 0)} uniqueCases=${globalCases.size} conflicts=${globalConflicts.length} scopeGaps=${scopeGaps.reduce((a, g) => a + g.n, 0)} anomalies=${anomalies.length}`);
