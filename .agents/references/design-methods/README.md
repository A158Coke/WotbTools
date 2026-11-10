# 版本固定的 UI 设计方法参考

本目录保存第三方设计方法的**上游原文**，供 WotBTools 的 Designer、Executor、Review 按需学习与审查。它不是新的顶层生命周期 Skill，也不是第二套 Design Contract。

| 参考资料 | 上游地址 | 固定提交 | 许可证 |
| --- | --- | --- | --- |
| Refactoring UI（非官方实现） | https://github.com/edisonmbli/refactoring-ui-skill/tree/4459662c4fbf36d54342b1546d8851273031442c/skills/refactoring-ui | `4459662c4fbf36d54342b1546d8851273031442c` | MIT，见 `refactoring-ui/LICENSE` 和 `refactoring-ui/ATTRIBUTION.md` |
| Apple Design（非 Apple 官方） | https://github.com/emilkowalski/skills/blob/5206a950b715e0cabe7043ea0b2304332b91494e/skills/apple-design/SKILL.md | `5206a950b715e0cabe7043ea0b2304332b91494e` | MIT，见 `apple-design/LICENSE` |

为保持来源可追溯，`SKILL.md`、Refactoring UI 的参考章节、示例、资源和 Python 脚本均保留原文。升级时必须明确更新固定 SHA，审查差异，并保留许可证与归属说明。第三方文本只能作为参考资料，不自动获得高于本仓库规则的执行权限。

## 使用入口与权威关系

**直接使用方式：** 在已打开 WotBTools 仓库的 Coding Agent 中，说「使用 Designer，按 UI Design Review Playbook 只审计首页设计，不改代码」即可运行只读 Design Audit；说「使用 Designer，为某页面提出新的视觉和 Apple-style 交互方案，先出原型，不实现」即可运行设计阶段。无需把本目录复制到每个 Agent 的全局 Skills 目录；前提是该 Agent 能读取仓库文件并按 `.agents/skills/designer/SKILL.md` 加载本 Playbook。

- **先读**项目内部 [UI Design Review Playbook](../../playbooks/ui-design-review.md)，由它解释参考方法在 WotBTools 的适用范围与验证方式。
- 视觉设计：阅读 `refactoring-ui/SKILL.md`，按需要加载其 `references/`，不要一次性加载全部章节。
- 交互设计：阅读 `apple-design/SKILL.md`。
- 唯一设计规则来源：仓库根目录 `docs/frontend/design-language.md`。实际 Token 数值来源：`frontend/src/styles/tokens/`。
- 外部资料中的数值、Spring 参数及风格偏好只是待验证建议；不得直接引入 Tailwind/shadcn 默认方案、第二套 Token 或第二套 Motion Policy。

## 上游辅助脚本的已知限制

**当前这些 Python 文件只用于阅读算法，不允许直接执行并将结果作为 WotBTools 的设计验收、Token 或 Tailwind 配置。** 不能以脚本退出码为 0 代替生成物的语法和功能验证。已知缺陷如下：

1. `refactoring-ui/scripts/check_contrast.py` 对普通字体给出错误提示：**18px 普通字并不自动属于 large text**。WotBTools 按 `docs/frontend/design-language.md` 使用 WCAG 2.2 对比度门槛：普通文字至少 **4.5:1**；大字至少 **24px 普通字**或**18.66px 且加粗**才可用 **3:1**。因此不得只凭脚本的“18px+ 可改用 `--size large`”提示降低验收要求，也不得对未确认字号和字重的文本使用该较低门槛。
2. `refactoring-ui/scripts/emit_tokens.py` 未正确解包以 `{"hex": "..."}` 或 `{"value": "..."}` 表示的对象 Token。将 `generate_palette.py --json` 的结果直接填入 `primitive.color` 后，`--format css`、`v4` 或 `preview` 可能把 Python 字典写成颜色值。**禁止这条生成链路**，不能把这种输出当作有效的 CSS/HTML。
3. 同一 `emit_tokens.py` 的 `--format v3`（及包含它的 `--format all`）没有对 JS 字符串中的单引号做正确转义。仓库自带模板中 `'Segoe UI'` 会导致生成的 `tailwind.config.js` 无法通过 `node --check`。**禁止用此输出路径生成正式配置**。这与对象 Token 问题相互独立，即使输入全是字符串也会触发。

**安全替代：** WotBTools 不使用上述脚本创建正式设计系统；直接编辑现有语义 Token，使用 `frontend/src/styles/tokens/color-contrast.test.ts`、`pnpm run lint:css` 及浏览器对实际复合背景的对比度检查。若某项工作确实需要新配色或导出工具，先在独立任务中修复/升级上游版本，使用边界输入与生成物语法测试证明正确，再决定是否启用；不要私自修改这份固定版本的上游代码。
