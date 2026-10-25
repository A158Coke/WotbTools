---
name: product-qa
description: >
  独立 operational 入口：以真实用户 / QA / 新手的身份，用可交互浏览器对 WotbTools 做黑盒 Product QA
  （默认全站 production `https://wotbtools.com`，也可指定 local / preview 目标），产出 Confirmed findings。
  Trigger: 用户说 Product QA / 全站 QA / 产品审查 / 新手引导审查 / 周期 QA，或要求"像真实用户一样把网站用一遍"。
  它只是 `.agents/playbooks/product-qa/` 的薄入口，不属于 implementation lifecycle：不拥有 commit / push / PR /
  merge / final implementation PASS，不是 review-with-docs 的 gate。
---

# Product QA（入口）

> 正文唯一来源是 [`.agents/playbooks/product-qa/README.md`](../../playbooks/product-qa/README.md)。
> 本文件只负责让 Claude Code、Codex 等 harness 能按名字发现并进入它，**不复制任何流程、规则或判定口径**。

## 执行

1. 完整读取 `.agents/playbooks/product-qa/README.md`，并按其「选择场景」章节加载 `references/` 下对应的清单
   （`full-site.md` 全站；`usability-and-onboarding.md` 可用性与新手引导）。
2. 目标默认 `https://wotbtools.com`。用户要求审查尚未发布的实现时，使用该任务明确给出的 local / preview 目标。
3. 严格遵守 README 的能力门槛、黑盒隔离规则与安全边界（不登录真实账号、不提交有副作用的操作、不上传私人文件）。
4. 只输出 Confirmed findings 与 coverage limitation；需要开发的 finding 进入 GitHub Issue / `designer`，不在本入口内直接修改代码。
