#!/usr/bin/env node
/**
 * Issue #827 Step 0 — 源码文本断言效力探针。
 *
 * 对每个「生产源文件 → 读取它的测试文件集合」执行：
 *  - 语义变异探针：翻转比较运算符 / 数值字面量偏移（真实语义变更），
 *    跑读取方测试，变红 = 捕获（killed）。
 *  - 等价重命名探针：按 **AST 绑定身份** 重命名一个未导出的局部标识符
 *    （语义不变；不再做整文件词替换——那会改 import 关键字、对象键、
 *    字符串和对外导出名），变红 = 误报（false positive）。
 *
 * 诚实分类（#827 复测 review P2）：
 *  - 变异后源码先过解析校验；解析失败 = invalid，不计入捕获率；
 *  - vitest 退出码非零但没有任何断言失败（转换/收集错误、超时、基础设施
 *    异常）= invalid/inconclusive，不计入捕获率；
 *  - 只有真实断言失败才算 killed。
 *
 * 基线先行：源文件未变异时读取方测试必须全绿；否则该源标记 baselineRed 并跳过。
 * 固定 seed，可重复；变异只在工作区文件上临时生效，每个探针后立即还原。
 *
 * 用法:
 *   node scripts/testing/source-text-probes.mjs --inventory <inventory.json> \
 *     --out <matrix.json> [--max-semantic 6] [--max-rename 3] [--filter <path-substr>]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRONTEND = path.join(REPO, 'frontend');
const requireFromFrontend = createRequire(path.join(FRONTEND, 'package.json'));
let ts = null;
try { ts = requireFromFrontend('typescript'); } catch { ts = null; }
let vueSfc = null;
try { vueSfc = requireFromFrontend('vue/compiler-sfc'); } catch { vueSfc = null; }

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

// ---------- 解析校验（变异是否仍是一份可解析的程序） ----------
function scriptKindFor(file) {
  if (!ts) return null;
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.ts$/.test(file)) return ts.ScriptKind.TS;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

/** 返回解析诊断文本数组；`null` = 当前环境无法校验（不据此判 invalid）。 */
function parseIssues(text, file) {
  if (/\.(css|html)$/.test(file)) return [];        // 探针只做数值偏移；无廉价解析器
  if (/\.vue$/.test(file)) {
    if (!vueSfc || typeof vueSfc.parse !== 'function') return null;
    try {
      const { errors } = vueSfc.parse(text, { filename: file });
      return (errors || []).map((e) => String(e));
    } catch (e) { return [String(e)]; }
  }
  if (!ts) return null;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  return (sf.parseDiagnostics || []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

// ---------- 等价重命名：AST 绑定身份，而不是整文件词替换 ----------
/**
 * 收集「可安全重命名的局部绑定」。安全条件（任一不满足即跳过该绑定）：
 *  - 声明未被 export（导出名是对外契约）；
 *  - 该绑定在文件中没有 shorthand property（`{ name }` 改名会改对象键）；
 *  - 该绑定没有被 `export { name }` 直接导出（改的会是导出名；`as` 别名可保留）；
 *  - 不选 import/export specifier 自身、属性名、关键字位置（AST 身份天然排除）；
 *  - 新名字不与文件内已有 `name__r` 标识符冲突。
 * 返回 [{ name, to, positions }]（positions 为声明 + 全部同 symbol 引用）。
 */
function bindingRenamePlans(text, file) {
  if (!ts || /\.vue$/.test(file)) return [];
  const options = {
    allowJs: true, checkJs: false, noResolve: true, skipLibCheck: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve,
  };
  let program;
  try { program = ts.createProgram([file], options); } catch { return []; }
  const sf = program.getSourceFile(file);
  if (!sf) return [];
  const checker = program.getTypeChecker();

  function hasExportModifier(node) {
    // 只看**声明所属语句**的修饰符：不能一路走到 SourceFile，否则「导出函数内部的
    // 局部 const」会继承外层函数的 export，整片局部绑定被误判为导出而全部跳过。
    let statement = node;
    if (ts.isVariableDeclaration(node)) {
      let n = node.parent;
      while (n && !ts.isVariableStatement(n) && !ts.isSourceFile(n)) n = n.parent;
      statement = n;
    }
    if (!statement || ts.isSourceFile(statement)) return false;
    const mods = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    return !!mods && mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword);
  }
  /** 该位置不是「绑定引用」：属性名 / 方法名 / 属性键 / shorthand 键 / JSX 属性名 / import/export 名。 */
  function isNonBindingPosition(node) {
    const p = node.parent;
    if (!p) return true;
    if ((ts.isPropertyAccessExpression(p) || ts.isQualifiedName(p)) && p.name === node) return true;
    if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)
      || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p)) && p.name === node) return true;
    if (ts.isShorthandPropertyAssignment(p) && p.name === node) return true;
    if (ts.isJsxAttribute(p) && p.name === node) return true;
    if (ts.isBindingElement(p) && p.propertyName === node) return true;
    if (ts.isImportSpecifier(p) && p.name === node) return true;
    if (ts.isImportClause(p) && p.name === node) return true;
    if (ts.isNamespaceImport(p) || ts.isNamespaceExport(p)) return true;
    return false;
  }

  const candidates = [];
  function collect(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (!hasExportModifier(node)) candidates.push(node.name);
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
      if (!hasExportModifier(node)) candidates.push(node.name);
    }
    ts.forEachChild(node, collect);
  }
  collect(sf);

  const plans = [];
  const seen = new Set();
  for (const nameNode of candidates) {
    const name = nameNode.text;
    if (name.length < 4 || seen.has(name)) continue;
    if (/^(useState|useRef|useMemo)$/.test(name)) continue;
    seen.add(name);
    if (text.includes(`${name}__r`)) continue;            // 新名冲突 → fail-closed
    const symbol = checker.getSymbolAtLocation(nameNode);
    if (!symbol) continue;
    const positions = [];
    let disqualified = null;
    function walk(node) {
      if (disqualified) return;
      if (ts.isIdentifier(node) && node.text === name) {
        const p = node.parent;
        if (ts.isShorthandPropertyAssignment(p) && p.name === node) {
          // shorthand 的 checker symbol 是属性符号，不是变量绑定：必须在 symbol 相等判断之前
          // 用 value symbol 解析。解析不到也 fail-closed（改名会让 `{ name }` 读不到变量）。
          const value = typeof checker.getShorthandAssignmentValueSymbol === 'function'
            ? checker.getShorthandAssignmentValueSymbol(p)
            : undefined;
          if (value === symbol || value === undefined) { disqualified = 'shorthand-property'; return; }
        } else if (ts.isExportSpecifier(p)) {
          const local = p.propertyName ?? p.name;
          if (local === node) {
            // 无别名 export 的 symbol 是别名符号：解析 local target 后再判断。
            const resolved = typeof checker.getExportSpecifierLocalTargetSymbol === 'function'
              ? checker.getExportSpecifierLocalTargetSymbol(p)
              : undefined;
            if (p.propertyName == null) {
              // 解析不到时保守跳过：宁可少探针，也不能把破坏程序的重命名算作等价。
              if (resolved === symbol || resolved === undefined) { disqualified = 'export-name'; return; }
            } else if (resolved === symbol) {
              // `export { local as publicName }`：改 local 不改对外名，安全。
              positions.push({ pos: node.getStart(sf), len: node.getText(sf).length });
            }
          }
        } else if (checker.getSymbolAtLocation(node) === symbol && !isNonBindingPosition(node)) {
          positions.push({ pos: node.getStart(sf), len: node.getText(sf).length });
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(sf);
    if (!disqualified && positions.length) plans.push({ name, to: `${name}__r`, positions });
  }
  return plans;
}

function applyRename(text, plan) {
  let out = text;
  for (const { pos, len } of [...plan.positions].sort((a, b) => b.pos - a.pos)) {
    out = out.slice(0, pos) + plan.to + out.slice(pos + len);
  }
  return out;
}

/** 自检 / 负面控制：整文件词替换会把 `import ... from` 改坏，AST 绑定重命名必须只改局部变量；
 *  另含 shorthand / 无别名 export / 有别名 export 三个独立反例（review P2）。 */
function renameSelfCheck() {
  if (!ts) return { ok: false, reason: 'typescript unavailable' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wotb-probe-selfcheck-'));
  const file = path.join(dir, 'sample.js');
  const sample = [
    "import * as THREE from 'three'",
    'const from = THREE.x',
    'export function use() { return from }',
    'const localName = 1',
    'console.log({ localName })',
    'const exportedName = 2',
    'export { exportedName }',
    'const aliasedName = 3',
    'export { aliasedName as publicName }',
    '',
  ].join('\n');
  try {
    fs.writeFileSync(file, sample);
    const plans = bindingRenamePlans(sample, file);
    const plan = plans.find((p) => p.name === 'from');
    if (!plan) return { ok: false, reason: 'from binding not discovered' };
    const renamed = applyRename(sample, plan);
    const naive = sample.replace(/\bfrom\b/g, 'from__r');
    const naiveIssues = parseIssues(naive, file);
    const renamedIssues = parseIssues(renamed, file);
    // shorthand 与无别名 export 必须整条跳过：只改声明会让 `{ localName }` / export 失效。
    const shorthandPlan = plans.find((p) => p.name === 'localName');
    const unaliasedExportPlan = plans.find((p) => p.name === 'exportedName');
    // 有别名 export 可以安全重命名 local（对外名 publicName 不变）。
    const aliasedPlan = plans.find((p) => p.name === 'aliasedName');
    const aliasedRenamed = aliasedPlan ? applyRename(sample, aliasedPlan) : '';
    const ok = renamed.includes("import * as THREE from 'three'")
      && renamed.includes('const from__r = THREE.x')
      && renamed.includes('return from__r')
      && renamedIssues.length === 0
      && (naiveIssues === null || naiveIssues.length > 0 || naive.includes("from__r 'three'"))
      && !shorthandPlan
      && !unaliasedExportPlan
      && !!aliasedPlan
      && aliasedRenamed.includes('const aliasedName__r = 3')
      && aliasedRenamed.includes('export { aliasedName__r as publicName }')
      && (parseIssues(aliasedRenamed, file) || []).length === 0;
    return {
      ok,
      negativeControl: {
        wholeFileReplace: naive,
        parseIssues: naiveIssues,
        bindingRename: renamed,
        bindingRenameParseIssues: renamedIssues,
      },
      bindingSafety: {
        shorthandSkipped: !shorthandPlan,
        unaliasedExportSkipped: !unaliasedExportPlan,
        aliasedExportRenamed: aliasedRenamed,
      },
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- vitest 执行 ----------
// vitest JSON 报告写到系统临时目录：这是运行期草稿，不属于仓库内容。
const tmpOut = path.join(os.tmpdir(), 'wotb-probe-last-run.json');
function runVitest(testFilesRel) {
  const files = [...testFilesRel].map((f) => f.replace(/^frontend\//, ''));
  if (fs.existsSync(tmpOut)) fs.rmSync(tmpOut);
  let status = 0;
  let timedOut = false;
  try {
    execFileSync('pnpm', ['exec', 'vitest', 'run', ...files, '--reporter=json', `--outputFile=${tmpOut}`], {
      cwd: FRONTEND,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300000,
      shell: process.platform === 'win32',
    });
  } catch (e) {
    status = e.status ?? 1;
    timedOut = !!(e.signal || e.killed || e.code === 'ETIMEDOUT');
  }
  let report = null;
  if (fs.existsSync(tmpOut)) {
    try { report = JSON.parse(fs.readFileSync(tmpOut, 'utf8')); } catch { report = null; }
  }
  const failed = [];
  let assertionFailures = 0;
  let suiteErrors = 0;
  if (report) {
    for (const tr of report.testResults || []) {
      const assertionResults = tr.assertionResults || [];
      for (const ar of assertionResults) {
        if (ar.status === 'failed') {
          assertionFailures++;
          failed.push(ar.fullName?.slice(0, 160) || ar.title?.slice(0, 160) || '(unknown)');
        }
      }
      if (tr.status === 'failed' && !assertionResults.some((a) => a.status === 'failed')) suiteErrors++;
    }
    if (typeof report.numFailedTests === 'number' && report.numFailedTests > assertionFailures) {
      assertionFailures = report.numFailedTests;
    }
  }
  const red = status !== 0;
  const killed = assertionFailures > 0;                        // 真正的断言失败
  const invalid = !killed && red && !timedOut && (suiteErrors > 0 || !report);   // 变异本身编译/收集失败
  const inconclusive = !killed && !invalid && red;              // 其余非零退出：超时/基础设施异常，不计 killed
  return { red, killed, failed, timedOut, suiteErrors, invalid, inconclusive, status };
}

// ---------- 主循环 ----------
const matrix = {
  seed: SEED, generatedAt: new Date().toISOString().slice(0, 10),
  maxSemantic: MAX_SEMANTIC, maxRename: MAX_RENAME,
  selfCheck: renameSelfCheck(),
  sources: [],
};
function saveMatrix() {
  fs.writeFileSync(outPath, JSON.stringify(matrix, null, 2));
}
if (!matrix.selfCheck.ok) console.error(`# SELF-CHECK FAILED ${JSON.stringify(matrix.selfCheck)}`);
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
    matrix.sources.push({
      source: e.rel, testFiles: [...e.testFiles], baselineRed: true,
      baselineInconclusive: baseline.red && !baseline.killed,
      baselineFailed: baseline.failed, semantic: [], rename: [],
    });
    console.error(`# SKIP ${e.rel} baseline red (${baseline.failed.length} assertion failures)`);
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
    const parse = parseIssues(mutated, e.abs);
    if (parse && parse.length) {
      semantic.push({
        id: `sem-${i}`, op: site.op, index: site.index,
        killed: false, invalid: true, reason: 'parse-error', parseIssues: parse.slice(0, 3), failedTests: [],
      });
      continue;
    }
    fs.writeFileSync(e.abs, mutated);
    const r = runVitest(e.testFiles);
    semantic.push({
      id: `sem-${i}`, op: site.op, index: site.index,
      killed: r.killed,
      ...(r.killed ? {} : r.timedOut ? { inconclusive: true, reason: 'timeout' } : {}),
      ...(!r.killed && !r.timedOut && r.invalid ? { invalid: true, reason: 'run-invalid' } : {}),
      ...(!r.killed && !r.timedOut && r.inconclusive ? { inconclusive: true, reason: 'run-inconclusive' } : {}),
      failedTests: r.failed.slice(0, 5),
    });
    fs.writeFileSync(e.abs, original);
  }

  const rename = [];
  // .vue：脚本标识符也被模板引用；模板引用不在同一 AST，重命名必须同时改模板，跳过（FP 指标不纳入）
  const renPlans = e.abs.endsWith('.vue')
    ? []
    : shuffle(bindingRenamePlans(original, e.abs)).slice(0, MAX_RENAME);
  for (const [i, plan] of renPlans.entries()) {
    const renamed = applyRename(original, plan);
    const parse = parseIssues(renamed, e.abs);
    if (parse && parse.length) {
      rename.push({ id: `ren-${i}`, name: plan.name, falsePositive: false, invalid: true, reason: 'parse-error', parseIssues: parse.slice(0, 3), failedTests: [] });
      continue;
    }
    fs.writeFileSync(e.abs, renamed);
    const r = runVitest(e.testFiles);
    rename.push({
      id: `ren-${i}`, name: plan.name,
      falsePositive: r.killed,
      ...(r.killed ? {} : r.timedOut ? { inconclusive: true, reason: 'timeout' } : {}),
      ...(!r.killed && !r.timedOut && r.invalid ? { invalid: true, reason: 'run-invalid' } : {}),
      failedTests: r.failed.slice(0, 5),
    });
    fs.writeFileSync(e.abs, original);
  }

  const killed = semantic.filter((p) => p.killed).length;
  const semanticInvalid = semantic.filter((p) => p.invalid).length;
  const semanticInconclusive = semantic.filter((p) => p.inconclusive).length;
  const fps = rename.filter((p) => p.falsePositive).length;
  const renameInvalid = rename.filter((p) => p.invalid).length;
  matrix.sources.push({
    source: e.rel, testFiles: [...e.testFiles], baselineRed: false,
    semantic, rename,
    semanticKilled: killed,
    semanticTotal: semantic.length - semanticInvalid - semanticInconclusive,
    semanticInvalid,
    semanticInconclusive,
    renameFalsePositives: fps,
    renameTotal: rename.filter((p) => !p.invalid && !p.inconclusive).length,
    renameInvalid,
    ms: Date.now() - t0,
  });
  console.error(`# ${e.rel} sem ${killed}/${semantic.length - semanticInvalid - semanticInconclusive} (invalid ${semanticInvalid}, inconclusive ${semanticInconclusive}) rename-fp ${fps}/${rename.filter((p) => !p.invalid && !p.inconclusive).length}`);
  saveMatrix();
}

saveMatrix();
const tot = matrix.sources.filter((s) => !s.baselineRed);
const semK = tot.reduce((a, s) => a + s.semanticKilled, 0);
const semT = tot.reduce((a, s) => a + s.semanticTotal, 0);
const semI = tot.reduce((a, s) => a + s.semanticInvalid, 0);
const semC = tot.reduce((a, s) => a + s.semanticInconclusive, 0);
const renFp = tot.reduce((a, s) => a + s.renameFalsePositives, 0);
const renT = tot.reduce((a, s) => a + s.renameTotal, 0);
console.error(`# SUMMARY semantic ${semK}/${semT} (${semT ? ((100 * semK) / semT).toFixed(1) : 0}%; invalid ${semI}, inconclusive ${semC}) rename-fp ${renFp}/${renT} (${renT ? ((100 * renFp) / renT).toFixed(1) : 0}%)`);
