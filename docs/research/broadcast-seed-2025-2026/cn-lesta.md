# CN / Lesta：2025–2026 联赛回放审阅草稿

检索截至 2026-10-18（Asia/Hong_Kong）。仅收集供人工审阅；未导入数据库。与本文件同目录的 `cn-lesta-videos.json` 包含 10 条 Lesta 官方 YouTube 直播回放和 CN 官方 B 站分场回放。保留原赛事名，只按年份和日期/时间范围标记，不创建春夏秋冬映射。搜索结果页和 VK 目录不冒充视频直链。

## 方法与覆盖范围

- YouTube 来源：[Tanks Blitz 官方频道](https://www.youtube.com/channel/UCrh8Fd_QKmzhv4lhrS-k4sQ/streams)，官方身份另由 [Lesta 支持页](https://lesta.ru/support/ru/products/tb/article/36569/) 的官方平台列表交叉确认。
- 对候选逐个读取 YouTube watch 页面 `ytInitialPlayerResponse`：核对完整原标题、作者/频道 ID、直播开始时间、`isLiveContent=true`、`isLiveNow=false`、`playabilityStatus=OK`、时长。以下日期采用真实直播开始时间的 UTC 日期（这些视频在莫斯科本地也为同一天），不是上传时间或搜索引擎“几个月前”。未下载视频、未逐分钟观看；元数据可访问不保证任意地区/设备均可播放。
- 实际覆盖：2026 Lesta 已核验 10 条官方 YouTube 长直播，2025 Lesta 暂未找到同类 YouTube 片源。CN 按用户补充使用官方 B 站，已获得 2025 春季六分 P 及战火杯 Day 3 三分 P；其他合集直链有缺口。此结论不能推导为“比赛没办”或“网上完全不存在”。
- 公开频道 streams 首屏有 30 条；2025 赛事直播未出现在其中。尝试 continuation 未获得可用的后续视频列表，因此不声称已经穷尽频道全历史。另检索赛事原名、年度、官方站赛事文章及官方 Telegram/VK。
- 沿用原赛事名称，跨年赛记录完整起止时间。明确休赛季、Leader Competition/Arena 排除。Cup/Кубок/战火杯保留杯赛原名，不一律改成“旋风杯”；不因奖品中出现“Кубки”（游戏奖杯）就判成杯赛。

## Lesta：原赛事名与日期

| 年份 | 原赛事名 | 已核实主要日期 | YouTube 覆盖/缺口 |
| --- | --- | --- | --- |
| 2025 | Лига Блиц Поинт, Часть 3 — Сезон III（第三部分·第 III 季） | Hardcore 2025-04-24 至 05-07；资格赛 04-11 起 | 官方规则确认赛季；未找到可核验 YouTube 回放 |
| 2025 | Лига Блиц Поинт, Часть 3 — Сезон IV（第三部分·第 IV 季） | Hardcore 2025-06-20 至 07-02；Play-off 06-30、07-01、07-02 | 保留一个原赛事；未找到 YouTube |
| 2025 | Финальный турнир Лиги Блиц Поинт, Часть 3（第三部分·年度总决赛） | 线下 Play-off 2025-09-13、09-14 | 官方 VK 有长回放证据；未找到 YouTube；资格/Play-in/小组阶段尚未完整梳理 |
| 2025→2026 | Лига Блиц Поинт, Часть 4 — Сезон I（第四部分·第 I 季） | Hardcore 2025-12-22 至 2026-01-17；Play-off 01-15、16、17 | YouTube 核验到 01-17 决赛；前两天有官方 VK 证据。官方 01-17 说明因 VK 故障额外开启 YouTube 流 |
| 2026 | Лига Блиц Поинт, Часть 4 — Сезон II（第四部分·第 II 季） | Hardcore 03-26 至 04-18；Play-off 04-16、17、18 | Play-off 三日 3 条 YouTube 已核验；资格/小组赛尚未收齐 |
| 2026 | Лига Блиц Поинт, Часть 4 — Сезон III（第四部分·第 III 季） | 已核验 Play-off 07-08、09、10 | Play-off 三日 3 条 YouTube 已核验；资格/小组赛尚未收齐 |
| 2026 | Финальный турнир Лиги Блиц Поинт, Часть 4 / Tanks Blitz × RuStore: Финал Блиц Поинта | 已核验 09-02、03、04 | 三日 3 条 YouTube 已核验，保留年度总决赛原名 |

赛事依据：[Part 3 Season III 官方文](https://tanksblitz.ru/ru/news/tournaments/blitz-point-part-3-season-3/)、[Part 3 Season IV 官方文](https://tanksblitz.ru/ru/news/tournaments/blitz-point-part-3-season-4/)、[Season IV Hardcore 详细赛程](https://tanksblitz.ru/ru/content/blitz-point-part-3-season-4-hardcore/)、[Part 4 Season I 官方文](https://tanksblitz.ru/ru/news/tournaments/blitz-point-part-4-season-1/)、[Part 4 Season II 官方文](https://tanksblitz.ru/ru/news/tournaments/blitz-point-part-4-season-2/)。Part 4 官方规则明确三个季赛加年度总决赛，见 [Part 4 总览](https://tanksblitz.ru/ru/news/tournaments/blitz-point-p4/)；这不等同于春夏秋冬四个官方赛季。

### Lesta 已核验 YouTube 逐条清单

所有条目作者：**Tanks Blitz. Официальный канал**；频道 ID：`UCrh8Fd_QKmzhv4lhrS-k4sQ`。时长取 YouTube 视频元数据；全长直播候选，不是花絮剪辑。`|` 在表格中以 HTML 实体显示，JSON 中保存原文。

| 直播日期 | 原赛事名 | 阶段 | 完整视频原标题与链接 | 时长 |
| --- | --- | --- | --- | --- |
| 2026-01-17 | Part 4 Season I（跨年） | Play-off Final | [Плей-офф Сезона I Лиги Блиц Поинт. Финал](https://www.youtube.com/watch?v=YvJe9n4L5Aw) | 5:06:05 |
| 2026-04-16 | Part 4 Season II | Play-off Day 1 | [Турнир Лига Блиц Поинт 🏆 2 Сезон Плей-офф День 1 в Tanks Blitz](https://www.youtube.com/watch?v=ZSaT-v0up-U) | 5:22:12 |
| 2026-04-17 | Part 4 Season II | Play-off Day 2 | [Плей-офф Сезона II Лиги Блиц Поинт. День 2](https://www.youtube.com/watch?v=1sby2w_ML2s) | 5:49:50 |
| 2026-04-18 | Part 4 Season II | Play-off Grand Final | [Плей-офф Сезона II Лиги Блиц Поинт. ГРАНД-ФИНАЛ](https://www.youtube.com/watch?v=khGt6Bfj8Zw) | 4:29:15 |
| 2026-07-08 | Part 4 Season III | Play-off Day 1 | [🔥 ПЛЕЙ-ОФФ НАЧИНАЕТСЯ &#124; Лига Блиц Поинт, Хардкор &#124; @KavayMan, @kastettv808 и @nYJI9_TV](https://www.youtube.com/watch?v=2P0V3QLrl_Y) | 5:01:20 |
| 2026-07-09 | Part 4 Season III | Play-off Day 2 | [🎸 ХАРДКОР ПРОДОЛЖАЕТСЯ &#124; День 2 &#124; Лига Блиц Поинт, Хардкор &#124; @KavayMan, @kastettv808 и @nYJI9_TV](https://www.youtube.com/watch?v=ozJ8NAVw5w4) | 5:28:52 |
| 2026-07-10 | Part 4 Season III | Play-off Day 3 | [🤘 РОЖДЕНИЕ ЛЕГЕНД &#124; День 3 &#124; Лига Блиц Поинт, Хардкор &#124; @KavayMan, @kastettv808 и @nYJI9_TV](https://www.youtube.com/watch?v=DApGlNljg60) | 4:35:31 |
| 2026-09-02 | Part 4 年度总决赛 | Final Day 1 | [ПУТЬ К ВЕРШИНЕ &#124; Tanks Blitz × RuStore: Финал Блиц Поинта &#124; @KavayMan, @kastettv808  и @MEFODY](https://www.youtube.com/watch?v=DCje07J9lZA) | 5:35:55 |
| 2026-09-03 | Part 4 年度总决赛 | Final Day 2 | [БЕЗ ПРАВА НА ОШИБКУ &#124; Tanks Blitz × RuStore: Финал Блиц Поинта &#124; @kastettv808, @MEFODY и @KavayMan](https://www.youtube.com/watch?v=07hX8GhBmKg) | 5:50:35 |
| 2026-09-04 | Part 4 年度总决赛 | Final Day 3 | [КТО СТАНЕТ ЛЕГЕНДОЙ? &#124; Tanks Blitz × RuStore: Финал Блиц Поинта &#124; @KavayMan, @kastettv808 и @MEFODY](https://www.youtube.com/watch?v=xAWKGZ2dAts) | 5:17:35 |

9 月赛事保留 Part 4 年度总决赛原名。7 月第一日视频简介明确说“第三季”，并非只凭月份猜测 Season III。跨年 Season I 的直播索引年份为 2026，同时保留 2025-12→2026-01 时间范围。

### Lesta 其他官方平台证据及排除项

- 2026-01-15、16、17 的官方 VK 全长流列于 [官方回放目录](https://live.vkvideo.ru/tanks_blitz/record/d04191a5-a128-44f7-b10f-f387ab3b8a7c/records)。[官方 Telegram 2022 号帖](https://t.me/tanks_blitz_official/2022)（[公开上下文](https://t.me/s/tanks_blitz_official?before=2041)）明确 01-17 因 VK 故障增加 YouTube，链接指向 `YvJe9n4L5Aw`。前两日不伪造 YouTube 地址。
- 2025-09-13、14 官方 VK 长回放（约 7:38、7:56）可在 [官方历史目录](https://live.vkvideo.ru/tanks_blitz/record/1cf80138-9bd2-4ee9-9374-539a99bafbda/records) 核对。此处目录链接只是回放存在/日期证据，尚非整理完成的逐视频导入清单。
- **排除：Межсезонный турнир Лиги Блиц Поинт, Часть 3（休赛季锦标赛）**。2025-02-17、18 小组，19 最后机会，21 Play-off，22 Grand Final 的官方 VK 存档可见于上述历史目录，但这是官方明确的休赛季，不按 2 月改装成冬季赛。[官方规则 PDF](https://cdn-ptl-media.tanksblitz.ru/media/filer_public/images/ЛИГА_БЛИЦ_ПОИНТ_ЧАСТЬ_3_МЕЖСЕЗОННЫЙ_ТУРНИР.pdf) 与 [Part 3 总览](https://tanksblitz.ru/ru/news/tournaments/blitz-point-p3/) 可交叉核对。
- **排除：AppGallery MASTERS WAY** 候选 [Grand Final](https://www.youtube.com/watch?v=WawhnR4Kc94)、[Play-off Day 2](https://www.youtube.com/watch?v=jdRbKGaD_XA)：核对真实直播日期分别是 **2024-07-21、2024-07-20**，不属于本次 2025–2026。不能因为含 MASTERS 就加入近两年。
- **排除：** 开发者交流、生日/周年、Razraboynya、幕后花絮和赛事预告；如 [2025-09-05 版本/赛事预告直播](https://www.youtube.com/watch?v=HBo627WCb38) 与 [2025-09-29 LAN 幕后视频](https://www.youtube.com/watch?v=VJQWiXxPq-o)。本轮没有把 Leader Competition/Arena 当季赛。

## CN：官方 B 站原赛事名与日期

CN 与 APAC 是不同服务器；中文解说国际赛不等于 CN 比赛。按用户补充，CN 使用官方 B 站回放，无需寻找 YouTube 替代。

| 年份 | 原赛事名 | 日期/时间范围证据 | 状态 |
| --- | --- | --- | --- |
| 2025 | 2025春季联赛 | 官方 B 站回放上传 2025-07-04；该上传日不是比赛日 | 官方完整六分 P 赛后系列已发现；实际赛日待补 |
| 2025 | 2025夏季联赛 | 冠军赛 2025-08-22、23、24；四强直播 08-23、24；官方 B 站回放上传索引 09-07 | 官方同名回放约 4:05:45，直链待补 |
| 2025 | 2025战火杯 | 正赛线上 2025-12-05、06、07，线下 12-20；Day 3 合集上传 12-08 | Day 3 三分 P 已发现；其他比赛日直链待补 |
| 2026 | 2026春季赛 | B 站索引显示官方回放上传 2026-06-08，约 4:34:58；比赛日待核实 | 官方账号索引有回放，直链待补 |
| 2026 | 2026夏季赛 | 冠军赛 2026-08-15、21、22；官方 B 站索引回放上传 08-26，约 7:10:42 | 本土公告/官方账号索引支持；直链待补 |

### CN 已核验官方 B 站分场回放

[《坦克世界闪击战》2025春季联赛赛事回放](https://www.bilibili.com/video/BV1L53LzEES6/)：作者“网易坦克世界闪击战”；发布于 2025-07-04 15:02:38；页面列出六个分 P。其性质是完整对阵的赛后分场合集，不能声称是连续两日原始直播：

| 分 P | 原标题 | 直链 | 时长 |
| --- | --- | --- | --- |
| 1 | 胜者组第一轮 CHRD VS -ACE- | [P1](https://www.bilibili.com/video/BV1L53LzEES6/?p=1) | 35:42 |
| 2 | 胜者组第一轮 IMGO- VS KSR | [P2](https://www.bilibili.com/video/BV1L53LzEES6/?p=2) | 37:33 |
| 3 | 败者组第一轮 CHRD VS IMGO- | [P3](https://www.bilibili.com/video/BV1L53LzEES6/?p=3) | 30:03 |
| 4 | 胜者组决赛 KSR VS -ACE- | [P4](https://www.bilibili.com/video/BV1L53LzEES6/?p=4) | 41:17 |
| 5 | 败者组决赛 CHRD VS -ACE- | [P5](https://www.bilibili.com/video/BV1L53LzEES6/?p=5) | 53:44 |
| 6 | 总决赛 CHRD VS KSR | [P6](https://www.bilibili.com/video/BV1L53LzEES6/?p=6) | 1:18:49 |

[2025 战火杯 Day 3 四强合集](https://www.bilibili.com/video/BV18j2CBWEMo/)：作者“网易坦克世界闪击战”；页面记录上传 2025-12-08。主代理读取官方视频页面并核对以下三分 P；本代理直访返回 412，采用主代理共享的已核验页面证据。按线上 12-05/06/07 赛程，Day 3 对应 12-07；该日期是赛程推定，未取得视频元数据中的直播起始时间，JSON 时间仍留空。

| 分 P | 对阵原题 | 直链 | 时长 |
| --- | --- | --- | --- |
| 1 | CHRD VS -ACE- | [P1](https://www.bilibili.com/video/BV18j2CBWEMo/?p=1) | 47:41 |
| 2 | KSR VS -ACE- | [P2](https://www.bilibili.com/video/BV18j2CBWEMo/?p=2) | 39:10 |
| 3 | Ru7K1 VS KSR | [P3](https://www.bilibili.com/video/BV18j2CBWEMo/?p=3) | 45:34 |

其他 CN 证据：

- [4399 国服官方公告：2025 夏赛](https://bbs.4399.cn/thread-view-tid-50202857)，2025-08-14，明确比赛/直播日期与官方账号；[2025 战火杯正赛公告](https://bbs.4399.cn/thread-view-tid-51266383)，2025-11-20，明确 12 月赛程。
- [2026 夏赛公告官方合作专区转载](https://www.gaoshouyou.com/zhuanqu/980312.html)，页面署“来自：坦克世界闪击战官方”，2026-08-12。属于官方内容的转载证据，不等同网易原站直接采集。
- [网易官方 App Store 历史更新](https://apps.apple.com/cn/app/id1294541784)，有 2025 春/夏与 2026 春/夏赛事原名；可佐证赛事存在，不足以确定单场赛日。
- [B 站官方账号索引](https://search.bilibili.com/all?keyword=网易坦克世界闪击战) 可见“2026夏季赛回放”；[联赛索引](https://search.bilibili.com/all?keyword=WOTB联赛) 可见“2025夏季联赛赛事回放”；[2026春季赛回放索引](https://search.bilibili.com/all?keyword=战舰世界闪电战) 可见官方标题/时长/06-08。这些是发现线索，不可作视频直链导入。直访 B 站搜索遭 HTTP 412/验证页，未绕过验证或猜 BV 号。

## 覆盖缺口与入库前复核

1. 所有赛事沿用官方原名，不提供月份→春夏秋冬映射；跨年 Season I 记录 2025-12-22→2026-01-17。
2. CN 2025 春赛六分 P 比赛日未知；战火杯 Day 3 赛日由赛程推定为 12-07。JSON `startTimestamp` 均留空，上传日期独立记录。
3. CN 2025 夏、2026 春/夏已有官方账号、回放标题、长时长与上传日期索引线索，但 BV 直链未提取。直访页面/API 遭 412/验证页，浏览器初始化超时；未绕过验证或猜 BV 号。2025 战火杯其他比赛日直链尚缺。
4. Lesta 2025 与小组/资格阶段未收齐；2026 Season I 前两日仅找到官方 VK，官方公告解释 01-17 增加 YouTube 流。其余 9 条覆盖 2026 Season II、III、年度总决赛三日主直播。
5. 缺失阶段/年份保留缺口，不用 2024 Masters、国际 APAC 中文流、短集锦或明确休赛季填充。仅人工审阅候选，未向生产写入数据。
