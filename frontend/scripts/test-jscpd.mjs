import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runJscpd } from 'jscpd';

const root = await mkdtemp(path.join(tmpdir(), 'wotb-jscpd-'));
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

  console.log('jscpd smoke passed: six languages, clone report and exit code, test visibility, generated/vendor exclusions, distinct behavior, non-gating duplicate exit and empty-scan failure.');
} finally {
  await rm(root, { recursive: true, force: true });
}
