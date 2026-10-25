
# fallow

> 内部 playbook：**loaded by review-with-docs**；只用于 final review 的前端诊断，不参与 lifecycle routing。不是顶层 Skill。

## 前置条件

已在 `frontend/` 安装 `@fallow-cli/fallow-node`。

## 用法

```bash
cd frontend

# 分析当前代码库，生成诊断报告
pnpm exec fallow

# 分析未使用代码
pnpm exec fallow check dead-code

# 分析循环依赖
pnpm exec fallow check circular-deps

# 分析重复代码
pnpm exec fallow check duplication

# 分析复杂度
pnpm exec fallow check complexity
```

## 集成到 Review With Docs

在前端代码变更后的 `review-with-docs` final gate 内，可选执行：

```bash
cd frontend && pnpm exec fallow check dead-code
```

将输出纳入审查报告。

## 配置文件

`frontend/fallow.config.json`（可选），生成方式：

```bash
cd frontend && pnpm exec fallow init
```
