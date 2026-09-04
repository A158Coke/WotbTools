<#--
  登录页背景轮换（服务端选片）。

  选择在 Keycloak 渲染时完成，不依赖 JS：没有首屏闪烁，也不会因为浏览器
  禁用脚本而退化。结果通过 :root 自定义属性交给 auth-shell.css；CSS 里保留
  硬编码兜底值，所以本文件即使被移除，登录页也仍有背景。

  ── 怎么加一张图 ────────────────────────────────────────────────────────
  1) 把 <id>.webp（横版，≤500KB）与 <id>-mobile.webp（900×1600 竖版，≤300KB）
     放进 resources/img/。
  2) 在下面 backgrounds 里加一条。desktopPos / mobilePos 是 background-position，
     用来把画面主体让开登录卡（卡片在桌面靠左、手机居中）。

  ── 排期规则 ────────────────────────────────────────────────────────────
  · 带 from/to（yyyyMMdd 整数，含首尾两天）的条目是「档期图」。
  · 今天落在任何档期窗口内 → 只在这些档期图里轮换，常规图全部让位。
    （赛事期间想固定一张图，就给它一个只覆盖赛期的窗口，且同期不要有别的窗口。）
  · 没有任何档期命中 → 在常规图（不带 from/to 的条目）里轮换。
  · 轮换粒度是「天」：同一天所有访客看到同一张，跨零点换下一张。
    按 UTC 天计（Keycloak 容器时区），不是按访客本地时区。
  · 档期图当天不在窗口内时完全不参与，因此赛后无需回来删配置。

  注意：FreeMarker 的 <、> 比较只支持数字与日期，不支持字符串，所以日期
  一律写成 yyyyMMdd 整数（20260401），不要写 "2026-04-01"。
-->
<#assign backgrounds = [
  {
    "id": "battlefield",
    "desktop": "login-battlefield.webp",
    "mobile": "login-battlefield-mobile.webp",
    "desktopPos": "68% center",
    "mobilePos": "50% 45%"
  },
  {
    "id": "wtc-overlook",
    "desktop": "login-wtc-overlook.webp",
    "mobile": "login-wtc-overlook-mobile.webp",
    "desktopPos": "62% center",
    "mobilePos": "50% 42%"
  },
  {
    "id": "summit-station",
    "desktop": "login-summit-station.webp",
    "mobile": "login-summit-station-mobile.webp",
    "desktopPos": "72% center",
    "mobilePos": "50% 45%"
  }
]>

<#assign bgToday = .now?string("yyyyMMdd")?number>
<#-- 自 epoch 起的天数：同一天内稳定，跨零点 +1。 -->
<#assign bgDayIndex = (.now?long / 86400000)?floor>

<#assign bgScheduled = []>
<#assign bgPool = []>
<#list backgrounds as bg>
  <#if bg.from?? && bg.to??>
    <#if bgToday gte bg.from && bgToday lte bg.to>
      <#assign bgScheduled = bgScheduled + [bg]>
    </#if>
  <#else>
    <#assign bgPool = bgPool + [bg]>
  </#if>
</#list>
<#assign bgActive = (bgScheduled?size gt 0)?then(bgScheduled, bgPool)>

<#if bgActive?size gt 0>
  <#assign bgPick = bgActive[bgDayIndex % bgActive?size]>
  <#-- url() 不加引号：模板默认 HTML 转义会把引号变成实体，破坏 CSS。
       这些值全是主题内的常量，不含用户输入。 -->
  <style id="wbtb-bg-rotation" data-bg-id="${bgPick.id}">
    :root {
      --auth-bg-desktop: url(${url.resourcesPath}/img/${bgPick.desktop});
      --auth-bg-desktop-pos: ${bgPick.desktopPos};
      --auth-bg-mobile: url(${url.resourcesPath}/img/${bgPick.mobile});
      --auth-bg-mobile-pos: ${bgPick.mobilePos};
    }
  </style>
</#if>
