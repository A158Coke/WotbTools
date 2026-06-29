---
name: grill-fix
description: >
  代码变更后自动审查闭环。grep 残留→硬编码→未用 import→命名不一致→空值边界→并发安全，修复后循环直到零问题。
  Trigger: 任何代码变更完成后、提交前。
---

# grill-fix

> **前置条件**：Plan 已获用户批准，代码变更已执行完毕。
> **自动闭环**：Grill-Fix 全程不需用户介入，自动审查→修复→循环。
> **结束后**：必须出具可视化审查报告。

## 流程

1. **主 agent 自查** — 按下方检查单逐项自查本次变更涉及的所有文件
2. **spawn verifier 子 agent** — `type: verifier`，逐项审查，报告具体代码位置
3. **修复** — 根据 verifier 报告逐项修复
4. **重审** — 再次 spawn verifier 审查修复后的代码
5. **循环** — 直到 verifier 返回零新问题
6. **跑测试** — `mvn -s settings.xml test` 或 `npm run build`
7. **出具报告**（见下方模板）→ 等待用户审批后提交

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

## Verifier 子 agent brief 模板

```
QUESTION: 审查以下文件本次变更的代码质量
SCOPE: [变更文件路径列表]
ALREADY_KNOWN: [已自查并处理的问题]
EFFORT: medium
STOP_CONDITION: 完成全部 6 项检查，每项报告具体代码位置或确认通过
OUTPUT:
  VERDICT: 通过 / 有问题（列出数量）
  EVIDENCE: 逐项列出问题（文件:行号 → 问题描述）
  GAPS: 无法确认的项
  NEXT: 建议修复优先级
```

## 可视化审查报告模板

结束后输出以下格式的报告：

```
### Grill-Fix 审查报告

| 项目 | 结果 |
|------|------|
| 变更文件 | [N 个文件，列出路径] |
| 代码行数 | +A / -B |
| Grill 轮次 | [N] 轮 |
| 发现问题 | [N] 个 |
| 已修复 | [N] 个 |
| 测试状态 | 通过 / 未跑（原因） |

#### 问题清单
1. (`文件:行号`) 问题描述 → ✅ 已修复
2. (`文件:行号`) 问题描述 → ✅ 已修复
```
