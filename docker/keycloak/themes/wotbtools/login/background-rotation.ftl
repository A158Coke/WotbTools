<#--
  登录页背景（服务端选片，4.0 四季主视觉）。

  登录页与站点不同源，读不到用户在站点选的主题，所以按日历季节放四季主视觉
  （与站点主题同一套图，源在 frontend/src/assets/theme/）：
    3–5 月春 · 6–8 月夏 · 9–11 月秋 · 12–2 月冬。
  选择在 Keycloak 渲染时完成，不依赖 JS：没有首屏闪烁。结果通过 :root 自定义属性交给
  auth-shell.css（CSS 里保留夏季图兜底），并设置 wbtbSeason 给 template.ftl 的卡片 kicker 使用。
  template.ftl 通过 <#attempt>/<#recover> 隔离本模板失败，此时登录页用 CSS 默认背景、kicker 回落夏季。

  ── 档期图（可选）────────────────────────────────────────────────────────
  · scheduled 里带 from/to（yyyyMMdd 整数，含首尾两天）的条目是「档期图」：
    今天落在任何档期窗口内 → 只在这些档期图里按天轮换，季节图让位；窗口外完全不参与。
  · 日期统一按 UTC calendar day 计算；与访客本地时区、容器/JVM 默认时区无关。
  · FreeMarker 的 <、> 只支持数字与日期，日期一律写成 yyyyMMdd 整数（20260401）。
  · 加一张档期图：<id>.webp（横版 ≤500KB）与 <id>-mobile.webp（竖版 ≤300KB）放进 resources/img/，
    在 scheduled 里加一条 { id, desktop, mobile, desktopPos, mobilePos, from, to }。
-->
<#assign seasons = {
  "spring": { "id": "season-spring", "desktop": "login-season-spring.webp", "mobile": "login-season-spring-mobile.webp", "desktopPos": "70% center", "mobilePos": "50% 60%" },
  "summer": { "id": "season-summer", "desktop": "login-season-summer.webp", "mobile": "login-season-summer-mobile.webp", "desktopPos": "70% center", "mobilePos": "50% 60%" },
  "autumn": { "id": "season-autumn", "desktop": "login-season-autumn.webp", "mobile": "login-season-autumn-mobile.webp", "desktopPos": "70% center", "mobilePos": "50% 60%" },
  "winter": { "id": "season-winter", "desktop": "login-season-winter.webp", "mobile": "login-season-winter-mobile.webp", "desktopPos": "70% center", "mobilePos": "50% 60%" }
}>
<#assign scheduled = []>

<#-- UTC 是唯一日界线：ISO UTC 日期与 epoch day 都不依赖 JVM/容器默认时区。 -->
<#assign bgUtcDate = .now?iso_utc?substring(0, 10)?replace("-", "")>
<#assign bgToday = bgUtcDate?number>
<#assign bgMonth = bgUtcDate?substring(4, 6)?number>
<#assign bgDayIndex = (.now?long / 86400000)?floor>

<#if bgMonth gte 3 && bgMonth lte 5>
  <#assign wbtbSeason = "spring">
<#elseif bgMonth gte 6 && bgMonth lte 8>
  <#assign wbtbSeason = "summer">
<#elseif bgMonth gte 9 && bgMonth lte 11>
  <#assign wbtbSeason = "autumn">
<#else>
  <#assign wbtbSeason = "winter">
</#if>

<#assign bgScheduled = []>
<#list scheduled as bg>
  <#if bgToday gte bg.from && bgToday lte bg.to>
    <#assign bgScheduled = bgScheduled + [bg]>
  </#if>
</#list>
<#-- ?then() 两个分支都会求值（空列表取模会除零），所以用 if / else。 -->
<#if bgScheduled?size gt 0>
  <#assign bgPick = bgScheduled[bgDayIndex % bgScheduled?size]>
<#else>
  <#assign bgPick = seasons[wbtbSeason]>
</#if>

<#-- url() 不加引号：模板默认 HTML 转义会把引号变成实体，破坏 CSS。这些值全是主题内的常量，不含用户输入。 -->
<style id="wbtb-bg-rotation" data-bg-id="${bgPick.id}" data-season="${wbtbSeason}">
  :root {
    --auth-bg-desktop: url(${url.resourcesPath}/img/${bgPick.desktop});
    --auth-bg-desktop-pos: ${bgPick.desktopPos};
    --auth-bg-mobile: url(${url.resourcesPath}/img/${bgPick.mobile});
    --auth-bg-mobile-pos: ${bgPick.mobilePos};
  }
</style>
