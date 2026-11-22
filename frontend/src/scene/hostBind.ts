// 宿主绑定工具：把「首参为宿主对象 S」的实现函数包装为 facade 上的 API 方法。
// 拆分模块统一用 S 传递闭包状态；这里保留原始参数元组，避免 any 与展开参数的类型丢失。
export function bind<H, A extends unknown[], R>(
  host: H,
  fn: (host: H, ...args: A) => R,
): (...args: A) => R {
  return (...args) => fn(host, ...args);
}
