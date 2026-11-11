#!/usr/bin/env node
/**
 * Issue #827 Step 0 — 源码文本断言效力探针。
 *
 * 对每个「生产源文件 → 读取它的测试文件集合」执行：
 *  - 语义变异探针：翻转比较运算符 / 数值字面量偏移（真实语义变更），
 *    跑读取方测试，变红 = 捕获（killed）。
 *  - 等价重命名探针：重命名一个未导出的局部标识符（语义不变），
 *    变红 = 误报（false positive）。
 *
 * 基线先行：源文件未变异时读取方测试必须全绿；否则该源标记 baselineRed 并跳过。
 * 固定 seed，可重复；变异只在工作区文件上临时生效，每个探针后立即还原。
 *
 * 用法:
 *   node scripts/testing/source-text-probes.mjs --inventory <inventory.json> \
 *     --out <matrix.json> [--max-semantic 6] [--max-rename 3] [--filter <path-substr>]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRONTEND = path.join(REPO, 'frontend');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const inventoryPath = path.resolve(arg('inventory', 'scripts/testing/source-text-inventory.json'));
const outPath = path.resolve(arg('out', 'scripts/testing/probe-matrix.json'));
const MAX_SEMANTIC = Number(arg('max-semantic', 6));
const MAX_RENAME = Number(arg('max-rename', 3));
const FILTER = arg('filter', '');
const SEED = 827;

// mulberry32 — 固定 seed 的确定性采样
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- 从 inventory 构建 source → reading test files ----------
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const sourceMap = new Map(); // absSourcePath -> { rel, testFiles:Set<rel-to-frontend>, kinds:Set }
for (const f of inventory.files) {
  const testDir = path.join(REPO, path.dirname(f.testFile));
  for (const s of f.sources) {
    if (!s.sourcePath || s.sourcePath === '(dynamic)') continue;
    const abs = path.resolve(testDir, s.sourcePath);
    if (!fs.existsSync(abs)) continue;
    if (/\.(json)$/.test(abs)) continue; // 数据契约/产物读取不在探针范围
    const relToFrontend = path.relative(FRONTEND, abs).replaceAll('\\', '/');
    if (!sourceMap.has(abs)) sourceMap.set(abs, { abs, rel: relToFrontend, testFiles: new Set() });
    for (const tc of f.cases) {
      if (tc.textAssertion && tc.usesVars.includes(s.varName)) {
        sourceMap.get(abs).testFiles.add(f.testFile);
      }
    }
    if (s.varName === undefined) sourceMap.get(abs).testFiles.add(f.testFile);
  }
}

const entries = [...sourceMap.values()]
  .filter((e) => e.testFiles.size > 0)
  .filter((e) => (FILTER ? e.rel.includes(FILTER) : true))
  .sort((a, b) => a.rel.localeCompare(b.rel));

console.error(`# probing ${entries.length} sources (filter=${FILTER || 'none'})`);

// ---------- 变异算子 ----------
const FLIPS = [
  [/===/g, '!=='], [/!==/g, '==='],
  [/(?<![<>=!])>(?![=>])/g, '>='], [/(?<![<>=!])<(?![=])/g, '<='],
];

/** 扫描出注释与字符串字面量的字符区间，变异点必须落在区间外才是真实语义位点。 */
function maskedRanges(text) {
  const ranges = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      ranges.push([i, end < 0 ? text.length : end]); i = ranges[ranges.length - 1][1] + 1;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      ranges.push([i, end < 0 ? text.length : end + 2]); i = ranges[ranges.length - 1][1] + 1;
    } else if (c === '<' && text[i + 1] === '!' && text.slice(i, i + 4) === '<!--') {
      const end = text.indexOf('-->', i + 4);
      ranges.push([i, end < 0 ? text.length : end + 3]); i = ranges[ranges.length - 1][1] + 1;
    } else if (c === "'" || c === '"' || c === '`') {
      const q = c; let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === '\\') { j++; continue; }
        if (text[j] === q) break;
        if (q !== '`' && text[j] === '\n') break;
      }
      ranges.push([i, Math.min(j + 1, text.length)]); i = j + 1;
    } else i++;
  }
  return ranges;
}
function inMasked(ranges, idx) {
  for (const [a, b] of ranges) if (idx >= a && idx < b) return true;
  return false;
}

function semanticSites(text) {
  const ranges = maskedRanges(text);
  const sites = [];
  for (const [re, rep] of FLIPS) {
    let m;
    while ((m = re.exec(text))) {
      if (inMasked(ranges, m.index)) continue;
      sites.push({ op: 'FLIP_CMP', index: m.index, len: m[0].length, to: rep });
    }
  }
  let m;
  const numRe = /\b(0x[0-9a-fA-F]+|\d+\.\d+|\d+)\b/g;
  while ((m = numRe.exec(text))) {
    if (inMasked(ranges, m.index)) continue;
    sites.push({ op: 'NUM_OFF', index: m.index, len: m[0].length, to: null });
  }
  // 去重相邻重叠
  return sites.filter((s, i, a) => a.findIndex((x) => x.op === s.op && Math.abs(x.index - s.index) < 2) === i);
}

function applySemantic(text, site) {
  if (site.op === 'FLIP_CMP') return text.slice(0, site.index) + site.to + text.slice(site.index + site.len);
  // NUM_OFF：数字 ±1，避免把小数破坏成另一个数量级
  const raw = text.slice(site.index, site.index + site.len);
  if (/^0x/i.test(raw)) return text; // 跳过十六进制（语义可能等价）
  const n = Number(raw);
  if (!Number.isFinite(n)) return text;
  const mutated = String(n === 0 ? 1 : n + 1);
  return text.slice(0, site.index) + mutated + text.slice(site.index + site.len);
}

function renameTargets(text) {
  const targets = [];
  const re = /\b(?:function|class)\s+([A-Za-z_$][\w$]*)|\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1] || m[2];
    if (name.length < 4) continue;
    // 跳过导出符号（重命名导出会破坏 importer，不是等价重命名）
    const prefix = text.slice(Math.max(0, m.index - 8), m.index);
    if (/\bexport\b/.test(prefix)) continue;
    if (/^(useState|useRef|useMemo)$/.test(name)) continue;
    targets.push(name);
  }
  return [...new Set(targets)];
}

function applyRename(text, name) {
  const re = new RegExp(`\\b${name}\\b`, 'g');
  return text.replace(re, `${name}__r`);
}

// ---------- vitest 执行 ----------
const tmpOut = path.join(REPO, 'scripts', 'testing', '.probe-last-run.json');
function runVitest(testFilesRel) {
  const files = [...testFilesRel].map((f) => f.replace(/^frontend\//, ''));
  if (fs.existsSync(tmpOut)) fs.rmSync(tmpOut);
  let status = 0;
  try {
    execFileSync('pnpm', ['exec', 'vitest', 'run', ...files, '--reporter=json', `--outputFile=${tmpOut}`], {
      cwd: FRONTEND,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300000,
      shell: process.platform === 'win32',
    });
  } catch (e) {
    status = e.status ?? 1;
  }
  const failed = [];
  if (fs.existsSync(tmpOut)) {
    try {
      const j = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
      for (const tr of j.testResults || []) {
        for (const ar of tr.assertionResults || []) {
          if (ar.status === 'failed') failed.push(ar.fullName?.slice(0, 160) || ar.title?.slice(0, 160) || '(unknown)');
        }
      }
    } catch { /* json 缺失时仅用 exit code */ }
  }
  return { red: status !== 0, failed };
}

// ---------- 主循环 ----------
const matrix = { seed: SEED, generatedAt: new Date().toISOString().slice(0, 10), maxSemantic: MAX_SEMANTIC, maxRename: MAX_RENAME, sources: [] };
function saveMatrix() {
  fs.writeFileSync(outPath, JSON.stringify(matrix, null, 2));
}
// 逐源增量落盘：单源异常不丢已完成的矩阵
process.on('uncaughtException', (err) => {
  console.error(`# CRASH ${err.stack}`);
  saveMatrix();
  process.exit(1);
});
for (const e of entries) {
  const original = fs.readFileSync(e.abs, 'utf8');
  const t0 = Date.now();
  const baseline = runVitest(e.testFiles);
  if (baseline.red) {
    matrix.sources.push({ source: e.rel, testFiles: [...e.testFiles], baselineRed: true, baselineFailed: baseline.failed, semantic: [], rename: [] });
    console.error(`# SKIP ${e.rel} baseline red (${baseline.failed.length} failed)`);
    continue;
  }

  const semantic = [];
  // .css/.vue：比较符翻转与 `<` 在模板/CSS 里不是语义位点（会变成编译破坏，虚增捕获率），只做数值偏移
  const markupLike = /\.(css|vue|html)$/.test(e.abs);
  let semSites = shuffle(semanticSites(original));
  if (markupLike) semSites = semSites.filter((s) => s.op === 'NUM_OFF');
  semSites = semSites.slice(0, MAX_SEMANTIC);
  for (const [i, site] of semSites.entries()) {
    const mutated = applySemantic(original, site);
    if (mutated === original) continue;
    fs.writeFileSync(e.abs, mutated);
    const r = runVitest(e.testFiles);
    semantic.push({ id: `sem-${i}`, op: site.op, index: site.index, killed: r.red, failedTests: r.failed.slice(0, 5) });
    fs.writeFileSync(e.abs, original);
  }

  const rename = [];
  // .vue：脚本标识符也被模板引用，整词重命名会破坏绑定而非等价，跳过（FP 指标不纳入）
  const renTargets = e.abs.endsWith('.vue')
    ? []
    : shuffle(renameTargets(original)).slice(0, MAX_RENAME);
  for (const [i, name] of renTargets.entries()) {
    fs.writeFileSync(e.abs, applyRename(original, name));
    const r = runVitest(e.testFiles);
    rename.push({ id: `ren-${i}`, name, falsePositive: r.red, failedTests: r.failed.slice(0, 5) });
    fs.writeFileSync(e.abs, original);
  }

  const killed = semantic.filter((p) => p.killed).length;
  const fps = rename.filter((p) => p.falsePositive).length;
  matrix.sources.push({ source: e.rel, testFiles: [...e.testFiles], baselineRed: false, semantic, rename, semanticKilled: killed, semanticTotal: semantic.length, renameFalsePositives: fps, renameTotal: rename.length, ms: Date.now() - t0 });
  console.error(`# ${e.rel} sem ${killed}/${semantic.length} rename-fp ${fps}/${rename.length}`);
  saveMatrix();
}

saveMatrix();
const tot = matrix.sources.filter((s) => !s.baselineRed);
const semK = tot.reduce((a, s) => a + s.semanticKilled, 0);
const semT = tot.reduce((a, s) => a + s.semanticTotal, 0);
const renFp = tot.reduce((a, s) => a + s.renameFalsePositives, 0);
const renT = tot.reduce((a, s) => a + s.renameTotal, 0);
console.error(`# SUMMARY semantic ${semK}/${semT} (${semT ? ((100 * semK) / semT).toFixed(1) : 0}%) rename-fp ${renFp}/${renT} (${renT ? ((100 * renFp) / renT).toFixed(1) : 0}%)`);
