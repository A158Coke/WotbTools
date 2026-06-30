---
name: code-smell
description: >
  审查代码异味：无用、过度装饰、过度设计、无意义、不可达、废弃残留、架构复杂化。
  与 grill-fix 互补使用，grill-fix 负责标准代码质量，code-smell 负责"是否过度"的品味判断。
  Trigger: 任何代码变更后、grill-fix 闭环后执行。
---

# code-smell

> **定位**：grill-fix 检查"对不对"，code-smell 检查"好不好"。
> **执行时机**：grill-fix 闭环之后、测试之前。
> **哲学**：Less is enough. 每一行代码都应该证明它的存在价值。

## 检查清单

### 1. 无用代码（Useless）

- 从未被调用的私有方法/函数
- 从未被使用的变量/字段（包括仅赋值但从未读取的）
- 未使用的 import（Java）或 import（JS/Vue），但 IDE 自动导入的良性未用可忽略
- 仅被日志读取的变量——日志删除后变量未清理
- 无任何子类继承的 protected → 改为 private
- `.gitkeep` 以外的空文件

### 2. 过度装饰（Over-decoration）

- 为单一路径 Controller 使用 `@RequestMapping("/api/x")` + class-level + method-level → 能用 `@GetMapping`/`@PostMapping` 直接解决的不要拆
- DTO 只有 getter/setter 却用了 `@Data`/`@Getter` → Java record 或手写够用就不要引入 Lombok
- 单方法接口 → 如果目前只有一个实现且短期没有第二个预期，删掉接口直接类
- `final` 关键字滥用：局部变量/参数加 `final` 是好的（项目规范），但一个类被 `final` 只是因为"以后不应该被继承"而不是因为真的有安全/设计需求
- 过度空行/分隔注释 `// ────────` 超过必要

### 3. 过度设计（Over-design）

- 为"未来可能"做的抽象（接口、工厂、策略、观察者等）当前只有一个实现 → 等到真有第二个实现再加
- `Optional` 作为字段类型 → 只在返回值和可能为 null 的参数用
- 非必要的泛型方法（调用方永远传同一个类型）
- 非必要的 Builder 模式（构造函数参数 ≤ 3 个且没有可选参数时用构造器或 static 工厂足够）
- 为了"可测试性"引入的接口层，但测试直接用具体类 mock 也完全可以
- Service 层接口 → 如果只有一个 Impl，直接暴露类（Spring 注解在类上即可注入）

### 4. 无意义代码（Meaningless）

- 空的 `try { return x; } catch (E e) { throw e; }` → 直接 `return x;`
- 只调用 super 的构造函数/方法 → 删掉
- 永远为 true/false 的条件（如 `if (true)`、已判空后的 `!= null` 等）
- 只赋值从未读取的变量
- 对集合 `.stream().collect(toList())` → 直接用 `.toList()`
- `return x; return y;` — 第二个 return 不可达
- `@SuppressWarnings` 但没有注释解释为什么

### 5. 不可达代码（Unreachable）

- `return`/`throw` 之后的语句
- `break`/`continue` 之后的循环内语句
- 永远为 false 的 if 分支（如 `if (false)`、永远相反的条件的 else 块）
- switch 的 default 分支在 enum 全覆盖后（Java 17+ 可用 `sealed` 或 exhaustive switch）

### 6. 废弃残留（Deprecated）

- `@Deprecated` 注解的方法/类/字段——如果当前没有调用方，直接删除而不是标记废弃
- `@Deprecated` 且 javadoc 写着 "use X instead"——检查 X 是否存在，如果不存在则废弃标记已过期
- 标记了 `// TODO: remove after verification` 但功能已稳定运行——应该清理而不是继续挂着
- 死注释块：`/* ... */` 或 `// ...` 整块注释掉的代码——Git history 里有，删掉

### 7. 架构复杂化（Architecture Over-engineering）

- Controller → Service → Repository 分层之外有没有额外的中间层？
- 是否有"因为觉得将来会复杂"而引入的分层/模块？
- 跨模块依赖是否合理？是否有循环依赖？
- 异常处理是否统一？还是在每层 catch → wrap → rethrow？
- 配置是否过度抽象？3 个以下相似配置项用常量即可，不需要引入配置中心/枚举工厂

### 8. 写死 vs 过度工程平衡（Hardcoding vs Over-engineering）

- 字符串/数字重复 ≥ 3 次 → 提取常量
- 字符串/数字重复 = 1 次且含义清晰 → 保持内联，不要提取
- URLs、文件路径、API keys → 走配置/env（必须）
- 颜色值、间距、字体 → 走 CSS 变量（前端）
- 不要为单处使用的 magic number 创建常量（除非用于文档化含义）
- 不要为只有一处引用的字符串创建常量文件（除非是 i18n）
- 不要为"可能以后会改"引入配置抽象——等到真的要改时再提取

## 使用方式

与 grill-fix 链式调用：

```
1. 代码变更
2. grill-fix（标准质量）
3. code-smell（品味审查）
4. 跑测试
5. 出报告
```

Verifier brief 模板：

```
QUESTION: 按 code-smell 8 项检查单审查以下文件的代码异味
Scope: [文件列表]
ALREADY_KNOWN: [已自查处理的问题]
EFFORT: quick (只报告明确问题，不推测)
STOP_CONDITION: 完成全部 8 项或发现 ≥3 个明确问题
OUTPUT:
  VERDICT: 通过 / 有问题（列出数量）
  EVIDENCE: 逐项列出具体问题（文件:行号 → 问题 → 建议修复）
  OVER_ENGINEERING_WARNINGS: 列出过度工程化迹象
  PRIORITY: 按严重程度排序
```
