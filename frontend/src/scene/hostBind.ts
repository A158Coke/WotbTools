export function bind<H, A extends unknown[], R>(
  host: H,
  fn: (host: H, ...args: A) => R,
): (...args: A) => R {
  return (...args) => fn(host, ...args);
}
