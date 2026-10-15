"use strict";
// Native Bridge transport for GeckoView（contracts/android-native-bridge.json，bridge v3）。
//
// 向页面暴露与 Bridge v2 WebView 完全同形的 `window.WotbNative`
// （postMessage(string) / addEventListener('message') / removeEventListener），
// 因此前端 `callBridge()` 是唯一 RPC 入口且无需感知引擎。消息经 runtime.connectNative 交给 Native；
// Native 再按 sender（content script / top frame / 当前 session / exact origin）复核，这里只是第一道门。
(() => {
  // 只允许 Native 触发 contract events 列出的 global，绝不执行任意名字。
  const EVENT_GLOBALS = new Set(["wotbtoolsOnAuthChanged", "wotbtoolsOnConnectivityChanged", "wotbtoolsOnReplay"]);
  // 端口不在这里重复：引擎只会导航到 exact MainActivity.LOCAL_APP_ORIGIN，Native 也按 exact origin 复核 port。
  if (window !== window.top || location.protocol !== "http:" || location.hostname !== "127.0.0.1") return;

  const page = window.wrappedJSObject;
  const listeners = new Set();
  const outbox = [];
  let ready = false;
  const port = browser.runtime.connectNative("wotbtools");

  function send(data) {
    if (ready) port.postMessage({ type: "rpc", data });
    else outbox.push(data);
  }

  port.onMessage.addListener((message) => {
    if (!message || typeof message.type !== "string") return;
    if (message.type === "ready") {
      ready = true;
      outbox.splice(0).forEach(send);
    } else if (message.type === "reply" && typeof message.data === "string") {
      for (const listener of Array.from(listeners)) {
        try {
          listener(cloneInto({ data: message.data }, window));
        } catch (_) {
          // 页面 listener 抛错不影响其它 listener。
        }
      }
    } else if (message.type === "event" && EVENT_GLOBALS.has(message.global)) {
      try {
        if (typeof page[message.global] === "function") page[message.global]();
      } catch (_) {
        // 页面回调失败只影响页面自身。
      }
    }
  });
  port.onDisconnect.addListener(() => {
    ready = false;
  });

  page.WotbNative = cloneInto({
    postMessage(data) {
      if (typeof data === "string") send(data);
    },
    addEventListener(type, listener) {
      if (type === "message" && typeof listener === "function") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "message") listeners.delete(listener);
    },
  }, window, { cloneFunctions: true });
})();
