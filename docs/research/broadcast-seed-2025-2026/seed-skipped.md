# 初始化数据筛选与暂缓清单

> 本文记录 V40 的历史筛选结果。后续用户允许每条直播确认一场两队、小组号选填；V43 已从这些候选中继续新增 71 条，见 [当前核验快照](seed-ready-2025-2026-verified.json) 与 [复核说明](2026-recheck.md)。下列 281 / 271 是当时核验进度，不是当前缺失数量。

核对日：2026-10-18（Asia/Hong_Kong）。原审阅清单 284 条，本次初始化 3 条，暂缓 281 条。没有导入生产数据库。

按用户选择保留现有规则：只导入比赛日、具体对阵及阶段均有依据的分场；不把上传日当比赛日，不从整日直播猜一组队伍，不按月份改写赛事原名。

## 本次可入库范围

- CN 2025 战火杯 Day 3 四强官方分 P：3 条，实际比赛日 2025-12-07，`dayNumber=3`。
- 日期由官方正赛赛程（12/5、12/6、12/7）和官方视频标题 Day 3 共同确定，非 12/8 的上传时间。
- 官方视频：[网易坦克世界闪击战 Day 3 四强合集](https://www.bilibili.com/video/BV18j2CBWEMo/)。
- 官方赛程：[2025 战火杯正赛公告](https://bbs.4399.cn/thread-view-tid-51266383)。
- `OBSERVER` 表示官方解说观战录制；两队按官方分 P 标题顺序保存，不声称是第一队的选手 POV。
- 三条归于同一个四强根节点的默认分组 `1 / DEFAULT`，是目录默认收纳，不宣称具体胜者组/败者组；原标题未标明胜败组时不猜。
- 季赛开赛日期选填，先留空：12/5 是冠军赛阶段开始日，并非整个战火杯开始日。V40 快照中的英文 `Zhanhuo Cup` 为当时的编辑译名；后续 V41 按网易官方海报纠正默认名称为 `Blitz Professional Cup (BPC)`，俄文留空。

## 暂缓原因统计

| 原因 | 数量 |
| --- | ---: |
| 单场对阵与阶段已知，但未确认逐场比赛日/赛事第几天 | 6 |
| 链接失效或须登录，跳过 | 3 |
| 上一轮尚未完成逐条结构化核验；需提取标题、简介及章节中的对阵和阶段线索 | 271 |
| APAC 标题与 EU 简介冲突，赛区待核 | 1 |

“271 条暂缓”是上一轮核验进度，不表示这些视频未标队伍或阶段；已有标题/简介线索必须继续提取。可打开的链接不等于已具备入库所需的比赛元数据。此表的“暂缓”不表示视频不存在或不能播放；后补具体日期、对阵、阶段后可继续录入。2025 春季六个分 P 已知对阵，但现有线索只将四强/决赛限定在 6/14–15，未取得逐轮官方日程，因此六条全部暂缓。

## 逐条暂缓

| 区服 | 年份 | 原赛事名 | 原标题/链接 | 原因 |
| --- | --- | --- | --- | --- |
| CN | 2025 | 2025春季联赛 | [胜者组第一轮 CHRD VS -ACE-](https://www.bilibili.com/video/BV1L53LzEES6/?p=1) | 单场对阵与阶段已知，但未确认逐场比赛日/赛事第几天 |
| CN | 2025 | 2025春季联赛 | [胜者组第一轮 IMGO- VS KSR](https://www.bilibili.com/video/BV1L53LzEES6/?p=2) | 单场对阵与阶段已知，但未确认逐场比赛日/赛事第几天 |
| CN | 2025 | 2025春季联赛 | [败者组第一轮 CHRD VS IMGO-](https://www.bilibili.com/video/BV1L53LzEES6/?p=3) | 单场对阵与阶段已知，但未确认逐场比赛日/赛事第几天 |
| CN | 2025 | 2025春季联赛 | [胜者组决赛 KSR VS -ACE-](https://www.bilibili.com/video/BV1L53LzEES6/?p=4) | 单场对阵与阶段已知，但未确认逐场比赛日/赛事第几天 |
| CN | 2025 | 2025春季联赛 | [败者组决赛 CHRD VS -ACE-](https://www.bilibili.com/video/BV1L53LzEES6/?p=5) | 单场对阵与阶段已知，但未确认逐场比赛日/赛事第几天 |
| CN | 2025 | 2025春季联赛 | [总决赛 CHRD VS KSR](https://www.bilibili.com/video/BV1L53LzEES6/?p=6) | 单场对阵与阶段已知，但未确认逐场比赛日/赛事第几天 |
| APAC | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup Pro league APAC D/4](https://www.youtube.com/watch?v=mucRpffaHSA) | 链接失效或须登录，跳过 |
| APAC | 2025 | Blitz Masters: New Horizons | [💥ASIA💥Prove Your Skill #1💥DAY-3💥 #BlitzMasterNewHorizons](https://www.youtube.com/watch?v=s1TUiB7oAgA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2025 | Blitz Masters: New Horizons | [💥ASIA💥Prove Your Skill #2💥DAY-3💥 #BlitzMasterNewHorizons](https://www.youtube.com/watch?v=rM1wLYLEbPI) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2025 | Blitz Masters: New Horizons | [APAC PRO Tournament - RR 4/4](https://www.youtube.com/watch?v=lClC1vDrwEo) | APAC 标题与 EU 简介冲突，赛区待核 |
| APAC | 2025 | Blitz Masters: New Horizons | [World of Tanks Blitz - Blitz Masters - Final Stages - Day 1 - APAC](https://www.youtube.com/watch?v=kcChHtfamxI) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2025 | Blitz Masters: New Horizons | [World of Tanks Blitz - Blitz Masters - Final Stages - Day 2 - APAC](https://www.youtube.com/watch?v=wVUQW5Acf74) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2025 | Blitz Diamond Cup | [World of Tanks Blitz - Blitz Diamond Cup - Final Stages - Day 1 - APAC](https://www.youtube.com/watch?v=Wsp8oofXTBU) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2025 | Blitz Diamond Cup | [💥ФИНАЛ💥День 2 "Азия" (APAC)💥BLITZ DIAMOND CUP в WoT Blitz 2025 &#124; WOT-GSN](https://www.youtube.com/watch?v=dzX3naDgcRQ) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2025 | Blitz Diamond Cup | [World of Tanks Blitz - Blitz Diamond Cup - Final Stages - Day 2 - APAC](https://www.youtube.com/watch?v=ohIKq1cXBkw) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2025 | Blitz Diamond Cup | [ГРАНД-ФІНАЛ Азія / ТУРНІР Blitz Diamond Cup 🔥 WoT Blitz](https://www.youtube.com/watch?v=IFDu2z8sV3E) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2025 | Blitz Diamond Cup | [💎BLITZ DIAMOND CUP💎APAC💎GRAND FINAL💎](https://www.youtube.com/watch?v=Gunv9JrYb1M) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Spring Games | [World of Tanks Blitz - Spring Season - Round Robin - Day 4 - APAC](https://www.youtube.com/watch?v=pkD9igJiOlg) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Spring Games | [World of Tanks Blitz - Spring Season - Double Elimination - Day 1 - APAC](https://www.youtube.com/watch?v=PetG1HegBTI) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Spring Games | [WotB - Spring Season - Double Elimination - Day 2 - APAC](https://www.youtube.com/watch?v=4hShvJ4Rc-Q) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Spring Games | [World of Tanks Blitz - Spring Season - Double Elimination - Day 2 - APAC](https://www.youtube.com/watch?v=6a47CV6v1Fs) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Spring Games | [World Of Tanks Blitz &#124;&#124; REQM &#124;&#124;  Top4 stage Day 2](https://www.youtube.com/watch?v=reSgKpylUwE) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Spring Games | [2026 3月25日 spring Games Double Elimination Day ２ FINAL #worldoftanksblitz　＃ワールドオブタンクスブリッツ](https://www.youtube.com/watch?v=KwBzUqpky_E) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Blitz Masters: Legacy | [World of Tanks Blitz - Blitz Masters Legacy - Qualifier 2 - Day 2 - APAC](https://www.youtube.com/watch?v=NgXrrZNskdw) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Blitz Masters: Legacy | [WoT Blitz APAC Blitz Masters: Legacy PYS #2 - Day 3!](https://www.youtube.com/watch?v=lr97n0p3_t4) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Blitz Masters: Legacy | [World of Tanks Blitz - Blitz Masters Legacy - Qualifier 2 - Day 3 - APAC](https://www.youtube.com/watch?v=rLX_Irfmo7E) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Blitz Masters: Legacy | [WoT Blitz APAC Blitz Masters: Legacy PYS #3 - Day 3!](https://www.youtube.com/watch?v=AZOCvrJMO_U) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Blitz Masters: Legacy | [World of Tanks Blitz - Blitz Masters Legacy - Round Robin - Day 1 - APAC](https://www.youtube.com/watch?v=0_rdTdoxajI) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Blitz Masters: Legacy | [World of Tanks Blitz - Blitz Masters Legacy - Round Robin - Day 2 - APAC](https://www.youtube.com/watch?v=kG-523uQrFA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Blitz Masters: Legacy | [World of Tanks Blitz - Blitz Masters Legacy - Round Robin - Day 3 - APAC](https://www.youtube.com/watch?v=gWCVlRx5KWo) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Blitz Masters: Legacy | [World of Tanks Blitz - Blitz Masters Legacy - Round Robin - Day 4 - APAC](https://www.youtube.com/watch?v=s4wOu77kQyI) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Blitz Masters: Legacy | [WoT Blitz. Blitz Masters: Legacy. APAC Day 1 Double Elimination](https://www.youtube.com/watch?v=QdWSCdplcII) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Blitz Masters: Legacy | [WoT Blitz. Blitz Masters: Legacy. APAC Day 2 Double Elimination](https://www.youtube.com/watch?v=p2UIBk6qu5Y) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Blitz Masters: Legacy | [World Of Tanks Blitz &#124;&#124; REQM &#124;&#124;  GRAND FINALS!](https://www.youtube.com/watch?v=sOj19MwBReQ) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [2026年9月15日　AUTUMN GAMES 2026　PYS#1 day4#wotblitz #worldoftanksblitz　＃ワールドオブタンクスブリッツ](https://www.youtube.com/watch?v=CA3xTtw_-II) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [AUTUMN GAMES 2026 &#124; APAC &#124; PYS 2 DAY 2](https://www.youtube.com/watch?v=BjfwRjdwhp0) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [2026年9月18日　AUTUMN GAMES 2026　PYS#2 day2#wotblitz #worldoftanksblitz　＃ワールドオブタンクスブリッツ](https://www.youtube.com/watch?v=rvAJlyxOKTQ) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [AUTUMN GAMES 2026 &#124; APAC &#124; PYS 2 DAY 3](https://www.youtube.com/watch?v=1b4gAn9oYd0) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [AUTUMN GAMES 2026 &#124; APAC &#124; PYS 3 DAY 3 &#124; BP GIVEAWAY](https://www.youtube.com/watch?v=uEWa63B-Xoo) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [2026年9月25日　AUTUMN GAMES 2026　PYS#3 day3#wotblitz #worldoftanksblitz　＃ワールドオブタンクスブリッツ](https://www.youtube.com/watch?v=Imzi8R7gSIo) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [Wot Blitz autumn games 2026 Regional Pros --DAY 1 [ENG]](https://www.youtube.com/watch?v=WC_jfX8QfOI) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [Wot Blitz autumn games 2026 Regional Pros --DAY 2 [ENG]](https://www.youtube.com/watch?v=LkFUc5-0z4E) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [Wot Blitz autumn games 2026 Regional Pros --DAY 3 [ENG] Battlepass Giveaway &#124;](https://www.youtube.com/watch?v=mvTMLVSg4Po) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [World of Tanks Blitz - Autumn Games - Round Robin - Day 4 - APAC](https://www.youtube.com/watch?v=rFGMccNnAM0) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [WoT Blitz. Autumn Games. APAC TOP 4](https://www.youtube.com/watch?v=Vh89K143B4k) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [Wot Blitz autumn games 2026 APAC TOP 4 DAY 1 [ENG]](https://www.youtube.com/watch?v=yOpc-sG7o4k) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [WoT Blitz. Autumn Games. APAC TOP 3](https://www.youtube.com/watch?v=Lo9JZspuPr4) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [Autumn Games APAC. Top 4 - WoTBlitz Live 🔴](https://www.youtube.com/watch?v=yhhuKwTyHx8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [Wot Blitz autumn games 2026 APAC TOP 4 DAY 2 [ENG]](https://www.youtube.com/watch?v=FMmyzEl16_o) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [2026年10月11日　AUTUMN GAMES 2026　Regional Pros Playoffs — Day 2#worldoftanksblitz　＃ワールドオブタンクスブリッツ](https://www.youtube.com/watch?v=FrefK25xhEk) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| APAC | 2026 | Autumn Games | [Wot Blitz autumn games 2026 APAC LEC DAY 2 [ENG]](https://www.youtube.com/watch?v=wadRjecn53o) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Masters: New Horizons | [Blitz Masters New Horizons NA Qualifiers - PYS #1, Day 2 &#124;&#124; World of Tanks Blitz Winter 2025](https://www.youtube.com/watch?v=_5S-gEx2baM) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Masters: New Horizons | [Blitz Masters New Horizons NA Qualifiers - PYS #1, Day 3 &#124;&#124; World of Tanks Blitz Winter 2025](https://www.youtube.com/watch?v=QiWkk9ESIQo) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Masters: New Horizons | [Blitz Masters New Horizons NA Qualifiers - PYS #2, Day 2 &#124;&#124; World of Tanks Blitz Winter 2025](https://www.youtube.com/watch?v=FJPVlBaP3Ds) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Masters: New Horizons | [Blitz Masters 2025 - Clasificatorias 2 &#124; Día 3 en Acción](https://www.youtube.com/watch?v=F7sidK-rk9Y) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Masters: New Horizons | [Blitz Masters New Horizons NA Qualifiers - PYS #2, Day 3 &#124;&#124; World of Tanks Blitz Winter 2025](https://www.youtube.com/watch?v=VfiLWuFyYuk) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Masters: New Horizons | [Blitz Masters New Horizons NA Qualifiers - PYS #3, Day 2 &#124;&#124; World of Tanks Blitz Winter 2025](https://www.youtube.com/watch?v=4LwxguHEezA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Masters: New Horizons | [Blitz Masters New Horizons NA Qualifiers - PYS #3, Day 3 &#124;&#124; World of Tanks Blitz Winter 2025](https://www.youtube.com/watch?v=pmn1Gs-CGvI) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Masters: New Horizons | [Blitz Masters New Horizons NA Professionals - Round Robin, Day 1 &#124;&#124; World of Tanks Blitz Winter 2025](https://www.youtube.com/watch?v=khq5DTpgfCc) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Masters: New Horizons | [Blitz Masters New Horizons NA Professionals - Round Robin, Day 2 &#124;&#124; World of Tanks Blitz Winter 2025](https://www.youtube.com/watch?v=d-ECb074ecs) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Masters: New Horizons | [Blitz Masters New Horizons NA Professionals - Round Robin, Day 4 &#124;&#124; World of Tanks Blitz Winter 2025](https://www.youtube.com/watch?v=cAJdsPKb9n0) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Masters: New Horizons | [Blitz Masters New Horizons NA Professionals - Round Robin, Day 4 &#124;&#124; World of Tanks Blitz Winter 2025](https://www.youtube.com/watch?v=nLFGB9E9GP8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Masters: New Horizons | [Blitz Masters: New Horizons NA Challengers - Final Stage, Day 1 &#124; Player POV](https://www.youtube.com/watch?v=ggnn-fDINLA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Masters: New Horizons | [Blitz Masters New Horizons NA - Top 4 &#124;&#124; World of Tanks Blitz Winter 2025](https://www.youtube.com/watch?v=UgaWmr4qJuA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Masters: New Horizons | [Blitz Masters New Horizons NA - Grand Finals &#124;&#124; World of Tanks Blitz Winter 2025](https://www.youtube.com/watch?v=2Te4Q2hwn7g) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Masters: New Horizons | [Torneo Blitz Masters 2025 La Gran final](https://www.youtube.com/watch?v=1rPFxY60wXs) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup NA Qualifiers - PYS #1, Day 2 &#124;&#124; World of Tanks Blitz Summer 2025](https://www.youtube.com/watch?v=15svRl8uJk0) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup PYS 1 Day 2 &#124; Battle Pass + Fan Container Giveaways](https://www.youtube.com/watch?v=BIapbsxbcwE) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [PYS #1 Day 2 Origin POV Blitz Diamond Cup Qualifiers NA](https://www.youtube.com/watch?v=ICJtIVlbCBQ) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup PYS 2 Day 2 &#124; Battle Pass + Fan Container Giveaways](https://www.youtube.com/watch?v=1JyuFdMHgE8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup NA Qualifiers - PYS #2, Day 2 &#124;&#124; World of Tanks Blitz Summer 2025](https://www.youtube.com/watch?v=gzqtJi66QOM) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup NA Qualifiers - PYS #3, Day 2 &#124;&#124; World of Tanks Blitz Summer 2025](https://www.youtube.com/watch?v=UDa5yIwKF_w) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup PYS 4 Day 2 &#124; Battle Pass + Fan Container Giveaways](https://www.youtube.com/watch?v=lx7dzipiWDk) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup NA Qualifiers - PYS #4, Day 2 &#124;&#124; World of Tanks Blitz Summer 2025](https://www.youtube.com/watch?v=YCkxR9nSg8E) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [LAST DAY TO QUALIFY! Blitz Diamond Cup Qualifiers Origin POV PYS #4 Day 2 NA](https://www.youtube.com/watch?v=NTUUyme8N9c) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup NA Professionals - Round Robin, Day 1 &#124;&#124; World of Tanks Blitz Summer 2025](https://www.youtube.com/watch?v=Fv5auj_Z-J0) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup NA Professionals - Round Robin, Day 2 &#124;&#124; World of Tanks Blitz Summer 2025](https://www.youtube.com/watch?v=zKKLx8VE0Ks) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup NA Professionals - Round Robin, Day 3 &#124;&#124; World of Tanks Blitz Summer 2025](https://www.youtube.com/watch?v=W3If_WF9lHY) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup NA Professionals - Round Robin, Day 4 &#124;&#124; World of Tanks Blitz Summer 2025](https://www.youtube.com/watch?v=eN_LZTbSKLg) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup NA Professionals - Top 6, Day 1 &#124;&#124; World of Tanks Blitz Summer 2025](https://www.youtube.com/watch?v=d7CluvDSMIU) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup Top 6 Day 2 &#124; -_X/REGI/APX &#124; Battle Pass + Fan Container Giveaways](https://www.youtube.com/watch?v=425kzgiiN4Q) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup NA Professionals - Top 6, Day 2 &#124;&#124; World of Tanks Blitz Summer 2025](https://www.youtube.com/watch?v=eg0X8HBBrac) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup NA - Top 4 &#124;&#124; World of Tanks Blitz Summer 2025](https://www.youtube.com/watch?v=43apXqw5hh8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup NA Top 4 &#124; -_X / APX / JKR / OBLVN &#124; North America 2025](https://www.youtube.com/watch?v=EEPbxaA4C54) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [ГРАНД-ФІНАЛ Америка / ТУРНІР Blitz Diamond Cup 🔥 WoT Blitz](https://www.youtube.com/watch?v=9kjFrN1bwdw) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup NA - Grand Finals &#124;&#124; World of Tanks Blitz Summer 2025](https://www.youtube.com/watch?v=I2QqLN2Vtis) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Spring Games | [Spring Games NA Qualifiers - PYS #1, Day 2 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=0wHkXC1Bhwk) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Spring Games | [Spring Games NA Qualifiers - PYS #1, Day 3 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=JIUaDNvw-jA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Spring Games | [🇪🇸🏆 PYS 1 Spring Games 2026 &#124; NA Día 3/3 &#124; Torneo Wot Blitz en Español](https://www.youtube.com/watch?v=pAUiqWgkfiA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Spring Games | [Spring Games NA Qualifiers - PYS #2, Day 2 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=4CDf0XHULuE) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Spring Games | [QUALFIERS! Spring Games NA PYS 2 Day 2](https://www.youtube.com/watch?v=DpGoNUnVFYA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Spring Games | [Spring Games NA Qualifiers - PYS #2, Day 3 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=35yZMufgF3c) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Spring Games | [Spring Games NA Qualifiers - PYS #3, Day 2 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=4ZqA4cN2Xyw) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Spring Games | [Spring Games NA Qualifiers - PYS #3, Day 3 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=4QoWVCFbRC8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Spring Games | [Spring Games NA Professionals - Round Robin, Day 1 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=sYURrUAi-oE) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Spring Games | [Spring Games NA Professionals - Round Robin, Day 2 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=R4PsmYso7Gg) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Spring Games | [Spring Games NA Professionals - Round Robin, Day 3 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=B9g0QyNNI7g) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Spring Games | [Spring Games NA Professionals - Round Robin, Day 4 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=CUwK77Vb_sQ) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Spring Games | [Spring Games NA - Top 4 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=bvBbgyFa4PQ) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Spring Games | [Spring Games NA - Grand Finals &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=QBkZvrl5ato) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Spring Games | [🇪🇸🏆 NA Gran Final Spring Games 2026 &#124; Norte América &#124; Torneo Wot Blitz en Español](https://www.youtube.com/watch?v=hVlLISeO-vE) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [Blitz Masters Legacy NA Qualifiers - PYS #1, Day 2 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=eEnGfg68Z1w) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [WoT Blitz NA Blitz Masters: Legacy PYS #1 - Day 3!](https://www.youtube.com/watch?v=xB9onsUVS5E) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [Blitz Masters Legacy NA Qualifiers - PYS #1, Day 3 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=PEmLPwQg9f8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [World of Tanks Blitz- NA &#124;&#124; Blitz Masters Legacy &#124;&#124; PYS 1 Day 3 &#124;&#124;](https://www.youtube.com/watch?v=WIiFUG9SZzM) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [Blitz Masters Legacy NA Qualifiers - PYS #2, Day 2 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=uffJEdEmMsc) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [Blitz Masters: Legacy &#124; PYS 2 Day 3 -_X/PONDA + Upper Bracket &#124; Stream Giveaways!](https://www.youtube.com/watch?v=ddrhpWqhO0I) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [Blitz Masters Legacy NA Qualifiers - PYS #2, Day 3 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=OJcOrd3CPow) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [WoT Blitz NA Blitz Masters: Legacy PYS #2 - Day 3!](https://www.youtube.com/watch?v=cYviLNnLfHs) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [World of Tanks Blitz- NA &#124;&#124; Blitz Masters Legacy &#124;&#124; PYS 2 Day 3 &#124;&#124;](https://www.youtube.com/watch?v=ST9RdWaD7S4) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [Blitz Masters Legacy NA Qualifiers - PYS #3, Day 2 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=1UhnEh4zoT0) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [Blitz Masters: Legacy &#124; PYS 3 Day 3 AUTIS/PONDA + Upper Bracket &#124; Stream Giveaways!](https://www.youtube.com/watch?v=ybroK5QKb3w) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [Blitz Masters Legacy NA Qualifiers - PYS #3, Day 3 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=tAnA2r17LY8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [Blitz Masters Legacy NA Professionals - Round Robin, Day 1 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=v5Wy99iYA2Q) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [Blitz Masters Legacy NA Professionals - Round Robin, Day 2 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=nPW0xtPEWSY) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [Blitz Masters Legacy NA Professionals - Round Robin, Day 3 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=_3jEnONZG2s) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [Blitz Masters Legacy NA Professionals - Round Robin, Day 4 &#124;&#124; World of Tanks Blitz Spring 2026](https://www.youtube.com/watch?v=jNjPG3hIOt0) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [WoT Blitz. Blitz Masters: Legacy. NA Day 1 Double Elimination](https://www.youtube.com/watch?v=a7nYJekObDU) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [WoT Blitz. Blitz Masters: Legacy. NA Day 2 Double Elimination](https://www.youtube.com/watch?v=haxzkQHOYss) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Blitz Masters: Legacy | [Blitz Masters: Legacy NA &#124; Grand Finals &#124; WoTB Summer 2026](https://www.youtube.com/watch?v=jR5Z5bMvOQQ) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Autumn Games 2026 NA - PYS 1 Day 1 &#124; WoT Blitz](https://www.youtube.com/watch?v=G85seerikF4) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Autumn Games 2026 NA - PYS 1 Day 2 - Giveaways &#124; WoT Blitz](https://www.youtube.com/watch?v=IwUTjkpviWs) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Autumn Games 2026 NA - PYS 1 Day 3 - Giveaways &#124; WoT Blitz](https://www.youtube.com/watch?v=Y6V4N7achnE) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [POV - Autumn Games PYS 1 Day 4 &#124; Stream Giveaways + Rewards](https://www.youtube.com/watch?v=WJ6TRqoZXIc) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Korah POV! Autumn Games NA PYS 1 Last Day & Stream Giveaways](https://www.youtube.com/watch?v=FV_knJrTdc4) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Autumn Games 2026 NA - PYS 2 Day 1 - Giveaways &#124; WoT Blitz](https://www.youtube.com/watch?v=FZVqmdPKE4o) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Autumn Games 2026 NA - PYS 2 Day 2 - Giveaways &#124; WoT Blitz](https://www.youtube.com/watch?v=l3fqMiLhQ4Y) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [LAST DAY PYS 2! Autumn Games NA & Stream Giveaways](https://www.youtube.com/watch?v=8eJgPhps_Xw) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Autumn Games 2026 NA - PYS 2 Day 3 - Giveaways &#124; WoT Blitz](https://www.youtube.com/watch?v=7hAf2VOv9IY) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Autumn Games 2026 NA - PYS 3 Day 1 - Giveaways &#124; WoT Blitz](https://www.youtube.com/watch?v=cd0K0WkBkIg) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Autumn Games 2026 NA - PYS 3 Day 2 - Giveaways &#124; WoT Blitz](https://www.youtube.com/watch?v=50aQPEW6mQA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Autumn Games 2026 NA - PYS 3 Day 3 - Giveaways &#124; WoT Blitz](https://www.youtube.com/watch?v=ONZmotp6has) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Autumn Games 2026 NA - Pros Day 1 - Giveaways &#124; WoT Blitz](https://www.youtube.com/watch?v=cECQ9ud--Hc) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Autumn Games 2026 NA - Pros Day 2 - Giveaways &#124; WoT Blitz](https://www.youtube.com/watch?v=kahUTe6DcTA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Autumn Games 2026 NA - Pros Day 3 - Giveaways &#124; WoT Blitz](https://www.youtube.com/watch?v=OabD3MqNjh8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Autumn Games 2026 NA - Pros Day 4 - Giveaways &#124; WoT Blitz](https://www.youtube.com/watch?v=5JGQcijeC4g) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Lower Echlon](https://www.youtube.com/watch?v=wPkQJMo778Y) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [WoT Blitz. Autumn Games. NA Day 1 Double Elimination Top 4](https://www.youtube.com/watch?v=X1f0o05OoyM) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Autumn Games 2026 NA - Pros Finals - Giveaways &#124; WoT Blitz](https://www.youtube.com/watch?v=Ob5AAwDYKic) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [WoT Blitz. Autumn Games. NA Day 2 Final Top 3. Giveaways after each set. By Megalion](https://www.youtube.com/watch?v=QRGPK3fSlYA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Autumn Games 2026 NA - Pros Grand Finals - Giveaways &#124; WoT Blitz](https://www.youtube.com/watch?v=N1mnt_6z7D0) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| NA | 2026 | Autumn Games | [Finals Challengers NA](https://www.youtube.com/watch?v=4wdJk-mKRGk) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [World of Tanks Blitz - Blitz Masters - Qualifier 1, day 3](https://www.youtube.com/watch?v=TUxl6FA6nzE) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [PRO Tournament Qualification - PYS#1 - Day 3/4](https://www.youtube.com/watch?v=jMkmCwl9QFw) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [World of Tanks Blitz - Blitz Masters - Qualifier 1 - Day 4](https://www.youtube.com/watch?v=aQgP0d17e60) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [PRO Tournament Qualification - PYS#1 - Day 4/4](https://www.youtube.com/watch?v=T1LUOIUW3jg) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [World of Tanks Blitz - Blitz Masters - Qualifier 2 - Day 3](https://www.youtube.com/watch?v=04V2KNiQkOc) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [PRO Tournament Qualification - PYS#2 - Day 3/4](https://www.youtube.com/watch?v=lRL7atp9ykE) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [World of Tanks Blitz - Blitz Masters - Qualifier 2 - Day 4](https://www.youtube.com/watch?v=_cg0bbPB7K4) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [PRO Tournament Qualification - PYS#2 - Day 4/4](https://www.youtube.com/watch?v=3w063SXEsi4) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [World of Tanks Blitz - Blitz Masters - Qualifier 3 - Day 3](https://www.youtube.com/watch?v=2WXQPW3hPow) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [Турнир Blitz Masters: New Horizons &#124; Путь мастерства #3 &#124; День 4](https://www.youtube.com/watch?v=L_pe55WT8RA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [World of Tanks Blitz - Blitz Masters - Qualifier 3 - Day 4](https://www.youtube.com/watch?v=xf2GGgQMvxw) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [PRO Tournament Qualification - PYS#3/3 - Day 4/4](https://www.youtube.com/watch?v=11bstePnFTs) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [World of Tanks Blitz - Blitz Masters - Round Robin - Day 1](https://www.youtube.com/watch?v=L2m45TldVTA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [PRO Tournament - RR 1/4](https://www.youtube.com/watch?v=Wq_-S06CR3Y) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [World of Tanks Blitz - Blitz Masters - Round Robin - Day 2](https://www.youtube.com/watch?v=KR_ZtYsi0jI) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [PRO Tournament - RR 2/4](https://www.youtube.com/watch?v=dHX6mkghq4o) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [PRO Tournament - RR 3/4](https://www.youtube.com/watch?v=Zn7hStWf9tI) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [World of Tanks Blitz - Blitz Masters - Round Robin - Day 3](https://www.youtube.com/watch?v=xp395TEid_E) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [World of Tanks Blitz - Blitz Masters - Round Robin - Day 4](https://www.youtube.com/watch?v=Voc0UHRXKNA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [PRO Tournament - RR 4/4](https://www.youtube.com/watch?v=POAyS4AzCso) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [World of Tanks Blitz - Blitz Masters - Final Stages - Day 1](https://www.youtube.com/watch?v=CUO58z3vr9U) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [TOP 4 - PRO Tournament - DE 1/2](https://www.youtube.com/watch?v=ytVp4_Me4pM) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [PROFI TURNIER FINALE &#124; BLITZ MASTERS DEUTSCH (WITH REWARDS)](https://www.youtube.com/watch?v=VWT0AE2RmWc) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [ГРАНД-ФІНАЛ / ТУРНІР Blitz Masters: New Horizons 🔥 WoT Blitz](https://www.youtube.com/watch?v=GU9PXRxLG2I) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [World of Tanks Blitz - Blitz Masters - Final Stages - Day 2](https://www.youtube.com/watch?v=KTFGqgr9ee8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Masters: New Horizons | [GRAND FINALS - PRO Tournament - DE 2/2](https://www.youtube.com/watch?v=Fys8aexb8Qw) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [💥Смотрим Турнир с Наградами за Просмотр ;)💥Blitz Diamond Cup 13.08.2025 в WoT Blitz 2025 &#124; WOT-GSN](https://www.youtube.com/watch?v=vjnmhzrlIV8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [World of Tanks Blitz - Blitz Diamond Cup - Qualifier 1, day 3](https://www.youtube.com/watch?v=PIX0x8Y_o2Q) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [PRO Tournament Qualifier 1/4 #blitzcup](https://www.youtube.com/watch?v=040cYv3cL-I) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [World of Tanks Blitz - Blitz Diamond Cup - Qualifier 2, day 3](https://www.youtube.com/watch?v=u1LzVTutSIc) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [PRO Tournament Qualifier 2/4 #blitzcup](https://www.youtube.com/watch?v=AtXplfV7Qz4) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [World of Tanks Blitz - Blitz Diamond Cup - Qualifier 3, day 3](https://www.youtube.com/watch?v=EwlAhF8XqEc) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [World of Tanks Blitz - Blitz Diamond Cup - Qualifier 4, day 3](https://www.youtube.com/watch?v=zevp8ErQBu8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [💥Смотрим Турнир с Наградами за Просмотр ;)💥Blitz Diamond Cup 25.08.2025 в WoT Blitz 2025 &#124; WOT-GSN](https://www.youtube.com/watch?v=jd6YLGTzNKE) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [PRO Tournament Qualifier 4/4](https://www.youtube.com/watch?v=PP0IGqnk4No) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [World of Tanks Blitz - Blitz Diamond Cup - Round Robin - Round 1 and 2](https://www.youtube.com/watch?v=3owGIRLMsdM) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [PRO Tournament Top 8 RR D1/4](https://www.youtube.com/watch?v=3iLKVGKJgmA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [World of Tanks Blitz - Blitz Diamond Cup - Round Robin - Round 3 and 4](https://www.youtube.com/watch?v=aeXtzIpyXMQ) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [PRO Tournament Top 8 RR D2/4](https://www.youtube.com/watch?v=FHZ9bvEq5EE) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup &#124; Top 16 Finals 1/2 &#124; GIVEAWAYS &#124; 3min delay &#124; GER/DE - World of Tanks Blitz](https://www.youtube.com/watch?v=OyMQG6OR27o) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup EU Challengers Day 2 &#124; Top 12 Stage &#124;](https://www.youtube.com/watch?v=MCuZ8S_tkds) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [LOWER ECHELON CHAMPIONSHIP - IEGOI x -SQN- &#124;&#124; [-POG-] - DZIEŃ 3](https://www.youtube.com/watch?v=2t2PHENfXGo) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [PRO Tournament Top 8 RR D3/4](https://www.youtube.com/watch?v=Gp8ezcK9ur0) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [World of Tanks Blitz - Blitz Diamond Cup - Round Robin - Round 7](https://www.youtube.com/watch?v=RRSFC-CGgbQ) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [PRO Tournament Top 8 RR D4/4](https://www.youtube.com/watch?v=Hmtj0qWVzxA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [PRO Tournament Top 6 DE 1/2](https://www.youtube.com/watch?v=IUt0nTPqjrA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [World of Tanks Blitz - Blitz Diamond Cup - Double Elimination - Day 1](https://www.youtube.com/watch?v=guIa_J5h9bI) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [Blitz Diamond Cup &#124; TOP6 &#124; D2/2 &#124; 3min delay &#124; GER/DE - World of Tanks Blitz](https://www.youtube.com/watch?v=IdlBhevrwTs) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [World of Tanks Blitz - Blitz Diamond Cup - Double Elimination - Day 2](https://www.youtube.com/watch?v=uT5NdwISBGQ) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [PRO Tournament Top 6 DE 2/2](https://www.youtube.com/watch?v=KpYcmkxiP_0) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [LAST CHANCE FOR TOP 4! Blitz Diamond Cup EU Top 5 Elimination Stage](https://www.youtube.com/watch?v=FAzgtcD332k) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [Blitz Diamond Stage 2 Grand Finals](https://www.youtube.com/watch?v=sWWjpHP6gVo) | 链接失效或须登录，跳过 |
| EU | 2025 | Blitz Diamond Cup | [PRO Tournament Top 4 SEMI-FINALS](https://www.youtube.com/watch?v=09hzs65WnLY) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [ГРАНД-ФІНАЛ Європа / ТУРНІР Blitz Diamond Cup 🔥 WoT Blitz](https://www.youtube.com/watch?v=EY3CCRdr4dM) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [BLITZ DIAMOND CUP FINALE &#124; WoT Blitz Deutsch](https://www.youtube.com/watch?v=dS4gSABH1mE) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [GRAND FINALS DAY! Blitz Diamond Cup EU Top 3 Elimination Stage](https://www.youtube.com/watch?v=KKEiEf7ZqPc) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2025 | Blitz Diamond Cup | [PRO Tournament Top 4 GRAND-FINALS](https://www.youtube.com/watch?v=icn_6RdthP8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [🇪🇸🏆 PYS 1 Spring Games 2026 &#124; EU Día 3/3 &#124; Torneo Wot Blitz en Español](https://www.youtube.com/watch?v=W4gU3qO1IQA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [Турнир Spring Games &#124; Путь мастерства #1 &#124; День 4](https://www.youtube.com/watch?v=FXGodwWu1cw) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [Турнир Spring Games &#124; Путь мастерства #2 &#124; День 4](https://www.youtube.com/watch?v=ZcwvTGyUP9M) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [[FR] Spring Games  - PYS 2 -  Jour 4](https://www.youtube.com/watch?v=RRehDFnfXyk) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [[FR] Spring Games  - PYS 3 -  Jour 4 &#124; GR2](https://www.youtube.com/watch?v=oppC9vxR-CQ) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [Prove Your Skill Finals PYS  + 6 Fan Container  2 Battle Pass  Giveaway](https://www.youtube.com/watch?v=clZo0RSJ_f8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [Турнир Spring Games &#124; Путь мастерства #3 &#124; День 4](https://www.youtube.com/watch?v=wfzdpXfBiKY) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [World of Tanks Blitz - Spring Season - Round Robin - Day 1](https://www.youtube.com/watch?v=lGidMRtrk4A) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [World of Tanks Blitz - Spring Season - Round Robin - Day 2](https://www.youtube.com/watch?v=9B4aMM_vsF8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [World of Tanks Blitz - Spring Season - Round Robin - Day 3](https://www.youtube.com/watch?v=z8sN1TA-UPs) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [World of Tanks Blitz - Spring Season - Round Robin - Day 4](https://www.youtube.com/watch?v=jYgbXGol2Js) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [World of Tanks Blitz - Spring Season - Double Elimination - Day 1](https://www.youtube.com/watch?v=uBWcqQDlIK4) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [Турнир Spring Games &#124; Турнир Профессионалов &#124; Финальный этап &#124; День 2](https://www.youtube.com/watch?v=_u3nHqOfX5s) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [🇪🇸🏆 EU Gran Final Spring Games 2026 &#124; Europa &#124; Torneo Wot Blitz en Español](https://www.youtube.com/watch?v=9MCy6iZpu0s) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [[FR] Spring Games  - Finales Professionnelles -  Finales - Jour 2](https://www.youtube.com/watch?v=ceJSSkGUHj4) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [World of Tanks Blitz - Spring Season - Double Elimination - Day 2](https://www.youtube.com/watch?v=zfG1ebtx2bU) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Spring Games | [World Of Tanks Blitz &#124;&#124; EXL &#124;&#124;  Grand Finals](https://www.youtube.com/watch?v=on7JjjO-Uok) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [WOTB BLITZMASTERS pys1 day 4 EU](https://www.youtube.com/watch?v=FB_Z9FFcHHg) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [Турнир Blitz Masters: Legacy &#124; Путь мастерства #1 &#124; День 4](https://www.youtube.com/watch?v=qBqQwnb-CQw) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [PRO Tournament Qualifiers 1/3 #PYS](https://www.youtube.com/watch?v=NcGxESriPII) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [[FR] Blitz Master Legacy  - PYS 1  -  Jour 4](https://www.youtube.com/watch?v=aoUGGvrxrX8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [Турнир Blitz Masters: Legacy &#124; Путь мастерства #2 &#124; День 4](https://www.youtube.com/watch?v=M6F3kmIxGjg) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [[FR] Blitz Master Legacy  - PYS 2  -  Jour 4](https://www.youtube.com/watch?v=rwSYI-gX06g) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [PRO Tournament Qualifiers 2/3 #PYS](https://www.youtube.com/watch?v=9NGhc5o7gsE) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [Blitz Masters: Legacy &#124; PYS2 Finale &#124; WoT Blitz Deutsch](https://www.youtube.com/watch?v=e8HiMNxLRrY) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [Турнир Blitz Masters: Legacy &#124; Путь мастерства #3 &#124; День 4](https://www.youtube.com/watch?v=RKA0U8rzXF0) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [PRO Tournament Qualifiers 3/3 #PYS](https://www.youtube.com/watch?v=IbvD1I-37Tk) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [[FR] Blitz Master Legacy  - PYS 3  -  Jour 4](https://www.youtube.com/watch?v=_G2xLNaSdMU) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [&#124; Dzień 4 &#124; Pys 3 &#124; Blitz Masters: Legacy &#124; Rozdaję przepustkę bojową i kontenery fanowskie!](https://www.youtube.com/watch?v=A00VEudS9wc) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [PRO Tournament Round Robin 1/4](https://www.youtube.com/watch?v=QJnDQzG780A) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [PRO Tournament Round Robin 2/4](https://www.youtube.com/watch?v=9b4bZdbvp0w) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [PRO Tournament Round Robin 3/4](https://www.youtube.com/watch?v=goa99vBAJs0) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [PRO Tournament Round Robin 4/4](https://www.youtube.com/watch?v=pwOTIaXR0dE) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [&#124; FINAŁY &#124; TOP 16 EUROPY &#124; Blitz Masters: Legacy &#124; Rozdaję przepustkę bojową i kontenery fanowskie!](https://www.youtube.com/watch?v=Ov7KUQW93m8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [[FR] Blitz Master Legacy  - Grand Finals - Challenger Tournament](https://www.youtube.com/watch?v=mBvS08q3KSc) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [TOP16 FINALE &#124; Blitz Masters: Legacy &#124; WoT Blitz Deutsch](https://www.youtube.com/watch?v=c8C4-J-4V4g) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [WoT Blitz - Lower Echelon FINALS](https://www.youtube.com/watch?v=1NfzjAcWbzA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [WoT Blitz. Blitz Masters: Legacy. EU Day 1 Double Elimination](https://www.youtube.com/watch?v=ea468wLLh08) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [World Of Tanks Blitz &#124; EU Grand Finals &#124; Blitz Masters Legacy](https://www.youtube.com/watch?v=T_cZ-TG7nQs) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [&#124; FINAŁY &#124; TOP 8  EUROPY &#124; Blitz Masters: Legacy &#124; OGLĄDAJ NA PLATFORMIE DLA NAGRÓD!](https://www.youtube.com/watch?v=uUE_WM0-_AQ) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [[FR] Blitz Master Legacy - Professionals Finals - Jour 2](https://www.youtube.com/watch?v=NJdhxqoNdl8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [Blitz Masters: Legacy. Комментируем финальный день](https://www.youtube.com/watch?v=sKaPpsnzmyg) | 链接失效或须登录，跳过 |
| EU | 2026 | Blitz Masters: Legacy | [BLITZ MASTERS: FINALE &#124; WoT Blitz Deutsch](https://www.youtube.com/watch?v=nJ-_zZCCml8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Blitz Masters: Legacy | [WoT Blitz. Blitz Masters: Legacy. EU Day 2 Double Elimination](https://www.youtube.com/watch?v=n4sQk---85s) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [AUTUMN GAMES 2026 PYS#1 DAY4](https://www.youtube.com/watch?v=YbIa1spp_yE) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [QUALFIERS LAST DAY! Autumn Games EU PYS #1 & Stream Giveaways](https://www.youtube.com/watch?v=foqLQqOPh0E) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [Autumn Games 2026 &#124; DZIEŃ 4 &#124; PYS #1 &#124; ROZDAJĘ NAGRODY!](https://www.youtube.com/watch?v=7MdiaK2_uQM) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [[FR] Autumn Games 2026 - PYS 2 - Jour 3](https://www.youtube.com/watch?v=tGjn4SEOagY) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [AUTUMN GAMES PYS 2 &#124; DAY 4 &#124; 2x BP + CRATES GIVEAWAY! &#124; WORLD OF TANKS BLITZ LIVE](https://www.youtube.com/watch?v=UGtQPlGGHD0) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [LAST DAY PYS 2! Autumn Games EU & Stream Giveaways](https://www.youtube.com/watch?v=BqSvr-hYjqk) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [[FR] Autumn Games 2026 - PYS 2 - Jour 4](https://www.youtube.com/watch?v=oTflbW80sy8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [[FR] Autumn Games 2026 - PYS 3 - Jour 2](https://www.youtube.com/watch?v=wUUGxx9gjIg) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [[FR] Autumn Games 2026 - PYS 3 - Jour 3](https://www.youtube.com/watch?v=ZNJQAMd-pf8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [PROVE YOUR SKILL 3 &#124; DAY 4 &#124;  GIVEAWAY &#124; WORLD OF TANKS BLITZ TOURNAMENT ACTIVE](https://www.youtube.com/watch?v=MVWDYwhJtu8) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [Турнир Autumn Games &#124; Путь мастерства #3 &#124; День 4](https://www.youtube.com/watch?v=09LHv_Hk4VI) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [WotB EU PYS 3 day 4](https://www.youtube.com/watch?v=H2xYQHDOYZo) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [[FR] Autumn Games 2026 - PYS 3 - Jour 4](https://www.youtube.com/watch?v=V6ylTOOp3Ws) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [TORND POV &#124; Prove Your Skill #3 Day 4](https://www.youtube.com/watch?v=skZ5BjbuHE4) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [[FR] Autumn Games 2026 - Finales Professionnelles - J1](https://www.youtube.com/watch?v=YRYjel19CXU) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [[FR] Autumn Games 2026 - Finales Professionnelles - J2](https://www.youtube.com/watch?v=PNOpbbWvDG0) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [World of Tanks Blitz - Autumn Games - Round Robin - Day 3 - EU](https://www.youtube.com/watch?v=nwe7O1SqPVc) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [[FR] Autumn Games 2026 - Finales Professionnelles - J3](https://www.youtube.com/watch?v=op0_WRTJdBk) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [World of Tanks Blitz - Autumn Games - Round Robin - Day 4 - EU](https://www.youtube.com/watch?v=TDcc_8AKpzw) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [[FR] Autumn Games 2026 - Finales Professionnelles - J4](https://www.youtube.com/watch?v=pX5cnfB36po) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [ILLUM POV LOWER ECHELON](https://www.youtube.com/watch?v=ob8_ZeBmbqo) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [WoT Blitz. Autumn Games EU. Top 4](https://www.youtube.com/watch?v=mWNEw1wTG0A) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [TOP 4 AUTUMN GAMES PROFESSIONAL TOURNAMENT &#124; GIVEAWAY! &#124; WOTB 2026 &#124; 2ND STAGE DAY 2](https://www.youtube.com/watch?v=tISW8qtVzAI) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [Турнир Autumn Games &#124; Финальный этап &#124; День 2](https://www.youtube.com/watch?v=HwtHTRndqCY) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [[FR] Autumn Games 2026 - Finales Professionnelles Lower et Grande Finales](https://www.youtube.com/watch?v=DXncD0sLetg) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [WoT Blitz. Autumn Games EU. Top 3 DE](https://www.youtube.com/watch?v=rgO8V0QOc2g) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [🍁2026 AUTUMN GAMES🍁GRAND FINALS🍁WATCH PARTY W/ TEAMMATES🍁](https://www.youtube.com/watch?v=MxMlbXBZPpU) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| EU | 2026 | Autumn Games | [TOP 16 AUTUMN GAMES CHALLENGERSS! &#124; GIVEAWAY! &#124; WOTB 2026 TOURNAMENT &#124; FINALS DAY 2](https://www.youtube.com/watch?v=652Hsfh0YKs) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| LESTA | 2026 | Лига Блиц Поинт, Часть 4 — Сезон I | [Плей-офф Сезона I Лиги Блиц Поинт. Финал](https://www.youtube.com/watch?v=YvJe9n4L5Aw) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| LESTA | 2026 | Лига Блиц Поинт, Часть 4 — Сезон II | [Турнир Лига Блиц Поинт 🏆 2 Сезон Плей-офф День 1 в Tanks Blitz](https://www.youtube.com/watch?v=ZSaT-v0up-U) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| LESTA | 2026 | Лига Блиц Поинт, Часть 4 — Сезон II | [Плей-офф Сезона II Лиги Блиц Поинт. День 2](https://www.youtube.com/watch?v=1sby2w_ML2s) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| LESTA | 2026 | Лига Блиц Поинт, Часть 4 — Сезон II | [Плей-офф Сезона II Лиги Блиц Поинт. ГРАНД-ФИНАЛ](https://www.youtube.com/watch?v=khGt6Bfj8Zw) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| LESTA | 2026 | Лига Блиц Поинт, Часть 4 — Сезон III | [🔥 ПЛЕЙ-ОФФ НАЧИНАЕТСЯ &#124; Лига Блиц Поинт, Хардкор &#124; @KavayMan, @kastettv808 и @nYJI9_TV](https://www.youtube.com/watch?v=2P0V3QLrl_Y) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| LESTA | 2026 | Лига Блиц Поинт, Часть 4 — Сезон III | [🎸 ХАРДКОР ПРОДОЛЖАЕТСЯ &#124; День 2 &#124; Лига Блиц Поинт, Хардкор &#124; @KavayMan, @kastettv808 и @nYJI9_TV](https://www.youtube.com/watch?v=ozJ8NAVw5w4) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| LESTA | 2026 | Лига Блиц Поинт, Часть 4 — Сезон III | [🤘 РОЖДЕНИЕ ЛЕГЕНД &#124; День 3 &#124; Лига Блиц Поинт, Хардкор &#124; @KavayMan, @kastettv808 и @nYJI9_TV](https://www.youtube.com/watch?v=DApGlNljg60) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| LESTA | 2026 | Лига Блиц Поинт, Часть 4 — Финальный турнир (Tanks Blitz × RuStore) | [ПУТЬ К ВЕРШИНЕ &#124; Tanks Blitz × RuStore: Финал Блиц Поинта &#124; @KavayMan, @kastettv808  и @MEFODY](https://www.youtube.com/watch?v=DCje07J9lZA) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| LESTA | 2026 | Лига Блиц Поинт, Часть 4 — Финальный турнир (Tanks Blitz × RuStore) | [БЕЗ ПРАВА НА ОШИБКУ &#124; Tanks Blitz × RuStore: Финал Блиц Поинта &#124; @kastettv808, @MEFODY и @KavayMan](https://www.youtube.com/watch?v=07hX8GhBmKg) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |
| LESTA | 2026 | Лига Блиц Поинт, Часть 4 — Финальный турнир (Tanks Blitz × RuStore) | [КТО СТАНЕТ ЛЕГЕНДОЙ? &#124; Tanks Blitz × RuStore: Финал Блиц Поинта &#124; @KavayMan, @kastettv808 и @MEFODY](https://www.youtube.com/watch?v=xAWKGZ2dAts) | 尚未确证本条覆盖的具体对阵、阶段/组别；整日流不虚填队伍 |

2026-10-18补充：三条B站分P现已通过公开pagelist接口核对标题/时长，逐个playurl接口返回code=0且存在播放地址。未下载/逐分钟观看媒体；原始网页412不再作为视频失效判断。证据记录在seed-ready.json。

初始化复用已有分P的唯一国服2025季赛归属，保留管理员自定义三语名称；已存分P跨多个季赛或区服/年份冲突时整批跳过，不将同一套视频拆到新季赛。无既有分P才按名称查找目标。
