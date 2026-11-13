#!/usr/bin/env node
/**
 * Issue #827 Step 0 — 源码文本断言测试分类器。
 *
 * 扫描 frontend/src 下所有 *.test.* 文件，找出读取生产源码（readFileSync）
 * 的测试文件，按测试用例粒度分类哪些用例的断言实际依赖源码文本，
 * 输出 JSON 清单（含 测试文件 → 被读源文件 的映射，供探针脚本反向消费）。
 *
 * 用法: node scripts/testing/classify-source-text-tests.mjs [--out <file.json>]
 *
 * 诚实降级说明：本脚本用结构化扫描（用例切块 + 词法引用判定），
 * 不是完整 AST 解析；判定结果是「用例体引用了源码文本变量」，
 * 供人工逐例复核，不单独作为架构判决。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FRONTEND_SRC = path.join(REPO, 'frontend', 'src');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : null;

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (/\.test\.(js|ts|mjs)$/.test(entry.name)) acc.push(p);
  }
  return acc;
}

/** 从读取参数里提取源码目标路径（new URL 形态优先，其次最后一个带源码扩展名的字面量）。 */
function extractTarget(arg) {
  const url = arg.match(/new URL\(\s*['"]([^'"]+)['"]/);
  if (url) return url[1];
  const lits = [...arg.matchAll(/['"]([^'"]+\.(?:js|ts|mjs|css|vue))['"]/g)];
  return lits.length ? lits[lits.length - 1][1] : null;
}

/**
 * 找出测试文件里读取生产源码的 readFileSync 及其接收变量名。
 * 覆盖四种仓内形态：
 * 1) const X = readFileSync(new URL('./a.ts', import.meta.url), 'utf8')
 * 2) const X = fs.readFileSync(new URL('./a.ts', import.meta.url), 'utf8')（用例体内联）
 * 3) const X = strip(readFileSync(resolve(here, 'a.js'), 'utf8'))
 * 4) helper：const read = (rel) => readFileSync(...)，调用点 const X = read('./a.css')
 */
function findSourceReaders(text) {
  const readers = [];
  const helpers = [];
  for (const line of text.split('\n')) {
    const hm =
      line.match(/(?:const|let|var)\s+(\w[\w$]*)\s*=\s*(?:\(([^)]*)\)|\w[\w$]*)\s*=>\s*(.*)$/) ||
      line.match(/function\s+(\w[\w$]*)\s*\(([^)]*)\)/);
    if (hm && /readFileSync/.test(line)) helpers.push({ name: hm[1], param: hm[2] || '' });
  }
  const helperNames = helpers.map((h) => h.name);
  for (const line of text.split('\n')) {
    const m = line.match(/(?:const|let|var)\s+(\w[\w$]*)\s*=\s*(.*?);?\s*$/);
    if (!m) continue;
    const [, name, init] = m;
    if (!/readFileSync/.test(init)) continue;
    if (helperNames.some((h) => h === name)) continue;
    // 一行可能拼接多个 new URL(...) 源（如 armorCollisionPack.test.js:715-718）
    const urlTargets = [...init.matchAll(/new URL\(\s*['"]([^'"]+)['"]/g)].map((u) => u[1]);
    if (urlTargets.length > 1) {
      for (const t of urlTargets) readers.push({ varName: name, sourcePath: t, kind: 'direct' });
      continue;
    }
    const target = extractTarget(init);
    readers.push({ varName: name, sourcePath: target || '(dynamic)', kind: target ? 'direct' : 'dynamic-inline' });
  }
  if (helperNames.length) {
    const callRe = new RegExp(
      `(?:const|let|var)\\s+(\\w[\\w$]*)\\s*=\\s*(?:${helperNames.map((h) => `${h}\\b`).join('|')})\\s*\\(([^;\\n]*)\\)`,
      'g',
    );
    for (const m of text.matchAll(callRe)) {
      const target = extractTarget(m[2]);
      readers.push({ varName: m[1], sourcePath: target || '(dynamic)', kind: 'helper-call' });
    }
    // 未赋值的 helper 内联调用（如 agent-theme-css 直接 read(dir + f)）也计数
    if (readers.length === 0) {
      readers.push({ varName: helperNames[0], sourcePath: '(dynamic)', kind: 'helper-dynamic' });
    }
  }
  return readers;
}

/** 把测试文件切成用例块：it/test（含 .each）+ 用例名 + 花括号配对体。 */
function sliceCases(text) {
  const cases = [];
  const re = /(?:^|\n)(\s*)(it|test)(\.each(?:\s*\([^)]*\))?)?\s*\(\s*(['"`])([\s\S]*?)\4/g;
  let m;
  while ((m = re.exec(text))) {
    const bodyStart = text.indexOf('(', m.index + m[0].length - 1);
    if (bodyStart < 0) continue;
    // 从用例名结束处向后扫描到回调体首个 '{'（中间隔着 `, () =>` 等结构）
    let i = text.indexOf(m[4], m.index) + 1;
    i = text.indexOf(m[4], i) + m[4].length;
    let depth = 0, start = -1, end = -1;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "'" || c === '"' || c === '`') {
        const q = c; i++;
        for (; i < text.length; i++) {
          if (text[i] === '\\') { i++; continue; }
          if (text[i] === q) break;
        }
        continue;
      }
      if (c === '{') { start = i; break; }
    }
    if (start < 0) { cases.push({ name: m[5], start: m.index, body: '' }); continue; }
    depth = 0; end = start;
    for (i = start; i < text.length; i++) {
      const c = text[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
      else if (c === "'" || c === '"' || c === '`') { // 跳过字符串
        const q = c; i++;
        for (; i < text.length; i++) {
          if (text[i] === '\\') { i++; continue; }
          if (text[i] === q) break;
        }
      }
    }
    cases.push({ name: m[5], start: m.index, body: text.slice(start, end + 1) });
  }
  return cases;
}

function classifyFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const readers = findSourceReaders(text);
  if (!readers.length) return null;
  const relFile = path.relative(REPO, file).replaceAll('\\', '/');
  const varNames = readers.map((r) => r.varName);
  // case 起始行号（台账稳定 ID 用）
  const lineOf = (idx) => text.slice(0, idx).split('\n').length;
  const cases = sliceCases(text).map((c) => {
    const body = c.body;
    const usedVars = varNames.filter((v) => new RegExp(`\\b${v}\\b`).test(body));
    const patterns = [];
    if (usedVars.length) {
      if (/\.toMatch\(/.test(body)) patterns.push('toMatch');
      if (/\.indexOf\(/.test(body)) patterns.push('indexOf');
      if (/\.includes\(/.test(body)) patterns.push('includes');
      if (/\.slice\(/.test(body)) patterns.push('slice');
      if (/new Function\(/.test(body)) patterns.push('newFunction');
      if (/new RegExp\(/.test(body)) patterns.push('newRegExp');
      if (/\beval\b/.test(body)) patterns.push('eval');
    }
    const isTextAssertion = usedVars.length > 0 && patterns.length > 0;
    return {
      id: `${path.basename(file).replace(/\.test\.(js|ts|mjs)$/, '')}:${lineOf(c.start)}`,
      name: c.name,
      startLine: lineOf(c.start),
      textAssertion: isTextAssertion,
      usesVars: usedVars,
      patterns,
    };
  });
  return {
    testFile: relFile,
    sources: readers.map((r) => ({
      sourcePath: r.sourcePath,
      varName: r.varName,
      targetArg: r.targetArg,
    })),
    caseCount: cases.length,
    textAssertionCases: cases.filter((c) => c.textAssertion).length,
    cases,
  };
}

const testFiles = walk(FRONTEND_SRC);
const results = [];
for (const f of testFiles) {
  const r = classifyFile(f);
  if (r) results.push(r);
}

const summary = {
  generatedAt: new Date().toISOString().slice(0, 10),
  scannedTestFiles: testFiles.length,
  sourceReadingTestFiles: results.length,
  totalCases: results.reduce((a, r) => a + r.caseCount, 0),
  totalTextAssertionCases: results.reduce((a, r) => a + r.textAssertionCases, 0),
  files: results,
};

const json = JSON.stringify(summary, null, 2);
if (outFile) fs.writeFileSync(outFile, json);
else console.log(json);
console.error(
  `# scanned=${summary.scannedTestFiles} sourceReadingFiles=${summary.sourceReadingTestFiles} ` +
    `cases=${summary.totalCases} textAssertionCases=${summary.totalTextAssertionCases}`,
);
