
# fallow

> 内部 playbook：由 designer / executor / prompt-repair / review-with-docs 按需加载；不是顶层 Skill，也不参与生命周期选择。

## 前置条件

已在 `frontend/` 安装 `@fallow-cli/fallow-node`。

## 用法

```bash
cd frontend

# 分析当前代码库，生成诊断报告
npx fallow

# 分析未使用代码
npx fallow check dead-code

# 分析循环依赖
npx fallow check circular-deps

# 分析重复代码
npx fallow check duplication

# 分析复杂度
npx fallow check complexity
```

## 集成到 Review-Fix

在前端代码变更后的 review-with-docs 阶段，可选执行：

```bash
cd frontend && npx fallow check dead-code
```

将输出纳入审查报告。

## 配置文件

`frontend/fallow.config.json`（可选），生成方式：

```bash
cd frontend && npx fallow init
```
