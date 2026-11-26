"use strict";
(() => {
  const EVENT_GLOBALS = new Set(["wotbtoolsOnAuthChanged", "wotbtoolsOnConnectivityChanged", "wotbtoolsOnReplay", "wotbtoolsOnUpdateStatusChanged"]);

  function isTrustedBridgeLocation(loc) {
    return loc.protocol === "http:" && loc.hostname === "127.0.0.1" && loc.port === "21653";
  }

  if (window !== window.top || !isTrustedBridgeLocation(location)) return;

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
