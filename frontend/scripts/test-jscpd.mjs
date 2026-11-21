import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runJscpd } from 'jscpd';

const root = await mkdtemp(path.join(tmpdir(), 'wotb-jscpd-'));
const baselineRoot = path.join(root, 'baseline-fixture');
const reportDir = path.join(root, 'report');
const sources = {
  java: ['.java', 'class Probe {\n  int add(int left, int right) {\n    int total = left + right;\n    if (total > 10) {\n      return total * 2;\n    }\n    return total - 1;\n  }\n}\n'],
  javascript: ['.js', 'function add(left, right) {\n  const total = left + right;\n  if (total > 10) {\n    return total * 2;\n  }\n  return total - 1;\n}\n'],
  typescript: ['.ts', 'function add(left: number, right: number): number {\n  const total = left + right;\n  if (total > 10) {\n    return total * 2;\n  }\n  return total - 1;\n}\n'],
  vue: ['.vue', '<script setup lang="ts">\nfunction add(left: number, right: number): number {\n  const total = left + right;\n  if (total > 10) {\n    return total * 2;\n  }\n  return total - 1;\n}\n</script>\n<template><div /></template>\n'],
  kotlin: ['.kt', 'fun add(left: Int, right: Int): Int {\n  val total = left + right\n  if (total > 10) {\n    return total * 2\n  }\n  return total - 1\n}\n'],
  python: ['.py', 'def calculate(left, right):\n    subtotal = left + right\n    scaled = subtotal * 2\n    adjusted = scaled - 3\n    if subtotal > 10:\n        chosen = adjusted + left\n    else:\n        chosen = adjusted - right\n    result = chosen * 2\n    if result > 0:\n        return result\n    return -result\n']
};

function run(args) {
  const result = runJscpd(args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, result.stderr);
  return result;
}

try {
  for (const [language, [extension, source]] of Object.entries(sources)) {
    const folder = path.join(root, 'production', language);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'a' + extension), source);
    await writeFile(path.join(folder, 'b' + extension), source);
  }

  const testFolder = path.join(root, 'tests');
  await mkdir(testFolder, { recursive: true });
  await writeFile(path.join(testFolder, 'one.test.js'), sources.javascript[1]);
  await writeFile(path.join(testFolder, 'two.test.js'), sources.javascript[1]);

  for (const category of ['generated', 'vendor']) {
    const folder = path.join(root, category);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'a.js'), sources.javascript[1]);
    await writeFile(path.join(folder, 'b.js'), sources.javascript[1]);
  }

  const distinctFolder = path.join(root, 'production', 'javascript');
  await writeFile(path.join(distinctFolder, 'adult.js'), 'function isAdult(age) {\n  if (age >= 18) {\n    return true;\n  }\n  return false;\n}\n');
  await writeFile(path.join(distinctFolder, 'minor.js'), 'function isMinor(age) {\n  if (age <= 17) {\n    return true;\n  }\n  return false;\n}\n');

  for (const [language, [extension]] of Object.entries(sources)) {
    const paths = [path.join(root, 'production', language)];
    if (language === 'javascript') paths.push(testFolder);
    const result = run([
      ...paths, '--min-lines', '5', '--min-tokens', '20', '--reporters', 'json',
      '--output', reportDir, '--report-name', language, '--fail-on-empty', '--exit-code', '7', '--no-tips'
    ]);
    assert.equal(result.status, 7, 'Expected duplicate exit code for ' + language);
    const report = JSON.parse(await readFile(path.join(reportDir, language + '.json'), 'utf8'));
    assert(report.duplicates.some((clone) => clone.firstFile.name.split(':')[0].endsWith('a' + extension) && clone.secondFile.name.split(':')[0].endsWith('b' + extension)),
      'Expected a clone pair for ' + language + ': ' + JSON.stringify(report.duplicates.map((clone) => [clone.firstFile.name, clone.secondFile.name, clone.format])));
    if (language === 'javascript') {
      assert(report.duplicates.some((clone) => /[\\\\/]tests[\\\\/]|[.]test[.]/.test(clone.firstFile.name) || /[\\\\/]tests[\\\\/]|[.]test[.]/.test(clone.secondFile.name)),
        'Expected test code to remain visible for separate review classification');
      assert(!report.duplicates.some((clone) => /adult\.js/.test(clone.firstFile.name + ' ' + clone.secondFile.name) && /minor\.js/.test(clone.firstFile.name + ' ' + clone.secondFile.name)),
        'Different-behavior examples must not become exact clones');
    }
  }

  const all = run([
    root, '--min-lines', '5', '--min-tokens', '20', '--ignore', '**/generated/**,**/vendor/**',
    '--reporters', 'json', '--output', reportDir, '--report-name', 'exclusions', '--fail-on-empty', '--no-tips'
  ]);
  assert.equal(all.status, 0, 'Duplicate findings alone must not set the scan exit code');
  const allReport = JSON.parse(await readFile(path.join(reportDir, 'exclusions.json'), 'utf8'));
  assert(!allReport.duplicates.some((clone) => /[\\/]generated[\\/]|[\\/]vendor[\\/]/.test(clone.firstFile.name + ' ' + clone.secondFile.name)),
    'Generated and vendor clones must be excluded');

  const empty = path.join(root, 'empty');
  await mkdir(empty);
  const emptyRun = run([empty, '--reporters', 'json', '--output', reportDir, '--report-name', 'empty', '--fail-on-empty', '--no-tips']);
  assert.equal(emptyRun.status, 1, 'An empty scan must fail rather than report zero duplication');
  assert.match(emptyRun.stdout + '\n' + emptyRun.stderr, /analyzed no files/i);

  // Exercise the actual pnpm script and baseline option using an isolated Git fixture.
  await mkdir(baselineRoot, { recursive: true });
  execFileSync('git', ['init', '--quiet', '--initial-branch=baseline'], { cwd: baselineRoot });
  execFileSync('git', ['config', 'user.email', 'jscpd-smoke@example.invalid'], { cwd: baselineRoot });
  execFileSync('git', ['config', 'user.name', 'jscpd smoke'], { cwd: baselineRoot });
  const fixtureFrontend = path.join(baselineRoot, 'frontend');
  const fixtureSources = path.join(baselineRoot, 'samples');
  await mkdir(fixtureFrontend);
  await mkdir(fixtureSources);
  const actualFrontend = path.resolve(import.meta.dirname, '..');
  const actualPackage = JSON.parse(await readFile(path.join(actualFrontend, 'package.json'), 'utf8'));
  const actualConfig = JSON.parse(await readFile(path.join(actualFrontend, '..', '.jscpd.json'), 'utf8'));
  await writeFile(path.join(fixtureFrontend, 'package.json'), JSON.stringify({ private: true, scripts: { 'review:duplicates': actualPackage.scripts['review:duplicates'] } }));
  await writeFile(path.join(baselineRoot, '.jscpd.json'), JSON.stringify({ ...actualConfig, path: ['samples'] }));
  await symlink(path.join(actualFrontend, 'node_modules'), path.join(fixtureFrontend, 'node_modules'), 'junction');
  const baselineSource = 'function calculateTotal(left, right) {\n  const sum = left + right;\n  const difference = left - right;\n  const factor = sum * 3;\n  const adjusted = factor - difference;\n  if (adjusted > 100) {\n    return adjusted + sum;\n  }\n  return adjusted - difference;\n}\n';
  const addedSource = 'function prepareOrder(order) {\n  const price = order.unitPrice * order.quantity;\n  const shipping = order.distance * order.rate;\n  const discount = order.discount + order.credit;\n  const subtotal = price + shipping - discount;\n  if (order.taxable) {\n    return subtotal * order.taxRate;\n  }\n  return subtotal + order.fee;\n}\n';
  await writeFile(path.join(fixtureSources, 'existing-a.js'), baselineSource);
  await writeFile(path.join(fixtureSources, 'existing-b.js'), baselineSource);
  execFileSync('git', ['add', '.jscpd.json', 'frontend/package.json', 'samples'], { cwd: baselineRoot });
  execFileSync('git', ['commit', '--quiet', '-m', 'baseline'], { cwd: baselineRoot });
  const forkPoint = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: baselineRoot, encoding: 'utf8' }).trim();
  // Main advances independently with a non-conflicting change; the candidate
  // remains on its fork branch, as in a valid but stale PR.
  execFileSync('git', ['switch', '--quiet', '-c', 'main'], { cwd: baselineRoot });
  await writeFile(path.join(fixtureSources, 'main-only.js'), 'export const mainOnly = true;\n');
  execFileSync('git', ['add', 'samples/main-only.js'], { cwd: baselineRoot });
  execFileSync('git', ['commit', '--quiet', '-m', 'main advances cleanly'], { cwd: baselineRoot });
  const advancedMain = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: baselineRoot, encoding: 'utf8' }).trim();
  execFileSync('git', ['switch', '--quiet', '-c', 'candidate', forkPoint], { cwd: baselineRoot });
  await writeFile(path.join(fixtureSources, 'added-a.js'), addedSource);
  await writeFile(path.join(fixtureSources, 'added-b.js'), addedSource);
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: baselineRoot, encoding: 'utf8' }).trim();
  const baseSha = advancedMain;
  const ancestorMergeBase = execFileSync('git', ['merge-base', forkPoint, headSha], { cwd: baselineRoot, encoding: 'utf8' }).trim();
  assert.equal(ancestorMergeBase, forkPoint, 'Stable main baseline must be an ancestor of candidate head');
  assert.notEqual(execFileSync('git', ['merge-base', baseSha, headSha], { cwd: baselineRoot, encoding: 'utf8' }).trim(), baseSha,
    'Advanced main must not be an ancestor of candidate head');
  const mergeBase = execFileSync('git', ['merge-base', baseSha, headSha], { cwd: baselineRoot, encoding: 'utf8' }).trim();
  assert.equal(mergeBase, forkPoint, 'Candidate baseline must be the PR fork-point');
  execFileSync('git', ['merge-tree', '--write-tree', baseSha, headSha], { cwd: baselineRoot, stdio: 'pipe' });
  const pnpmArgs = ['run', 'review:duplicates', '--baseline-from-ref', mergeBase];
  const pnpmRun = platform() === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm ' + pnpmArgs.map((arg) => /[\s"]/.test(String(arg)) ? '"' + String(arg).replaceAll('"', '\\"') + '"' : String(arg)).join(' ')], { cwd: fixtureFrontend, encoding: 'utf8', stdio: 'pipe' })
    : spawnSync('pnpm', pnpmArgs, { cwd: fixtureFrontend, encoding: 'utf8', stdio: 'pipe' });
  if (pnpmRun.error) throw pnpmRun.error;
  assert.equal(pnpmRun.status, 0, pnpmRun.stdout + '\n' + pnpmRun.stderr);
  assert.match(pnpmRun.stdout, /JSON report saved/i);
  const baselineReport = JSON.parse(await readFile(path.join(baselineRoot, 'tmp', 'jscpd', 'review-with-docs.json'), 'utf8'));
  execFileSync(process.execPath, [path.join(actualFrontend, 'scripts', 'validate-jscpd-report.mjs'), path.join(baselineRoot, 'tmp', 'jscpd', 'review-with-docs.json')], { stdio: 'pipe' });
  for (const [prefix, isNew] of [['existing', false], ['added', true]]) {
    const clone = baselineReport.duplicates.find(({ firstFile, secondFile }) => {
      const names = [path.basename(firstFile.name), path.basename(secondFile.name)].sort();
      return names[0] === `${prefix}-a.js` && names[1] === `${prefix}-b.js`;
    });
    assert(clone, `Expected ${prefix} clone pair in isolated report`);
    assert.equal(clone.isNew, isNew, `Incorrect baseline classification for ${prefix} clone`);
    assert(clone.tokens >= 50, `${prefix} clone must exceed configured token threshold`);
  }

  for (const [label, badArgs] of [
    ['missing baseline', ['run', 'review:duplicates', '--baseline-from-ref', 'refs/no-such-baseline']],
    ['invalid scan path', ['run', 'review:duplicates', 'samples/missing', '--reporters', 'json', '--output', path.join(root, 'failed-scan')]]
  ]) {
    const failed = platform() === 'win32'
      ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm ' + badArgs.map((arg) => /[\s"]/.test(String(arg)) ? '"' + String(arg).replaceAll('"', '\\"') + '"' : String(arg)).join(' ')], { cwd: fixtureFrontend, encoding: 'utf8', stdio: 'pipe' })
      : spawnSync('pnpm', badArgs, { cwd: fixtureFrontend, encoding: 'utf8', stdio: 'pipe' });
    if (failed.error) throw failed.error;
    assert.notEqual(failed.status, 0, `${label} must fail closed`);
  }

  console.log('jscpd smoke passed: six languages, clone report and exit code, test visibility, generated/vendor exclusions, distinct behavior, non-gating duplicate exit, empty-scan failure, and pnpm baseline script comparison.');
} finally {
  await rm(root, { recursive: true, force: true });
}
