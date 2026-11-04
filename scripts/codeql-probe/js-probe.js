// CodeQL 受控 canary（issue #738）：刻意注入一个默认套件必然命中的注入模式，
// 作为「扫描真实工作」的持续证据——本文件的 alert（js/code-injection，error 级）
// 必须持续出现在 code scanning alerts 里；消失即扫描链路断裂。
//
// 边界：纯 Node 侧单文件，无依赖、无导出、不被任何 runtime/构建消费
//（不进前端 bundle、不进 Java classpath、不进 docker 镜像）。
// 若 CodeQL 未来对该模式免报，替换 canary 模式并在此记录。

// eslint-disable-next-line no-unused-vars
function canaryEvalFromUrl(params) {
  // js/code-injection：URL 参数 → eval 的显式污点流
  const payload = params.get('cmd')
  return eval(payload)
}

// eslint-disable-next-line no-unused-vars
function canaryEvalProbe() {
  if (typeof window === 'undefined') return null
  return canaryEvalFromUrl(new URLSearchParams(window.location.search))
}

module.exports = { canaryEvalFromUrl, canaryEvalProbe }
