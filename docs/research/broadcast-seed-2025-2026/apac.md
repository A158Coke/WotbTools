# APAC / ASIA：2025–2026 联赛直播回放待审清单

资料核验于 2026-10-17 至 2026-10-18（Asia/Hong_Kong）；赛事截止 2026-10-17。本文件只供用户过目，未写入生产、未创建初始化 SQL。内部服务器 key 仍是 ASIA，展示名称 APAC。

## 核验方法与范围

- 查询 [APAC 官方直播 API](https://asia.wotblitz.com/en/api/watch-blitz/v1/streams/?page_size=1000)，本次返回 306 条全年历史记录，筛选 2025–2026。API 跨区推广也会含 EU/NA，按标题、赛事及说明排除。
- 官网直播目录主要保留奖励时段最后一场，**不能据此声称全部阶段均已收齐**。另查官方 YouTube 频道 UC9lE09jxmMgMoG13WrNHPmA、官方收录解说员 [Amaunet85](https://www.youtube.com/channel/UCz8AoiZBMbw6zdGB_lJlPCw/streams) 的直播分页，以及 YouTube 定向搜索。
- 每个可用视频均读取 YouTube `ytInitialPlayerResponse`：`playabilityStatus=OK`，`liveBroadcastDetails.startTimestamp/endTimestamp` 已存在且直播已结束；只核验公开元数据，未逐帧观看内容。直播日期优先使用直播开始时间，**不采用可能晚一天的 uploadDate**。下表 UTC+8 根据带时区的 YouTube timestamp 转换。
- 官方频道直播、官网收录解说员、其他解说员分开标记；同日多语言/不同视角是备选，不算新的比赛日。无公开直播不凭空补链接。
- Leader Competition 与 Arena 全部排除；预告片、抽奖宣传等不纳入。2026 Autumn 跨服决赛 10 月 23 日以后尚未发生，未列为回放。

## 原赛事名与时间标记

沿用官方原赛事名称，附上年份及真实直播日期；不再归入春夏秋冬。Cup 保留具体原名。

| 年 | 原赛事名 | 时间标记（UTC+8） | 已验证覆盖与注意点 |
|---|---|---|---|
| 2025 | Blitz Masters: New Horizons | 2 月 24 日–3 月 16 日 | 决赛 3 月 15–16 日；RR 候选一条地区证据冲突。 |
| 2025 | Blitz Diamond Cup | 8–9 月赛事；可用决赛 9 月 22–23 日 | 保留杯赛原名；官网赛事说明含 8 月资格赛，9 月 Professionals/杯赛决赛。 |
| 2026 | Spring Games | 3 月 2–25 日赛事；可用回放 3 月 22–25 日 | 原名含 Spring，但仅将实际日期作标记。 |
| 2026 | Blitz Masters: Legacy | 5 月 10 日–6 月 7 日赛事；可用回放 5 月 16 日–6 月 7 日 | RR 四天与决赛两天完整覆盖。 |
| 2026 | Autumn Games | 9–10 月区域赛；可用回放 9 月 15 日–10 月 13 日 | Professionals RR 四天与区域决赛两天已找到；未来跨服决赛未列为回放。 |

时间标记说明：范围为已查官方赛程/已找到回放的时间，不意味着区间内每个比赛日都有视频。排除 Leader Competition/Arena，不为凑齐四季虚构赛事。

## 推荐先审的主比赛链接

以下优先官方频道，其次官网收录或长期赛事解说。全部备选及精确标题在后文与 [JSON 索引](apac-videos.json)。

| 赛事 | 日期 UTC+8 | 阶段 | 回放 |
|---|---|---|---|
| 2025 Blitz Masters: New Horizons | 2025-03-15 18:50 | Final Stages Day 1 | [Amaunet85](https://www.youtube.com/watch?v=kcChHtfamxI) |
| 2025 Blitz Masters: New Horizons | 2025-03-16 18:50 | Final Stages Day 2 | [Amaunet85](https://www.youtube.com/watch?v=wVUQW5Acf74) |
| 2025 Blitz Diamond Cup | 2025-09-22 18:50 | Final Stages Day 1 | [Amaunet85](https://www.youtube.com/watch?v=Wsp8oofXTBU) |
| 2025 Blitz Diamond Cup | 2025-09-23 18:50 | Final Stages Day 2 | [Amaunet85](https://www.youtube.com/watch?v=ohIKq1cXBkw) |
| 2026 Spring Games | 2026-03-22 18:50 | Round Robin Day 4 | [Amaunet85](https://www.youtube.com/watch?v=pkD9igJiOlg) |
| 2026 Spring Games | 2026-03-24 18:51 | Double Elimination Day 1 | [Amaunet85](https://www.youtube.com/watch?v=PetG1HegBTI) |
| 2026 Spring Games | 2026-03-25 18:51 | Double Elimination Day 2 | [Amaunet85](https://www.youtube.com/watch?v=6a47CV6v1Fs) |
| 2026 Blitz Masters: Legacy | 2026-05-26 18:50 | Round Robin Day 1 | [Amaunet85](https://www.youtube.com/watch?v=0_rdTdoxajI) |
| 2026 Blitz Masters: Legacy | 2026-05-27 18:50 | Round Robin Day 2 | [Amaunet85](https://www.youtube.com/watch?v=kG-523uQrFA) |
| 2026 Blitz Masters: Legacy | 2026-05-30 18:50 | Round Robin Day 3 | [Amaunet85](https://www.youtube.com/watch?v=gWCVlRx5KWo) |
| 2026 Blitz Masters: Legacy | 2026-05-31 18:52 | Round Robin Day 4 | [Amaunet85](https://www.youtube.com/watch?v=s4wOu77kQyI) |
| 2026 Blitz Masters: Legacy | 2026-06-06 18:47 | Double Elimination Day 1（官方频道） | [World of Tanks Blitz](https://www.youtube.com/watch?v=QdWSCdplcII) |
| 2026 Blitz Masters: Legacy | 2026-06-07 18:50 | Double Elimination Day 2（官方频道） | [World of Tanks Blitz](https://www.youtube.com/watch?v=p2UIBk6qu5Y) |
| 2026 Autumn Games | 2026-10-02 18:55 | Round Robin Day 1 | [SideScrape TV](https://www.youtube.com/watch?v=WC_jfX8QfOI) |
| 2026 Autumn Games | 2026-10-03 18:56 | Round Robin Day 2 | [SideScrape TV](https://www.youtube.com/watch?v=LkFUc5-0z4E) |
| 2026 Autumn Games | 2026-10-05 18:55 | Round Robin Day 3 | [SideScrape TV](https://www.youtube.com/watch?v=mvTMLVSg4Po) |
| 2026 Autumn Games | 2026-10-06 18:50 | Round Robin Day 4 | [Amaunet85](https://www.youtube.com/watch?v=rFGMccNnAM0) |
| 2026 Autumn Games | 2026-10-10 18:55 | TOP 4 / Playoffs Day 1（官方频道） | [World of Tanks Blitz](https://www.youtube.com/watch?v=Vh89K143B4k) |
| 2026 Autumn Games | 2026-10-11 18:50 | TOP 3 / Playoffs Day 2（官方频道） | [World of Tanks Blitz](https://www.youtube.com/watch?v=Lo9JZspuPr4) |

## 全部视频与来源

状态：`可用`=已核验结束的直播且 YouTube 可播放；`待核赛区`=视频真实存在但地区证据冲突；`失效`=官网有记录但 YouTube 当前不可用。

### 2025 Blitz Masters: New Horizons

[官方赛事说明](https://asia.wotblitz.com/en/news/tournaments/blitz-masters-new-horizons-streams/)。本组 5 条视频（同日视角未去重）。

| 开播 UTC+8 | 原视频标题 / YouTube | 频道 | 状态与来源 |
|---|---|---|---|
| 2025-02-24 18:59 | [💥ASIA💥Prove Your Skill #1💥DAY-3💥 #BlitzMasterNewHorizons](https://www.youtube.com/watch?v=s1TUiB7oAgA) | DrippinWithFinesse | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/494/) |
| 2025-03-02 18:58 | [💥ASIA💥Prove Your Skill #2💥DAY-3💥 #BlitzMasterNewHorizons](https://www.youtube.com/watch?v=rM1wLYLEbPI) | DrippinWithFinesse | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/496/) |
| 2025-03-14 18:53 | [APAC PRO Tournament - RR 4/4](https://www.youtube.com/watch?v=lClC1vDrwEo) | n9o | 待核赛区 · 解说频道补充 · [发现来源](https://www.youtube.com/results?search_query=%22Blitz%22+%22APAC%22+%22New+Horizons%22+%222025%22) |
| 2025-03-15 18:50 | [World of Tanks Blitz - Blitz Masters - Final Stages - Day 1 - APAC](https://www.youtube.com/watch?v=kcChHtfamxI) | Amaunet85 | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/channel/UCz8AoiZBMbw6zdGB_lJlPCw/streams) |
| 2025-03-16 18:50 | [World of Tanks Blitz - Blitz Masters - Final Stages - Day 2 - APAC](https://www.youtube.com/watch?v=wVUQW5Acf74) | Amaunet85 | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/500/) |

### 2025 Blitz Diamond Cup

[官方赛事说明](https://asia.wotblitz.com/en/news/tournaments/blitz-diamond-cup-2025/)。本组 6 条视频（同日视角未去重）。

| 开播 UTC+8 | 原视频标题 / YouTube | 频道 | 状态与来源 |
|---|---|---|---|
| 未知 | [Blitz Diamond Cup Pro league APAC D/4](https://www.youtube.com/watch?v=mucRpffaHSA) | 未知 | 失效 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/506/) |
| 2025-09-22 18:50 | [World of Tanks Blitz - Blitz Diamond Cup - Final Stages - Day 1 - APAC](https://www.youtube.com/watch?v=Wsp8oofXTBU) | Amaunet85 | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/channel/UCz8AoiZBMbw6zdGB_lJlPCw/streams) |
| 2025-09-23 18:35 | [💥ФИНАЛ💥День 2 "Азия" (APAC)💥BLITZ DIAMOND CUP в WoT Blitz 2025 \| WOT-GSN](https://www.youtube.com/watch?v=dzX3naDgcRQ) | WOT-GSN | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/519/) |
| 2025-09-23 18:50 | [World of Tanks Blitz - Blitz Diamond Cup - Final Stages - Day 2 - APAC](https://www.youtube.com/watch?v=ohIKq1cXBkw) | Amaunet85 | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/516/) |
| 2025-09-23 18:57 | [ГРАНД-ФІНАЛ Азія / ТУРНІР Blitz Diamond Cup 🔥 WoT Blitz](https://www.youtube.com/watch?v=IFDu2z8sV3E) | Beast [World of tanks blitz] | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/518/) |
| 2025-09-23 19:00 | [💎BLITZ DIAMOND CUP💎APAC💎GRAND FINAL💎](https://www.youtube.com/watch?v=Gunv9JrYb1M) | DrippinWithFinesse | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/517/) |

### 2026 Spring Games

[官方赛事说明](https://asia.wotblitz.com/en/news/tournaments/spring-tournaments-2026/)。本组 6 条视频（同日视角未去重）。

| 开播 UTC+8 | 原视频标题 / YouTube | 频道 | 状态与来源 |
|---|---|---|---|
| 2026-03-22 18:50 | [World of Tanks Blitz - Spring Season - Round Robin - Day 4 - APAC](https://www.youtube.com/watch?v=pkD9igJiOlg) | Amaunet85 | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/channel/UCz8AoiZBMbw6zdGB_lJlPCw/streams) |
| 2026-03-24 18:51 | [World of Tanks Blitz - Spring Season - Double Elimination - Day 1 - APAC](https://www.youtube.com/watch?v=PetG1HegBTI) | Amaunet85 | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/channel/UCz8AoiZBMbw6zdGB_lJlPCw/streams) |
| 2026-03-25 18:47 | [WotB - Spring Season - Double Elimination - Day 2 - APAC](https://www.youtube.com/watch?v=4hShvJ4Rc-Q) | Twinqz | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/537/) |
| 2026-03-25 18:51 | [World of Tanks Blitz - Spring Season - Double Elimination - Day 2 - APAC](https://www.youtube.com/watch?v=6a47CV6v1Fs) | Amaunet85 | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/535/) |
| 2026-03-25 19:00 | [World Of Tanks Blitz \|\| REQM \|\|  Top4 stage Day 2](https://www.youtube.com/watch?v=reSgKpylUwE) | CR1M_ | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/538/) |
| 2026-03-25 19:56 | [2026 3月25日 spring Games Double Elimination Day ２ FINAL #worldoftanksblitz　＃ワールドオブタンクスブリッツ](https://www.youtube.com/watch?v=KwBzUqpky_E) | メテオMeteor | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/536/) |

### 2026 Blitz Masters: Legacy

[官方赛事说明](https://asia.wotblitz.com/en/news/tournaments/blitz-masters-legacy-2026/)。本组 11 条视频（同日视角未去重）。

| 开播 UTC+8 | 原视频标题 / YouTube | 频道 | 状态与来源 |
|---|---|---|---|
| 2026-05-16 18:50 | [World of Tanks Blitz - Blitz Masters Legacy - Qualifier 2 - Day 2 - APAC](https://www.youtube.com/watch?v=NgXrrZNskdw) | Amaunet85 | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/channel/UCz8AoiZBMbw6zdGB_lJlPCw/streams) |
| 2026-05-17 18:45 | [WoT Blitz APAC Blitz Masters: Legacy PYS #2 - Day 3!](https://www.youtube.com/watch?v=lr97n0p3_t4) | Frostbyte1191 | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/543/) |
| 2026-05-17 18:50 | [World of Tanks Blitz - Blitz Masters Legacy - Qualifier 2 - Day 3 - APAC](https://www.youtube.com/watch?v=rLX_Irfmo7E) | Amaunet85 | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/542/) |
| 2026-05-22 18:46 | [WoT Blitz APAC Blitz Masters: Legacy PYS #3 - Day 3!](https://www.youtube.com/watch?v=AZOCvrJMO_U) | Frostbyte1191 | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/546/) |
| 2026-05-26 18:50 | [World of Tanks Blitz - Blitz Masters Legacy - Round Robin - Day 1 - APAC](https://www.youtube.com/watch?v=0_rdTdoxajI) | Amaunet85 | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/channel/UCz8AoiZBMbw6zdGB_lJlPCw/streams) |
| 2026-05-27 18:50 | [World of Tanks Blitz - Blitz Masters Legacy - Round Robin - Day 2 - APAC](https://www.youtube.com/watch?v=kG-523uQrFA) | Amaunet85 | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/channel/UCz8AoiZBMbw6zdGB_lJlPCw/streams) |
| 2026-05-30 18:50 | [World of Tanks Blitz - Blitz Masters Legacy - Round Robin - Day 3 - APAC](https://www.youtube.com/watch?v=gWCVlRx5KWo) | Amaunet85 | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/channel/UCz8AoiZBMbw6zdGB_lJlPCw/streams) |
| 2026-05-31 18:52 | [World of Tanks Blitz - Blitz Masters Legacy - Round Robin - Day 4 - APAC](https://www.youtube.com/watch?v=s4wOu77kQyI) | Amaunet85 | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/channel/UCz8AoiZBMbw6zdGB_lJlPCw/streams) |
| 2026-06-06 18:47 | [WoT Blitz. Blitz Masters: Legacy. APAC Day 1 Double Elimination](https://www.youtube.com/watch?v=QdWSCdplcII) | World of Tanks Blitz | 可用 · 官方频道 · [发现来源](https://www.youtube.com/results?search_query=wot+blitz+APAC+2026) |
| 2026-06-07 18:50 | [WoT Blitz. Blitz Masters: Legacy. APAC Day 2 Double Elimination](https://www.youtube.com/watch?v=p2UIBk6qu5Y) | World of Tanks Blitz | 可用 · 官方频道 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/564/) |
| 2026-06-07 19:46 | [World Of Tanks Blitz \|\| REQM \|\|  GRAND FINALS!](https://www.youtube.com/watch?v=sOj19MwBReQ) | CR1M_ | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/563/) |

### 2026 Autumn Games

[官方赛事说明](https://na.wotblitz.com/en/content/top-8-autumn-games/)。本组 17 条视频（同日视角未去重）。

| 开播 UTC+8 | 原视频标题 / YouTube | 频道 | 状态与来源 |
|---|---|---|---|
| 2026-09-15 18:51 | [2026年9月15日　AUTUMN GAMES 2026　PYS#1 day4#wotblitz #worldoftanksblitz　＃ワールドオブタンクスブリッツ](https://www.youtube.com/watch?v=CA3xTtw_-II) | メテオMeteor | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/574/) |
| 2026-09-18 19:00 | [AUTUMN GAMES 2026 \| APAC \| PYS 2 DAY 2](https://www.youtube.com/watch?v=BjfwRjdwhp0) | SideScrape TV | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/results?search_query=wot+blitz+APAC+2026) |
| 2026-09-18 19:33 | [2026年9月18日　AUTUMN GAMES 2026　PYS#2 day2#wotblitz #worldoftanksblitz　＃ワールドオブタンクスブリッツ](https://www.youtube.com/watch?v=rvAJlyxOKTQ) | メテオMeteor | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/575/) |
| 2026-09-19 19:00 | [AUTUMN GAMES 2026 \| APAC \| PYS 2 DAY 3](https://www.youtube.com/watch?v=1b4gAn9oYd0) | SideScrape TV | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/results?search_query=wot+blitz+APAC+2026) |
| 2026-09-25 18:55 | [AUTUMN GAMES 2026 \| APAC \| PYS 3 DAY 3 \| BP GIVEAWAY](https://www.youtube.com/watch?v=uEWa63B-Xoo) | SideScrape TV | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/results?search_query=%22Blitz%22+%22APAC%22+%22Autumn%22+%22Day+3%22) |
| 2026-09-25 19:35 | [2026年9月25日　AUTUMN GAMES 2026　PYS#3 day3#wotblitz #worldoftanksblitz　＃ワールドオブタンクスブリッツ](https://www.youtube.com/watch?v=Imzi8R7gSIo) | メテオMeteor | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/578/) |
| 2026-10-02 18:55 | [Wot Blitz autumn games 2026 Regional Pros --DAY 1 [ENG]](https://www.youtube.com/watch?v=WC_jfX8QfOI) | SideScrape TV | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/results?search_query=wot+blitz+APAC+2026) |
| 2026-10-03 18:56 | [Wot Blitz autumn games 2026 Regional Pros --DAY 2 [ENG]](https://www.youtube.com/watch?v=LkFUc5-0z4E) | SideScrape TV | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/results?search_query=wot+blitz+APAC+2026) |
| 2026-10-05 18:55 | [Wot Blitz autumn games 2026 Regional Pros --DAY 3 [ENG] Battlepass Giveaway \|](https://www.youtube.com/watch?v=mvTMLVSg4Po) | SideScrape TV | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/results?search_query=%22Blitz%22+%22APAC%22+%22Autumn%22+%22Day+3%22) |
| 2026-10-06 18:50 | [World of Tanks Blitz - Autumn Games - Round Robin - Day 4 - APAC](https://www.youtube.com/watch?v=rFGMccNnAM0) | Amaunet85 | 可用 · 解说频道补充 · [发现来源](https://www.youtube.com/channel/UCz8AoiZBMbw6zdGB_lJlPCw/streams) |
| 2026-10-10 18:55 | [WoT Blitz. Autumn Games. APAC TOP 4](https://www.youtube.com/watch?v=Vh89K143B4k) | World of Tanks Blitz | 可用 · 官方频道 · [发现来源](https://www.youtube.com/results?search_query=wot+blitz+APAC+2026) |
| 2026-10-10 18:56 | [Wot Blitz autumn games 2026 APAC TOP 4 DAY 1 [ENG]](https://www.youtube.com/watch?v=yOpc-sG7o4k) | SideScrape TV | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/592/) |
| 2026-10-11 18:50 | [WoT Blitz. Autumn Games. APAC TOP 3](https://www.youtube.com/watch?v=Lo9JZspuPr4) | World of Tanks Blitz | 可用 · 官方频道 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/594/) |
| 2026-10-11 18:56 | [Autumn Games APAC. Top 4 - WoTBlitz Live 🔴](https://www.youtube.com/watch?v=yhhuKwTyHx8) | WoTBEE | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/593/) |
| 2026-10-11 19:05 | [Wot Blitz autumn games 2026 APAC TOP 4 DAY 2 [ENG]](https://www.youtube.com/watch?v=FMmyzEl16_o) | SideScrape TV | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/596/) |
| 2026-10-11 19:07 | [2026年10月11日　AUTUMN GAMES 2026　Regional Pros Playoffs — Day 2#worldoftanksblitz　＃ワールドオブタンクスブリッツ](https://www.youtube.com/watch?v=FrefK25xhEk) | メテオMeteor | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/595/) |
| 2026-10-13 18:58 | [Wot Blitz autumn games 2026 APAC LEC DAY 2 [ENG]](https://www.youtube.com/watch?v=wadRjecn53o) | SideScrape TV | 可用 · 官网收录解说 · [发现来源](https://asia.wotblitz.com/en/tournaments/streams/598/) |

## 缺口和不应直接入库的项目

- **2025 New Horizons**：两个决赛日完整；资格赛只找到 PYS #1 Day 3 与 #2 Day 3，不能声称资格赛全收齐。RR 4/4 候选 `lClC1vDrwEo` 标题 APAC，但说明写 EU，列待核赛区。RR 前三天未找到可明确确认的 APAC 回放。
- **2025 Diamond Cup**：APAC 决赛实际为 9 月 22–23 日，以 YouTube 直播开始时间与官网奖励时段共同核验；非主要资料有 9 月 23–24 日写法，不据此改掉真实视频日期。资格赛及 RR 多日仍缺；官网 `streams/506` 的 `mucRpffaHSA` 已显示 This video is unavailable，不能作为可用链接。
- **2026 Spring Games**：找到 RR Day 4 与决赛两天；RR Day 1–3、PYS 各轮、Challengers/LEC 尚未收齐。
- **2026 Legacy**：Professionals RR 四天与决赛两天已覆盖；PYS 仅第二轮 Day 2/3、第三轮 Day 3，其他资格赛和 Challengers/LEC 未收齐。
- **2026 Autumn Games**：Professionals RR 四天及区域决赛两天已覆盖；PYS #1–#3 只部分日期，LEC 只有 10 月 13 日 Day 2，Challengers 未收齐；跨服决赛是未来赛事，不能提前当回放入库。
- APAC 的某些原赛事说明/视频描述会沿用旧赛季或 EU 文案；归属需综合标题、实际开播时间、官网赛区页面、参赛队伍，不能只照一个字段猜。

统计：45 条候选中，43 条已核验可用的结束直播，1 条赛区待核，1 条当前失效；其中官方 YouTube 频道 4 条。用户未确认前不生成迁移、不调用管理员接口、不提交生产。
