// 归一化 # 行：CommonMark 要求井号后有空格才识别为标题；
// 后端某些段（如 analysis 复盘正文）输出 `##一、` 这种井号后无空格的写法，
// 会被 markdown-it 当成段落原样输出 `##` 字面，导致用户看到 `##一、 战前预测`。
// 这里在渲染前对每行补一个空格：`^#{1,6}` 后紧跟非井号、非空白时插入一个空格。
// 必须跳过围栏代码块内的内容（代码块内 `##` 是注释，不能改写）。
// ponytail: 简单逐行扫，不进入嵌套语言的 AST；围栏代码块边界用 ``` 一行判定,
//   能覆盖本组件现实中接收到的 AI markdown 输出（不含四空格缩进代码块这类冷门语法）。
//   若未来接受更复杂语法，可升级为按 markdown-it token 流做替换。
// 注意：必须用 `(?!#|\s)` 而非 `(?=\S)`：后者会被回溯到 1 个 `#`，
//   误把 `## 一、`（已带空格）改成 `# # 一、`。
export function normalizeHeadings(input) {
  if (!input) return input
  const lines = input.split('\n')
  let inFence = false
  const out = []
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (!inFence) {
      out.push(line.replace(/^(#{1,6})(?!#|\s)/, '$1 '))
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}
