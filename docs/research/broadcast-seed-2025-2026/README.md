# 2025–2026 联赛回放初始化资料 · 待审阅

核验日：2026-10-18。分支 `codex/broadcast-replay-seed-data` 基于已合并 #662 的 main `3c6e77baa`。
本PR增加三语名称、数字小组号和V40初始化迁移；未调用生产管理API或写入生产数据库。已从284条候选中选择资料完整的3条，暂缓281条，见[初始化事实](seed-ready.json)与[暂缓明细](seed-skipped.md)。

按最新要求，沿用赛事原名，仅附年份和时间标记。国服使用 Bilibili；其余四服使用 YouTube。
Leader Competition、Arena Competition 及明确休赛季赛事排除；多语言、POV 与同场备选保留供选择。

## 收集范围

| 区服 | 候选链接 | 核验情况 | 详细资料 |
|---|---:|---|---|
| CN | 9 | 官方 B 站 2 合集、9 个分 P，比赛日期与上传日期分开 | [CN / Lesta](cn-lesta.md) |
| APAC | 45 | 43 条结束且可播放的直播、1 条赛区待核、1 条失效 | [APAC](apac.md) |
| NA | 91 | 91 条结束且可播放的直播，包含 26 条多语言、POV或级别备选 | [NA](na.md) |
| EU | 129 | 124 条普通直播候选、3 条 POV/WatchParty 备选、2 条不可用 | [EU](eu.md) |
| Lesta | 10 | 2026 官方频道直播，2025 YouTube 仍缺 | [CN / Lesta](cn-lesta.md) |

总计 **284 个不同直链**：271 条 YouTube 结束直播元数据核验通过，9 个 B 站分 P，另有 1 条赛区待核、3 条不可用。
链接数不是比赛数；同日不同语言/视角、同一合集不同分 P 分别计数。

## 国际三服的原赛事名称与时间

| 年份 | 原赛事名称 | 时间标记 | 区服 |
|---|---|---|---|
| 2025 | Blitz Masters: New Horizons | 2–3 月 | APAC / NA / EU |
| 2025 | Blitz Diamond Cup | 8–9 月 | APAC / NA / EU |
| 2026 | Spring Games | 3 月 | APAC / NA / EU |
| 2026 | Blitz Masters: Legacy | 5–6 月 | APAC / NA / EU |
| 2026 | Autumn Games | 9–10 月本区阶段 | APAC / NA / EU |

不创建春夏秋冬映射，不把 Cup 一律改成旋风杯。各区具体赛日、差异与逐条证据见详细稿。
2026 Autumn Games 跨服 Finale 计划为 10 月 23 日至 11 月 7 日，尚未发生，不计作已有回放。

## 本轮补核

2026 年 172 条已重新提取标题、简介和可得章节，171 条有阶段线索，28 条有直接或章节队名线索；这不等于完成每条场次确认。详见 [2026 复核与官方赛程](2026-recheck.md)。直播日期优先使用真实直播开始时间并按区服当地时区换算。

## 上一轮缺口

- CN：2025 夏季、2026 春季/夏季官方合集已在公开索引中发现，但本轮未取得可核验 BV 直链。
  B 站直接请求返回 412，浏览器初始化超时；未猜视频号。2025 战火杯 Day1、Day2、线下总决赛仍缺。
- CN 已收的是赛后分场上传，不冒充连续整日原始直播。`publishDate` 不填入 `startTimestamp`；
  推定比赛日期只写备注，待人工确认。
- Lesta：Part 4 Season I 跨年范围为 2025-12-22 至 2026-01-17，已找到末日决赛；Season II
  三日、Season III 三日、年度总决赛三日已找到。Part 3 的 2025 赛事主要找到 VK 证据，尚缺 YouTube。
- APAC：2025 部分积分轮/资格赛、2026 Spring Games 部分积分轮仍缺。
  NA New Horizons 有两条不同日期原题均写 RR Day 4，未擅改原标题或猜节点。

## 功能核对与初始化边界

赛事仍自由命名，无需为 Horizon、Masters 或 Cup 增加季节枚举。本PR由单name扩展为nameZh/nameEn/nameRu：中英必填，俄文为空时回退英文。
积分赛使用数字groupNumber及固定三语文案，回放标题和队伍原文不变。详见[功能契约](../../features/league-broadcasts.md)。

V40只包含确认具体比赛日、对阵和阶段的三条B站分P，原赛季年份单独存储、名称去掉重复年份前缀。
其他可播放长流尚缺精确对阵、阶段或分组，暂缓而不虚填；原始研究JSON是证据索引，不是可直接发送的ReplaySave请求。
公开pagelist及三条匿名playurl在2026-10-18均返回code=0且有播放地址；未下载或逐分钟观看媒体。

## 来源与核验

国际三服以官网目录、官方赛事公告、官方频道与官网收录解说交叉核对。官网会更新同一直播位，
其当前列表不能证明历史完整。YouTube 日期优先取真实直播开始时间，未逐分钟观看全部录像。

- [APAC 官网目录](https://asia.wotblitz.com/en/api/watch-blitz/v1/streams/?page_size=1000)
- [NA 官网目录](https://na.wotblitz.com/en/api/watch-blitz/v1/streams/?page_size=1000)
- [EU 官网目录](https://eu.wotblitz.com/en/api/watch-blitz/v1/streams/?page_size=1000)
- [国际服官方 YouTube](https://www.youtube.com/channel/UC9lE09jxmMgMoG13WrNHPmA/streams)
- [Tanks Blitz 官方 YouTube](https://www.youtube.com/channel/UCrh8Fd_QKmzhv4lhrS-k4sQ/streams)
- [国服春季合集](https://www.bilibili.com/video/BV1L53LzEES6/)
- [国服战火杯 Day3 合集](https://www.bilibili.com/video/BV18j2CBWEMo/)

各区稿标明其时间列的时区；可视化页统一显示 UTC+8，JSON 保留原带时区 timestamp。
本轮校验 JSON、直链格式与唯一性、年份、区服、排除项、无季节映射字段。该资料目录不参与运行时加载；生产实现与验证见功能文档及PR说明。
