# 2026 回放复核与术语来源

核对日：2026-10-18。对上一轮候选中的 2026 年 172 条重新提取公开元数据；其中 9 条已核实并加入 V43 初始化快照，涵盖 4 个区服赛事，其余 163 条保留待补。没有向生产数据库写入。

| 区服 | 候选数 |
| --- | ---: |
| APAC | 34 |
| EU | 72 |
| NA | 56 |
| Lesta | 10 |

171 条具有明确阶段文字线索；18 条标题或简介出现具体队名，其中 9 条简介直接列出双方对阵。21 条获取到章节，11 条章节含队名候选；与直接线索合并后 28 条有队名线索。章节可能自动生成，不能据其音译直接确认军团名。116 条本轮从公开 watch 页面取到元数据，55 条复用前次 EU 简介，1 条目前为 Private video；补抓章节出现 HTTP 429 后停止，无绕过或媒体下载。置顶评论未获取。

所以先前“271 条暂缓”应理解为未完成逐条结构化核验，不能理解为视频未标明队伍或阶段。阶段明确、对阵完整和可播放是三个独立结论。例子：[EU Spring PYS 1 Day 4](https://www.youtube.com/watch?v=FXGodwWu1cw) 的简介明确 MERCY / AQVA；[EU Autumn 最终阶段 Day 2](https://www.youtube.com/watch?v=HwtHTRndqCY) 明确 KOVA- / BLOVE；[NA Legacy 决赛](https://www.youtube.com/watch?v=jR5Z5bMvOQQ) 写出 JKR / OBLVN，但后续胜者的对手仍应核对。

## 日期口径

原始直播回放优先采用真实直播开始时间（startTimestamp / 直播开始日期），按该区服赛程当地时区取年月日：APAC UTC+8，NA America/Los_Angeles，EU Europe/Berlin，Lesta Europe/Moscow。保留原始带时区时间作为证据，不拿提前创建直播页的日期、上传日期或整个赛事开赛日替代。NA 的直播 UTC 日期通常比当地比赛日大一天；北美和欧洲必须按当日夏令时换算。

赛事 startDate 选填，回放 matchDate 与 dayNumber 必填；两队及阶段等原有约束继续适用。按用户调整后的规则，每条直播只需确认其中一场战斗的两队；组号未知时留空。仅把来源明确的记录纳入初始化快照，不把候选直接发送管理 API。

## 已确认初始化记录

`seed-ready-2026.json` 保存 9 条回放的原赛事名称、UTC 开播时刻、区服当地日期与证据；V43 使用同一快照，按来源视频去重，保留管理员已有配置。8 条 EU 记录的简介明确列出对阵和解说信息；1 条 APAC 记录由用户提供的 10:00 准备房间截图确认 REQM / CHRD、个人视角、第 1 组败者组，阶段为 Top 4 第 2 天。截图对应 [REQM 回放 10:00](https://www.youtube.com/watch?v=reSgKpylUwE&t=600s)。未识别的对手不据自动章节或房间名称猜测。

## 2026 官方赛程

| 赛事 | 首轮 PYS 开始 | Professionals 循环阶段 | 四强阶段 |
| --- | --- | --- | --- |
| Spring Games | 3/2 | 3/18、19、21、22 | 3/24–25 |
| Blitz Masters: Legacy | 5/10 | 5/26、27、30、31 | 6/6–7 |
| Autumn Games | 9/12 | 10/2–6 窗口（实际日见规程） | 10/10–11 |

来源：[Spring EU PYS](https://eu.wotblitz.com/en/content/PYS-eu-spring-games/)、[Spring NA/APAC PYS](https://na.wotblitz.com/en/content/PYS-na-apac-spring-games/)、[Spring Professionals](https://eu.wotblitz.com/en/content/top-8-spring-games/)、[Legacy EU 规程](https://eu.wotblitz.com/en/content/blitz-masters-legacy-regulations-eu/)、[Legacy NA/APAC 规程](https://na.wotblitz.com/en/content/blitz-masters-legacy-regulations-na-apac/)、[Autumn PYS](https://eu.wotblitz.com/en/content/autumn-games-pys-eu/)、[Autumn Professionals](https://na.wotblitz.com/en/content/top-8-autumn-games/)。

官方资料也有冲突：Legacy NA/APAC 新闻列三日 PYS，当前规程列四日；EU Legacy 文内 CET/CEST 不一致。不能用计划窗口推定每条实际赛日，需与本条直播开始时间、标题和比赛卡交叉核对。Challengers / Lower Echelon 不直接归入 Professionals 的 Top 8 / Top 4；保留原层级供人工选择。

## 官方名称

- 积分赛：Prove Your Skill（Skill 单数），俄文 Путь мастерства。
- 战火杯：Blitz Professional Cup，简称 BPC。网易游戏小管家 [2025 冠军专访](https://game.xiaomi.com/viewpoint/1160758920_1766404215796_16) 的[冠军海报](https://pic.kts.g.mi.com/aaf942c9fb630d47c5f4af2aa30d33e64739192207011129958.jpg) 明确印有 BLITZ PROFESSIONAL CUP 2025。
- 存量默认英文名由 V41 更正为 Blitz Professional Cup (BPC)；V40 与 seed-ready.json 是历史快照，保留原始内容与哈希。

Lesta 时区依据：[2026 Season II 官方比赛安排](https://tanksblitz.ru/ru/news/tournaments/blitz-point-4-season-2-play-off-streams/) 使用 МСК（莫斯科时间）；保存与显示使用 Europe/Moscow（UTC+3）。
