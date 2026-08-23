$ErrorActionPreference = 'Stop'
$origDir = Get-Location
$scratch = Join-Path ([System.IO.Path]::GetFullPath($env:TEMP)) ('ocr-verify-' + [guid]::NewGuid().ToString('N'))
$fixtures = Join-Path $PSScriptRoot 'fixtures'

function Step([string]$name) { Write-Host ("`n===== " + $name + " =====") -ForegroundColor Cyan }
function Ok([string]$msg) { Write-Host ("[PASS] " + $msg) -ForegroundColor Green }
function Fail([string]$msg) { Write-Host ("[FAIL] " + $msg) -ForegroundColor Red; exit 1 }

try {
  New-Item -ItemType Directory -Path $scratch -Force | Out-Null
  Set-Location $scratch
  git init -q -b main 2>&1 | Out-Null
  git config user.email verify@local; git config user.name verify

  # base commit - correct SampleService
  # carry the project rule.json so rule resolution validates the project layer
  New-Item -ItemType Directory -Path '.opencodereview' -Force | Out-Null
  Copy-Item (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path '.opencodereview\rule.json') '.opencodereview\rule.json' -Force
  New-Item -ItemType Directory -Path 'java\verify' -Force | Out-Null
  Copy-Item (Join-Path $fixtures 'base\SampleService.java') 'java\verify\SampleService.java'
  git add -A; git commit -qm 'base: correct SampleService'
  $base = git rev-parse HEAD

  # feature branch - multiple commits (Case 5: multi-commit range)
  git checkout -qb feature
  $nl = [char]10
  Set-Content -Path 'java\verify\Util.java' -Value ('package com.wotb.verify;' + $nl + 'public final class Util { public static int clamp(int v) { return [math]::Max(0, v); } }')
  git add -A; git commit -qm 'feature 1: add Util'
  Copy-Item (Join-Path $fixtures 'buggy\SampleService.java') 'java\verify\SampleService.java' -Force
  git add -A; git commit -qm 'feature 2: introduce NPE bug in getScore (Case 1 fixture)'
  Set-Content -Path 'README.md' -Value ('# scratch' + $nl + 'Docs only.')
  git add -A; git commit -qm 'feature 3: add README'
  $head = git rev-parse HEAD

  Step 'Case 5 - multi-commit branch range (merge-base, not HEAD~1)'
  $json = ocr delegate preview --from main --to feature --format json 2>$null
  $preview = $json | ConvertFrom-Json
  if (-not $preview -or $preview.mode -ne 'range') { Fail 'preview returned no range JSON' }
  if (-not $preview.merge_base) { Fail 'merge_base missing' }
  $files = @($preview.reviewable_files | ForEach-Object { $_.path })
  $hasJava = $files -contains 'java/verify/SampleService.java'
  $hasUtil = $files -contains 'java/verify/Util.java'
  $hasReadme = $files -contains 'README.md'
  Write-Host ('  merge_base=' + $preview.merge_base + ' total=' + $preview.total_files + ' reviewable=' + $preview.reviewable_count)
  if ($hasJava -and $hasUtil) { Ok 'reviewable covers all feature commits (SampleService + Util)' } else { Fail ('coverage incomplete: ' + ($files -join ', ')) }
  Write-Host ('  README.md included: ' + $hasReadme + ' (expected false - unsupported_ext)')

  Step 'Case 1 - rule resolution for the buggy file'
  $ruleJson = ocr delegate rule --format json 'java/verify/SampleService.java' 2>$null
  $rule = $ruleJson | ConvertFrom-Json
  if (-not $rule -or @($rule.groups).Count -eq 0) { Fail 'no rule groups resolved' }
  $g = $rule.groups | Where-Object { $_.files -contains 'java/verify/SampleService.java' } | Select-Object -First 1
  if (-not $g) { Fail 'SampleService.java not in any rule group' }
  if ($g.source -ne 'project') { Fail ('expected project rule, got source=' + $g.source + ' pattern=' + $g.pattern) }
  Ok ('rule resolved: source=' + $g.source + ' pattern=' + $g.pattern)

  Step 'Case 6 - no meaningful diff'
  git checkout -qb empty-feature main
  Set-Content -Path 'notes.txt' -Value 'not code'
  git add -A; git commit -qm 'empty feature: notes only'
  $p2 = (ocr delegate preview --from main --to empty-feature --format json 2>$null) | ConvertFrom-Json
  if (-not $p2) { Fail 'no preview JSON for empty feature' }
  Write-Host ('  reviewable_count=' + $p2.reviewable_count + ' excluded=' + $p2.excluded_count)
  if ($p2.reviewable_count -eq 0) { Ok 'reviewable_count == 0 - friendly no-diff path' } else { Fail ('expected 0, got ' + $p2.reviewable_count) }

  Step 'Case 4 - OCR failure is NOT treated as no findings'
  git checkout -qb fail-test feature
  $oldEAP = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'   # native stderr must not abort the test
  $null = ocr delegate preview --from main --to feature --format json --bogus-flag 2>&1
  $exit1 = $LASTEXITCODE
  Write-Host ('  exit code with invalid flag: ' + $exit1)
  if ($exit1 -ne 0) { Ok 'OCR command failure surfaces non-zero exit' } else { Fail 'expected non-zero exit for invalid flag' }
  $null = ocr delegate preview --repo 'C:\nonexistent\path' --format json 2>&1
  $exit2 = $LASTEXITCODE
  Write-Host ('  exit code with invalid repo: ' + $exit2)
  if ($exit2 -ne 0) { Ok 'invalid repo also fails loudly' } else { Fail 'expected non-zero exit for invalid repo' }
  $ErrorActionPreference = $oldEAP

  Step 'Summary'
  Write-Host ('scratch repo: ' + $scratch) -ForegroundColor Yellow
  Write-Host ('base:    ' + $base) -ForegroundColor Yellow
  Write-Host ('feature: ' + $head) -ForegroundColor Yellow
  Write-Host 'ALL DETERMINISTIC CHECKS PASSED' -ForegroundColor Green
  Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
}
finally {
  Set-Location $origDir
}