# Code Quality Checklist（内部检查单）

> 内部 checklist：**loaded by review-with-docs**；只服务 final review，不参与 lifecycle routing。不是顶层 Skill。
> 本文件是代码质量与品味检查的唯一正文（已吸收原 code-smell.md，后者已删除）。

## 输入 / 输出 / 不负责

- **输入**：current diff / changed files（不需要 approved plan；小修、repair、docs-only review 都可使用）。
- **负责**：两组共 9 项检查，输出 findings。
- **不负责**：spawn verifier 或任何子 agent、修复循环 orchestration、final PASS 判定、commit、push、open PR。
- **final PASS**：只由 `review-with-docs` 判定；本 checklist 的通过不等于 final gate 通过。

## 检查单

### A. 正确性与边界

#### 1. 空值与数值边界
- null/undefined 是否使用 `??` 或显式 `value == null` / nullish 检查兜底；Java 可使用 Optional 等合适模式。只有业务明确将所有 falsy 值都视为缺失时才使用 `||`，不得吞掉合法的 `0`、`false` 或空串
- 数组/集合空值是否有空安全处理
- 数字运算是否处理 NaN/Infinity
- 字符串操作是否处理空串

#### 2. 并发安全
- Java：共享可变状态是否有同步
- 数据库：是否有并发冲突处理（`DataIntegrityViolationException`）
- 前端：异步状态是否有竞态保护（abort、cleanup）

#### 3. 命名一致
- 同一概念在不同文件中是否用了不同名称
- snake_case / camelCase 是否混用

#### 4. 接口与状态一致
- API key 前后端是否一致
- 前端 locale key 三语是否同步

### B. 可维护性

#### 5. 死代码与残留
- 旧变量名/旧函数名是否还有引用；删除的代码是否还有残留引用（import、调用、注释）
- 未使用 import（Java / JS/Vue）；Vue 未使用的组件/ref/computed 引用（IDE 自动导入的良性未用可忽略）
- 从未被调用的私有方法/函数；仅赋值但从未读取的变量/字段；仅被日志读取的变量——日志删除后变量未清理
- 无任何子类继承的 protected → 改为 private；`.gitkeep` 以外的空文件
- 不可达代码：`return`/`throw` 之后、`break`/`continue` 之后的语句；恒为 false 的 if 分支；enum 全覆盖后多余的 switch default（Java 17+ 可用 sealed / exhaustive switch）
- 无意义代码：空 `try { return x; } catch (E e) { throw e; }`；只调用 super 的构造函数/方法；判空后仍 `!= null` 的恒真条件；`.stream().collect(toList())` → `.toList()`；不可达的第二个 `return`；`@SuppressWarnings` 但无注释解释
- 废弃残留：无调用方的 `@Deprecated` 方法/类/字段直接删除而不是标记废弃；`@Deprecated` javadoc 写 "use X instead" 时核对 X 是否存在，不存在则废弃标记已过期；功能已稳定运行的 `// TODO: remove after verification` 应清理；整块注释掉的代码删除（Git history 里有）

#### 6. 硬编码与重复
- 颜色值是否用了 CSS 变量（`var(--xxx)`），而非 `#rrggbb`
- URL 是否走配置/环境变量，而非硬编码字符串
- 文案是否走 i18n（`$t()` / locale JSON），而非硬编码中英文
- 平衡：重复 ≥ 3 次的字符串/数字提取常量；重复 1 次且含义清晰保持内联，不为单处 magic number 或单引用字符串创建常量（除非用于文档化含义或 i18n）；不为"可能以后会改"引入配置抽象——等到真的要改时再提取

#### 7. 过度装饰
- 为单一路径 Controller 使用 `@RequestMapping("/api/x")` + class-level + method-level → 能用 `@GetMapping`/`@PostMapping` 直接解决的不要拆
- DTO 只有 getter/setter 却用了 `@Data`/`@Getter` → Java record 或手写够用就不要引入 Lombok
- `final` 关键字滥用：局部变量/参数加 `final` 是好的（项目规范），但一个类被 `final` 只是因为"以后不应该被继承"而不是因为真的有安全/设计需求
- 过度空行/分隔注释 `// ────────` 超过必要

#### 8. 过度设计
- 为"未来可能"做的抽象（接口、工厂、策略、观察者等）当前只有一个实现 → 等到真有第二个实现再加
- `Optional` 作为字段类型 → 只在返回值和可能为 null 的参数用
- 非必要的泛型方法（调用方永远传同一个类型）
- 非必要的 Builder 模式（构造函数参数 ≤ 3 个且没有可选参数时用构造器或 static 工厂足够）
- 为了"可测试性"引入的接口层，但测试直接用具体类 mock 也完全可以
- **单实现接口（非机械规则）**：单方法接口或只有一个 Impl 的 Service 层接口，先检查实际调用方、模块公开契约（wire DTO、Spring/Jackson 反射、metrics、i18n、documented contract）与测试证据后，再判断是否删除接口直接暴露类。有契约或反射引用的不得判死。这是审查判断，不是"只有一个实现就删"的机械指令；本 checklist 只输出 finding，不直接修改 production 接口。

#### 9. 架构复杂化
- Controller → Service → Repository 分层之外有没有额外的中间层？
- 是否有"因为觉得将来会复杂"而引入的分层/模块？
- 跨模块依赖是否合理？是否有循环依赖？
- 异常处理是否统一？还是在每层 catch → wrap → rethrow？
- 配置是否过度抽象？3 个以下相似配置项用常量即可，不需要引入配置中心/枚举工厂

## Findings 格式

```text
CODE QUALITY FINDINGS
SCOPE: [changed files]
CHECKS: 1-9
FINDINGS:
- <file>:<line> [BLOCKER/MAJOR/MINOR] <problem or smell> -> <fix / simplification>
OVER_ENGINEERING_WARNINGS: <过度工程化迹象>
GAPS: <无法确认的项>
```

本 checklist 只输出 findings；修复、重审、final PASS 与 PR 由对应 top-level Skill 处理。
