---
name: prompt-repair-executor
description: >
  基于现成修复提示词执行增量代码修复（REPAIR EXECUTOR）：解析 blockers → Delta Discovery
  （diff / symbol / direct dependency）→ 立即修改 → targeted test → full verify。
  禁止默认重新阅读整个 repository、禁止重新设计需求。
  Trigger: 用户提供 repair prompt / review 修复意见 / PR review blockers / cleanup prompt /
  bug fix prompt / hotfix instructions / follow-up review findings，需要快速进入修复时。
  与 plan-designer（开发前方案）、review-with-docs（变更后审查）互补；本技能只执行修复，
  不重复完整 review、不自动开 branch/PR。
---

# Prompt Repair Executor（增量修复执行器）

定位：**REPAIR EXECUTOR**，不是 PLAN DESIGNER / PLAN EXECUTOR / ARCHITECTURE EXPLORER /
FULL REPOSITORY REVIEW / REQUIREMENT DISCOVERY。

用户已给出 repair prompt ⇒ 需求已确定、product contract 已确定、当前 blockers 已由 reviewer
指出。Agent 的工作是：**验证真实代码 → 定位问题 → 修复问题 → 验证修复**，而不是重新理解
已被 reviewer 理解过的整个项目。

核心原则：

```text
READ ENOUGH, NOT EVERYTHING.
DIFF BEFORE DISCOVERY.
SYMBOL BEFORE DIRECTORY.
BLOCKER BEFORE ARCHITECTURE.
DIRECT DEPENDENCY BEFORE REPOSITORY.
FIX BEFORE FULL REVIEW.
TARGETED TEST BEFORE FULL SUITE.
PASSED + UNTOUCHED = LOCKED.
EXPAND DISCOVERY ONLY WITH EVIDENCE.
REPAIR PROMPT IS NOT A REQUEST TO REDISCOVER THE PROJECT.
```

## 输入

- 用户提供的修复提示词（一整份即可，无需拆参数）：repair prompt / review 修复意见 /
  PR review blockers / cleanup prompt / bug fix prompt / hotfix instructions / follow-up findings。
- Repair Prompt = 本次修复的 **primary task contract**（决定"要修成什么"）；
  真实代码 = **implementation reality**（决定"现在实际上是什么"）。
  不能因为代码当前实现不同，就擅自改变用户明确要求。

## 核心模式：DELTA DISCOVERY

```text
Repair Discovery != Full Discovery
```

- 默认 **Discovery Budget：1~3 分钟进入实际修改**（执行策略，不是绝对超时）。
- 默认最大 discovery scope：

```text
Repair Prompt
↓ 当前 HEAD
↓ 若有 Last Reviewed SHA：SHA..HEAD diff
↓ 当前 blocker symbols
↓ 直接相关 changed files
↓ direct caller/callee 一层（最多）
```

- 只有证据不足时才扩大，扩大必须写明原因（见"规则"）。

## 流程（7 个 Phase）

### PHASE 1 — PARSE REPAIR CONTRACT

把提示词内要求分成：

```text
ACTIVE BLOCKERS        当前要修的项
LOCKED PASSED AREAS    已通过、不得回滚的项
REGRESSIONS TO PROTECT 不得破坏的项
NON-GOALS              明确不做的事
TEST REQUIREMENTS      要求的验证
FINAL REPORT REQUIREMENTS
```

- Prompt 已写明的直接使用，**不重复向用户询问已有信息**。
- 自动提取 Reviewed SHA：`Reviewed head/Reviewed HEAD/Last reviewed/Base reviewed SHA:`
  后跟合法 git SHA 即采用，用于 `git diff <sha>..HEAD`，不要求用户另外输入。
- 自动提取 LOCKED 标记：`保留 / 不要重做 / already passed / locked / 已通过 / 不得回滚`
  → 并入 LOCKED PASSED AREAS。
- 1000+ 行长 Prompt：先结构化提取，不逐句验证、不把每段都变成阅读任务。
  **REGRESSION = 修改完成后验证不破坏，不是修改开始前重新审计整个 regression 区域。**

### PHASE 2 — DELTA DISCOVERY

1. 有 Reviewed SHA 时先回答内部问题："自上次 review 后到底改了什么？"

```bash
git rev-parse HEAD
git status --short
git diff --stat <reviewed-sha>..HEAD
git diff --name-only <reviewed-sha>..HEAD
```

2. 无 SHA 时**不做 full scan**：

```bash
git status --short
git log -5 --oneline
```

   处于 PR branch 且已有 git/GitHub 信息时：识别 current branch / HEAD / base /
   recent repair commits，然后以 **blocker symbols 为主入口**。

3. 建立 **BLOCKER MAP**（每个 blocker：symbols → likely files → direct dependencies）：

```text
Blocker 1 — leagueMode contract
Symbols: leagueMode, PreviewResponse, leagueData
Likely files: PreviewResponse.java, Mapper.java, ReplayPage.vue, useColumns.js
Direct deps: 相关 tests only
```

4. **Symbol-first**（`rg`，不是目录遍历）：

```bash
rg -n "<symbol1>|<symbol2>|<symbol3>" relevant-root
```

5. 只读：target file + direct caller + direct callee/helper + related test。一层通常足够。
6. 输出最小报告（不写长篇架构分析），然后**立即进入修改**：

```text
REPAIR DISCOVERY

HEAD: <sha>

Relevant changed files:
- ...

Blocker mapping:
1. Blocker → files
2. Blocker → files

Locked passed areas:
- ...

Expanding discovery: NO
```

### PHASE 3 — IMPLEMENT

- 逐 blocker 修复；不要求修改前完整解释所有代码——root cause 有足够证据即改。
- Prompt 要求删除 X 但真实代码已没有 X → 标记 `ALREADY RESOLVED`，继续下一 blocker。
- Prompt 路径不准（如 `frontend/src/foo.js` 实际在 `frontend/src/utils/foo.js`）→ 用真实路径。
- 发现 blocker 已被后续 commit 修复 → 确认真实代码 + 测试 → `ALREADY RESOLVED`，
  不为了"执行 prompt"重复修改。
- 默认只改：当前 blockers + 必要 dependency + 必要 regression test + 必要 stale cleanup。
- 禁止 scope creep：不顺便重构整个模块 / 升级 dependency / 改 unrelated UI / 重新设计架构。

### PHASE 4 — TARGETED VERIFY

最相关测试先行，不是每改 5 行就跑全量：

```text
Fix → Targeted Test → Fix Remaining Failure → Targeted Test Green
```

例：`PlayerRatingRadar.test.js` / `ReplayPage.test.js` / 对应 service 的单测。

### PHASE 5 — FULL VERIFY

本轮所有 blockers 修改完成 **且** targeted green 之后才运行，按项目实际 stack：

```text
frontend full tests / backend full tests / build / lint / static checks
```

**省时优化（已存在 PR branch 时）**：业务代码 compile/build 通过后即可 commit + push
到当前 PR branch，让 GitHub CI 与本地 full verify 并行，不必等本地 full suite 全绿才推。
后续 test 发现新问题 → 追加修复 commit 再 push（禁止 force push）。最终报告仍以
**最新 HEAD 的 CI + 本地测试**为准（旧 HEAD CI 不算 merge proof，见"CI / merge readiness"）。

### PHASE 6 — FINAL CLEANUP

- **review-with-docs / fallow 只在此阶段运行**（REPAIR → TEST → FINAL REVIEW），
  禁止在 repair 开局运行。
- 收到 `zero technical debt / 零技术债 / final cleanup / cleanup / 不留 TODO` 时进入
  **ZERO-DEBT REPAIR MODE**，但仍用 Delta Discovery：
  sweep 范围 = 当前 PR touched files + 本轮 direct dependencies；搜索
  `TODO FIXME HACK TEMP workaround deprecated legacy fallback review archaeology plan §
  BLOCKER unused code duplicated domain constants stale API stale comments stale tests`。
  不把整个多年 repository 的历史技术债算进当前 PR。
- pre-existing issue（当前 PR 未引入、本轮未触碰、不阻塞功能）→ 标记
  `PRE-EXISTING / OUT OF REPAIR SCOPE`，不顺手修（除非用户明确要求整个 repo 零债）。

### PHASE 7 — REPORT

输出简洁最终报告（见"报告模板"），含效率日志。禁流水账、禁虚报 COMPLETE。

## 规则

- **依赖深度默认 1 层**（target + direct caller + direct callee/helper + related test）。
  扩大搜索必须明确输出：

  ```text
  EXPANDING DISCOVERY
  Reason: 当前证据无法确认 X，因为 Y。
  Additional files: ...
  ```

  禁止静默无限扩展；禁止以"我想更完整理解一下"为由扩大。
- **允许扩大的条件**（Escalation Policy，满足其一）：
  A. symbol 有多个真实实现，无法确认 runtime path
  B. caller contract 不明确
  C. test 与 production behavior 冲突
  D. backend/frontend contract 无法从当前文件确认
  E. 修改会影响 shared infrastructure
- **Discovery Stop Condition**：满足全部即停（立刻改代码，不再读"可能相关"的文件）：
  1. 每个 blocker 已映射到具体文件
  2. root cause 有代码证据
  3. expected fix contract 明确
  4. direct regression tests 已定位
- **LOCKED PASSED AREAS**：已通过 且 当前 repair diff 未触碰 ⇒ 不重新审计 / 不重新设计 /
  不重新实现 / 不主动重构。本轮没触碰的 regression 区域不重新阅读实现，由最终 full tests
  覆盖；只有本轮 diff 触碰其 shared dependency 才专项检查。
- **不创建 TODO / FIXME / follow-up**。能解决现在解决；确实无法解决则明确：

  ```text
  BLOCKED
  Reason: ...
  Evidence: ...
  Required external input: ...
  ```

- **Git**：继续当前 branch / 当前 PR；不自动新建 branch、不自动开 PR（除非用户明确要求）。
  保护用户未提交修改：禁止 `git reset --hard` / `git checkout .` / `git clean -fd`。
  是否自动 commit/push 遵循现有 DSH workflow 约定（repo 默认：review-with-docs 零 blocker
  后可提交开 PR；见 `.agents/AGENTS.md`）。
  **省时优化**：处于已存在 PR branch 的 repair 流程中，业务代码 compile/build 通过即可
  commit + push（让 CI 与本地测试并行），无需等本地 full verify 全绿；push 后照常完成
  targeted/full verify，发现新问题追加 commit 再 push——禁止 force push / 改写已公开历史，
  推送前按仓库约定确认 remote。
- **Build-to-Learn 兼容**：若当前流程有 build-to-learn，Repair 模式下保持简短，只解释
  本次涉及的关键机制 / 旧实现为何错 / 新实现为何对；不为教学扩大 Discovery。

## 边界

- **vs Plan Executor**：用户提供 feature plan / current-plan.md / 大型新功能 /
  多模块实现计划 → 用 plan-executer（Deep Discovery）。用户提供 review repair prompt /
  bug repair prompt / cleanup prompt / 已明确 blockers → 用本技能（Delta Discovery）。
- **vs Review Skill**：review-with-docs / review-fix 是"找问题"；本技能是
  "修 reviewer 已经找到的问题"。本技能不重新做完整 review，修完才运行 final review。

## Anti-pattern（防止 12 分钟 Step 1）

```text
错误：收到已详细列出 5 个 blocker 的 repair prompt，
     然后花 10+ 分钟重读整个 service / 全部 DTO / 整个 frontend / 全部 docs。

正确：
Blocker: PlayerRatingRadar size prop
→ rg PlayerRatingRadar
→ read component + test
→ confirm dead prop
→ fix
→ targeted test

Blocker: leagueMode contract
→ rg leagueMode
→ read PreviewResponse / Mapper / ReplayPage / useColumns / 直接相关 tests
→ stop
```

禁止默认执行：`read whole repository` / 读所有 README / 从头读 current-plan.md /
读完整 docs tree / 修前运行 review-with-docs / 修前运行 fallow full scan。

## 报告模板

### 修改前最小报告

```text
REPAIR DISCOVERY
HEAD: <sha>
Relevant changed files: ...
Blocker mapping: ...
Locked passed areas: ...
Expanding discovery: NO
```

### 最终报告

```text
PROMPT REPAIR REPORT

HEAD: ...

RESOLVED
1. ...
2. ...

ALREADY RESOLVED
- ...

FILES MODIFIED
- ...

TARGETED TESTS
- ...

FULL VERIFY
- ...

DEBT SWEEP
- ...

BLOCKERS
0

STATUS
COMPLETE
```

仍有 blocker 时：`BLOCKERS: 1` + `REMAINING: ...`，禁止虚报 COMPLETE。

### 效率日志

```text
DISCOVERY
- files inspected: N
- expanded discovery: yes/no（yes 时附 reason）

IMPLEMENTATION
- files modified: N

VERIFY
- targeted tests: ...
- full tests: ...
```

能可靠获取 phase duration 则加（Discovery/Implementation/Verification duration）；
无法可靠获取时**不伪造时间**。
