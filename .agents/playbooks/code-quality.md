# Code Quality Checklist（内部检查单）

> 内部 checklist：**loaded by review-with-docs**；只服务 final review，不参与 lifecycle routing。不是顶层 Skill。

## 输入 / 输出 / 不负责

- **输入**：current diff / changed files（不需要 approved plan；小修、repair、docs-only review 都可使用）。
- **负责**：6 项代码质量检查，输出 findings。
- **不负责**：spawn verifier 或任何子 agent、修复循环 orchestration、final PASS 判定、commit、push、open PR。
- **final PASS**：只由 `review-with-docs` 判定；本 checklist 的通过不等于 final gate 通过。

## 检查单

### 1. grep 残留
- 旧变量名/旧函数名是否还有引用
- 删除的代码是否还有残留引用（import、调用、注释）

### 2. 硬编码
- 颜色值是否用了 CSS 变量（`var(--xxx)`），而非 `#rrggbb`
- URL 是否走配置/环境变量，而非硬编码字符串
- 文案是否走 i18n（`$t()` / locale JSON），而非硬编码中英文
- 魔法数字是否有常量定义或有注释说明来源

### 3. 未使用的 import
- Java：未使用的 import 语句
- JavaScript/Vue：未使用的 import
- Vue：未使用的组件/ref/computed 引用

### 4. 命名不一致
- 同一概念在不同文件中是否用了不同名称
- snake_case / camelCase 是否混用
- API key 前后端是否一致
- 前端 locale key 三语是否同步

### 5. 空值边界
- null/undefined 是否有兜底（`|| '—'`、`??`、Optional）
- 数组/集合空值是否有空安全处理
- 数字运算是否处理 NaN/Infinity
- 字符串操作是否处理空串

### 6. 并发安全
- Java：共享可变状态是否有同步
- 数据库：是否有并发冲突处理（`DataIntegrityViolationException`）
- 前端：异步状态是否有竞态保护（abort、cleanup）

## Findings 格式

```text
CODE QUALITY FINDINGS
SCOPE: [changed files]
CHECK: 1-6
FINDINGS:
- <file>:<line> [BLOCKER/MAJOR/MINOR] <problem> -> <suggested fix>
GAPS: <无法确认的项>
```

本 checklist 只输出 findings；修复、重审、final PASS 与 PR 由对应 top-level Skill 处理。
