#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blocks } from './ledger-data.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE_INVENTORY = 'scripts/testing/source-text-inventory-wave0.json';
const inv = JSON.parse(fs.readFileSync(path.join(REPO, BASELINE_INVENTORY), 'utf8'));
const TOL = 8;

const fileBySlug = new Map();
for (const f of inv.files) {
  const slug = path.basename(f.testFile).replace(/\.(js|ts|mjs)$/, '');
  fileBySlug.set(slug, f);
}

function mapSingleCase(cases, from) {
  const floor = cases.filter((x) => x.line <= from).at(-1);
  return floor && (from - floor.line <= TOL) ? [floor.id] : null;
}
function mapRangeCases(cases, from, to) {
  return cases.filter((x) => x.line >= from - TOL && x.line <= to).map((x) => x.id);
}

const anomalies = [];
const perFile = [];
const coveredSlugs = new Set();
const globalCases = new Map();
const nonTextMappings = [];

for (const b of blocks) {
  const f = fileBySlug.get(b.file);
  if (!f) { anomalies.push(`${b.file}: inventory 中无此文件`); continue; }
  coveredSlugs.add(b.file);
  const allCases = f.cases.map((c) => ({ id: c.id, line: c.startLine, name: c.name, textAssertion: c.textAssertion }));
  const textCases = allCases.filter((c) => c.textAssertion);
  const byId = new Map(allCases.map((c) => [c.id, c]));
  const counts = { R: 0, K: 0, D: 0, PK: 0 };
  const seenIds = { R: new Set(), K: new Set(), D: new Set(), PK: new Set() };
  const caseDisp = new Map();
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
    const aligned = typeof key === 'object' ? mapRangeCases(allCases, from, to) : mapSingleCase(allCases, from);
    const unique = [...new Set(aligned ?? [])];
    if (!unique.length) {
      anomalies.push(`${b.file}:${from}-${to} [${d}] 未对齐任何 case`);
      unmappedRows++;
    }
    for (const id of unique) {
      if (!caseDisp.has(id)) caseDisp.set(id, new Set());
      caseDisp.get(id).add(d);
      const gkey = `${f.testFile}:${id}`;
      if (!globalCases.has(gkey)) globalCases.set(gkey, new Set());
      globalCases.get(gkey).add(d);
      if (byId.get(id)?.textAssertion === false) nonTextMappings.push(`${b.file}:${from} → ${id}`);
    }
    if (typeof key === 'object') {
      const fresh = unique.filter((id) => !seenIds[d].has(id));
      for (const id of fresh) seenIds[d].add(id);
      counts[d] += fresh.length;
    } else {
      const id = unique[0];
      if (!id) {
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
    file: f.testFile, allCases: allCases.length, textCases: textCases.length, counts, clauseRows,
    unmappedRows, unmappedCases, uniqueCases: caseDisp.size, conflicts: conflicts.length, dGate,
  });
}

const REQUIRED_MAPPINGS = [
  ['sceneryMaterials.test', 1128, 'sceneryMaterials:1127'],
  ['sceneryMaterials.test', 1306, 'sceneryMaterials:1305'],
  ['sceneryMaterials.test', 1375, 'sceneryMaterials:1373'],
];
for (const [file, line, expected] of REQUIRED_MAPPINGS) {
  const f = fileBySlug.get(file);
  const cases = f ? f.cases.map((c) => ({ id: c.id, line: c.startLine })) : [];
  const actual = mapSingleCase(cases, line)?.[0] ?? '(未对齐)';
  if (actual !== expected) {
    throw new Error(`ledger mapping self-check failed: ${file}:${line} → ${actual}, expected ${expected}`);
  }
}

const scopeGaps = inv.files
  .filter((f) => f.textAssertionCases > 0)
  .map((f) => ({ file: f.testFile, n: f.textAssertionCases }))
  .filter((x) => !coveredSlugs.has(path.basename(x.file).replace(/\.(js|ts|mjs)$/, '')));

const globalConflicts = [...globalCases.entries()].filter(([, set]) => set.size > 1);

let tot = { R: 0, K: 0, D: 0, PK: 0 };
let md = '# Issue #827 台账统计与 D 项门禁（F1/F2 交付，2026-11-11）\n\n';
md += `统计单位统一为 **test case**（u=case 的台账行）；clause 行附着到所属 case，不单独计数。稳定 ID = \`<文件slug>:<case起始行>\`。**对齐基线固定为 \`${BASELINE_INVENTORY}\`（历史提交 67fdb2be 的树，用修正后的分类器重新生成，${inv.totalTextAssertionCases} 个文本用例）**——保留历史行号，但不冻结旧分类器的漏判。映射使用**完整 baseline cases**（含改写后的行为测试），不再先过滤 \`textAssertion\` 再向前借 case；floor 距离超出容差即记未映射。当前树 inventory 只服务探针，不与历史台账混用。\`validation_status\` 初始 PENDING：删除批次实际执行 + 接替测试本地/CI 绿 + 故障注入抽查通过后才置 DONE。\n\n`;

md += '## 统计（case 单位）\n\n区间台账行按区间内实际映射到的 case 数计（去重），单行按 1 计；同一 case 在同类处置的多行里只计一次。未映射 / 超容差的单行单独计数，**不混入 R/K/D**；同一 case 被不同处置引用时列入「跨处置冲突」。\n\n| 文件 | baseline cases（all/text） | R | K | D | PK | clause 行 | 未对齐行 | 未映射单行 | 唯一 case | 跨处置冲突 |\n|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const p of perFile) {
  md += `| ${p.file} | ${p.allCases}/${p.textCases} | ${p.counts.R} | ${p.counts.K} | ${p.counts.D} | ${p.counts.PK} | ${p.clauseRows} | ${p.unmappedRows} | ${p.unmappedCases} | ${p.uniqueCases} | ${p.conflicts} |\n`;
  tot.R += p.counts.R; tot.K += p.counts.K; tot.D += p.counts.D; tot.PK += p.counts.PK;
}
md += `| **合计（已映射 ${perFile.length} 文件）** | — | **${tot.R}** | **${tot.K}** | **${tot.D}** | **${tot.PK}** | **${perFile.reduce((a, p) => a + p.clauseRows, 0)}** | **${perFile.reduce((a, p) => a + p.unmappedRows, 0)}** | **${perFile.reduce((a, p) => a + p.unmappedCases, 0)}** | **${globalCases.size}** | **${globalConflicts.length}** |\n\n`;
md += `> R/K/D/PK 是**处置覆盖计数**（同一 case 跨处置会重复计入，不能相加当唯一 case 数）。全表唯一 case（按 \`testFile:caseId\` 并集）= **${globalCases.size}**；跨处置冲突 **${globalConflicts.length}** 例；未映射单行 **${perFile.reduce((a, p) => a + p.unmappedCases, 0)}** 行（未计入 R/K/D）。映射到非文本（行为）case 的台账行 **${nonTextMappings.length}** 行，见下节人工确认。\n\n`;

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

md += '## 映射到非文本（行为）case 的台账行（人工确认）\n\n';
md += nonTextMappings.length ? nonTextMappings.map((m) => `- ${m}`).join('\n') + '\n' : '（无）\n';
md += '\n## 跨处置冲突（同一 case 被不同处置行引用，人工复核）\n\n';
md += globalConflicts.length
  ? globalConflicts.map(([key, set]) => `- ${key}：${[...set].join(' / ')}`).join('\n') + '\n'
  : '（无）\n';
md += '\n## 对齐异常（人工复核清单）\n\n';
md += anomalies.length ? anomalies.map((a) => `- ${a}`).join('\n') + '\n' : '（无）\n';

fs.writeFileSync(path.join(REPO, 'docs/research/testing/2026-11-11-ledger-stats.md'), md);
console.error(`# files=${perFile.length} R=${tot.R} K=${tot.K} D=${tot.D} PK=${tot.PK} clauseRows=${perFile.reduce((a, p) => a + p.clauseRows, 0)} unmappedRows=${perFile.reduce((a, p) => a + p.unmappedRows, 0)} unmappedCases=${perFile.reduce((a, p) => a + p.unmappedCases, 0)} uniqueCases=${globalCases.size} conflicts=${globalConflicts.length} nonTextMappings=${nonTextMappings.length} scopeGaps=${scopeGaps.reduce((a, g) => a + g.n, 0)} anomalies=${anomalies.length}`);
