package com.wotb.web.replay.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.feature.MultiPlayerBattleAnalysisContext;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 回放 AI 战术复盘服务。
 * <p>
 * <b>权威数据源是 {@code battle_results.dat}（{@link Battle}/{@link PlayerResult}）</b>——
 * 伤害、承伤、助攻、格挡、击杀、是否存活、死亡时刻等均为游戏结算的可靠值。
 * 数据包流（type 8 伤害 / type 7 属性）尚无法可靠解码逐帧血量，故不作为血量/死亡来源；
 * 重建结果（{@link ReplayReconstruction}）此处仅用于补充"位置/时间线可用性"这一维度。
 * </p>
 * <p>密钥来自环境变量 {@code AI_API_KEY}（见 application.yml 的 wotb.ai.*）；
 * 未配置时 {@link #analyze} 抛出 {@code AI_NOT_CONFIGURED}，应用本身仍可正常启动。</p>
 */
@Service
public class AiReplayAnalysisService {

    private static final String SYSTEM_PROMPT = """
            你是《坦克世界闪击战》(WoT Blitz) 的资深教练。
            下面给出一场战斗的结算数据（地图、胜负、每位玩家的伤害/承伤/助攻/格挡/击杀/存活与死亡时刻），
            以及录像者(recorder)本人的战绩。数据来自游戏结算，是可靠的。
            请用简体中文输出一份简洁、专业、可执行的战术复盘：
            1) 用一两句话概述战局走势与胜负；
            2) 结合死亡时间线指出 2-3 个关键转折点；
            3) 评估录像者的表现与主要失误（对比同队/对手的输出、承伤、存活时间）；
            4) 给出 3-5 条具体、可操作的改进建议。
            严格基于给定数据，不要编造数据中不存在的信息；无法判断时明确说明。""";

    private final String apiKey;
    private final String model;
    private final RestClient restClient;

    public AiReplayAnalysisService(
            @Value("${wotb.ai.api-key:}") String apiKey,
            @Value("${wotb.ai.base-url:https://api.deepseek.com}") String baseUrl,
            @Value("${wotb.ai.model:deepseek-chat}") String model,
            @Value("${wotb.ai.timeout-sec:120}") int timeoutSec) {
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.model = model;

        final SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10_000);
        factory.setReadTimeout(Math.max(1, timeoutSec) * 1000);
        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(factory)
                .build();
    }

    /**
     * 是否已配置 AI 密钥。
     */
    public boolean isConfigured() {
        return !apiKey.isBlank();
    }

    /**
     * 基于结算数据（权威）生成单场战术复盘。
     *
     * @param battle 结算数据（必须非空且含玩家名册）
     * @param recon  完整重建（可为 null；仅用于报告位置/时间线可用性）
     * @throws IllegalStateException 未配置密钥（消息 {@code AI_NOT_CONFIGURED}）
     * @throws AiUpstreamException   上游调用失败或返回异常
     */
    public AnalyzeResult analyze(Battle battle, ReplayReconstruction recon) {
        if (!isConfigured()) {
            throw new AiNotConfiguredException();
        }

        final List<KeyBattleEvent> keyEvents = buildDeathTimeline(battle);
        final String summary = buildSummary(battle, recon, keyEvents);

        final Map<String, Object> requestBody = new LinkedHashMap<>();
        requestBody.put("model", model);
        requestBody.put("stream", false);
        requestBody.put("messages", List.of(
                Map.of("role", "system", "content", SYSTEM_PROMPT),
                Map.of("role", "user", "content", summary)));

        final String content = call(requestBody);
        return new AnalyzeResult(content, model, keyEvents);
    }

    /**
     * 基于完整 battle + reconstruction + feature set 生成单场个人复盘。
     * <p>这是真正的完整流程复盘入口，使用压缩后的移动段、交火段和阶段数据。</p>
     */
    public AnalyzeResult analyzePlayerContext(SinglePlayerBattleAnalysisContext ctx) {
        if (!isConfigured()) throw new AiNotConfiguredException();
        final String summary = buildPlayerContextSummary(ctx);
        final Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", model);
        body.put("stream", false);
        body.put("messages", List.of(
                Map.of("role", "system", "content", SINGLE_PLAYER_PROMPT),
                Map.of("role", "user", "content", summary)));
        final String content = call(body);
        return new AnalyzeResult(content, model, ctx.features().keyEvents());
    }

    public AnalyzeResult analyzeMultiPlayerContext(MultiPlayerBattleAnalysisContext ctx) {
        if (!isConfigured()) throw new AiNotConfiguredException();
        final String summary = buildMultiPlayerContextSummary(ctx);
        final Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", model);
        body.put("stream", false);
        body.put("messages", List.of(
                Map.of("role", "system", "content", MULTI_PLAYER_PROMPT),
                Map.of("role", "user", "content", summary)));
        final String content = call(body);
        return new AnalyzeResult(content, model, List.of());
    }

    private static final String SINGLE_PLAYER_PROMPT = """
            你是《坦克世界闪击战》(WoT Blitz) 的资深教练，正在对一场随机战斗做个人复盘。
            数据包括：战后结算（可靠）+ 完整战斗位置时间线 + 移动段 + 交火段 + 战斗阶段。
            位置数据已经过压缩（移动段），不要期待逐帧坐标。
            请用简体中文输出：
            1) 整体评价（车辆、地图适应性、战绩概述）
            2) 开局路线和首次接敌分析
            3) 主要交火段分析（输出和承伤时机、站位）
            4) 关键转折点（转场、击杀、阵亡）
            5) 残局处理（如存活到残局）
            6) 做得好的地方和需要改进的地方（需引用时间或事件证据）
            7) 可执行的训练建议
            严格基于给定数据，不要编造。无法判断时明确说明。
            只能根据录像者个人的实战信息评价其决策，
            不可声称看到了未点亮的敌方位置。""";

    private String buildPlayerContextSummary(final SinglePlayerBattleAnalysisContext ctx) {
        final StringBuilder sb = new StringBuilder(2048);
        final var battle = ctx.battle();
        final var features = ctx.features();

        // ====== 权威结算数据（优先） ======
        if (battle != null) {
            sb.append("=== 战斗结算数据（权威） ===\n");
            sb.append("地图: ").append(safe(battle.mapName)).append('\n');
            if (battle.arenaBonusType != null) {
                sb.append("模式编号: ").append(battle.arenaBonusType).append('\n');
            }
            if (battle.durationS != null) {
                sb.append("时长: ").append(String.format("%.1f", battle.durationS)).append("s\n");
            }
            sb.append("胜方队伍: ").append(battle.winnerTeam != null ? battle.winnerTeam : "未知").append('\n');

            final PlayerResult rec = battle.recorderResult();
            if (rec != null) {
                sb.append("\n录像者: ").append(safe(rec.nickname))
                        .append(" | 队伍").append(rec.team)
                        .append(" | ").append(safe(rec.tankName))
                        .append(" | 输出").append(rec.damageDealt)
                        .append(" 承伤").append(rec.damageReceived)
                        .append(" 助攻").append(rec.damageAssisted)
                        .append(" 格挡").append(rec.damageBlocked)
                        .append(" 击杀").append(rec.kills)
                        .append(rec.survived ? " 存活" : " 阵亡@" + String.format("%.1f", deathSec(rec)) + "s")
                        .append("\n");
            }

            sb.append("\n全体玩家战绩 (队伍/昵称/坦克/输出/承伤/助攻/格挡/击杀/存活):\n");
            if (battle.players != null) {
                final java.util.List<PlayerResult> players = new java.util.ArrayList<>(battle.players);
                players.sort(java.util.Comparator.<PlayerResult>comparingInt(p -> p.team)
                        .thenComparing(java.util.Comparator.comparingInt((PlayerResult p) -> p.damageDealt).reversed()));
                for (final PlayerResult p : players) {
                    sb.append("- 队伍").append(p.team)
                            .append(' ').append(safe(p.nickname))
                            .append(" (").append(safe(p.tankName)).append(')')
                            .append(" 输出").append(p.damageDealt)
                            .append(" 承伤").append(p.damageReceived)
                            .append(" 助攻").append(p.damageAssisted)
                            .append(" 格挡").append(p.damageBlocked)
                            .append(" 击杀").append(p.kills)
                            .append(p.survived ? " 存活" : " 阵亡@" + String.format("%.1f", deathSec(p)) + "s")
                            .append('\n');
                }
            }
        } else {
            sb.append("=== 警告：无权威结算数据 ===\n");
        }

        // ====== 重建补充信息 ======
        sb.append("\n=== 重建补充 ===\n");
        sb.append("图像重建完成, 特征集可用\n");

        if (ctx.recorder() != null) {
            sb.append("录像者 entity: 账号 ").append(ctx.recorder().accountId())
                    .append(" | 队伍: ").append(ctx.recorder().team())
                    .append(" | 车辆 ID: ").append(ctx.recorder().tankId()).append('\n');
        }

        if (!features.movements().isEmpty()) {
            sb.append("\n=== 移动段（压缩） ===\n");
            int n = 0;
            for (final MovementSegment seg : features.movements()) {
                if (n++ >= 5) { sb.append("  ... 还有 ").append(features.movements().size() - 5).append(" 段\n"); break; }
                sb.append("  [").append(String.format("%.1f-%.1f", seg.startTime(), seg.endTime())).append("s] ")
                        .append(seg.type()).append(" | 距离 ").append(String.format("%.1f", seg.distance()))
                        .append("m 速度 ").append(String.format("%.1f", seg.averageSpeed())).append("m/s\n");
            }
        }

        if (!features.engagements().isEmpty()) {
            sb.append("\n=== 交火段 ===\n");
            for (int i = 0; i < features.engagements().size(); i++) {
                final EngagementSummary e = features.engagements().get(i);
                sb.append("  #").append(i + 1).append(" [")
                        .append(String.format("%.1f-%.1f", e.startTime(), e.endTime())).append("s]")
                        .append(" 输出").append(e.damageDealt()).append(" 承伤").append(e.damageReceived())
                        .append(" 结果: ").append(e.outcome()).append('\n');
            }
        }

        if (!features.phases().isEmpty()) {
            sb.append("\n=== 战斗阶段 ===\n");
            for (final BattlePhaseSummary p : features.phases()) {
                sb.append("  [").append(String.format("%.1f-%.1f", p.startTime(), p.endTime())).append("s] ")
                        .append(p.type()).append('\n');
            }
        }

        sb.append("\n覆盖: ").append(ctx.coverage() != null ? ctx.coverage().decodedPacketRatio() : "N/A").append('\n');
        return sb.toString();
    }

    private static final String MULTI_PLAYER_PROMPT = """
            你是《坦克世界闪击战》(WoT Blitz) 的资深教练，正在对同一玩家的多场随机战斗做趋势复盘。
            每场都已后端压缩为移动段和交火段，不要期待逐帧坐标。
            聚合统计由后端确定性计算。请用简体中文输出：
            1) 总体表现概览（场均输出/承伤/存活时间）
            2) 反复出现的问题（引用具体场次和时间段证据）
            3) 稳定发挥的优点
            4) 跨场景可执行的训练建议
            严格基于数据，不要混淆场次。""";

    private String buildMultiPlayerContextSummary(MultiPlayerBattleAnalysisContext ctx) {
        final StringBuilder sb = new StringBuilder(512);
        sb.append("分析场次: ").append(ctx.battleCount()).append('\n');
        sb.append("限制: ").append(String.join("; ", ctx.limitations())).append('\n');
        for (int i = 0; i < ctx.battles().size(); i++) {
            final var b = ctx.battles().get(i);
            sb.append("\n=== 第 ").append(i + 1).append(" 场: ").append(b.fileName()).append(" ===\n");
            sb.append("地图: ").append(b.mapName()).append(" | ")
                    .append("时长: ").append(b.durationSec()).append("s | ")
                    .append(b.victory() ? "胜" : "负").append('\n');
            final var fs = b.features();
            if (fs != null) {
                int dealt = 0, received = 0;
                for (final var eng : fs.engagements()) {
                    dealt += eng.damageDealt();
                    received += eng.damageReceived();
                }
                sb.append("输出: ").append(dealt).append(" 承伤: ").append(received).append('\n');
                sb.append("交火段: ").append(fs.engagements().size())
                        .append(" | 移动段: ").append(fs.movements().size()).append('\n');
            }
        }
        return sb.toString();
    }

    private static final String MULTI_SYSTEM_PROMPT = """
            你是《坦克世界闪击战》(WoT Blitz) 的资深教练，正在对同一玩家的多场战斗做趋势复盘。
            下面给出每场的结算摘要（以录像者视角）与已由后端确定性计算好的聚合统计。
            数据来自游戏结算，可靠。请用简体中文输出：
            1) 总体表现概览（胜率、场均输出/承伤/助攻、平均存活时间）；
            2) 反复出现的问题（例如过早阵亡、承伤过高、输出不足的地图/车型）；
            3) 稳定发挥的优点；
            4) 3-5 条跨场景、可操作的训练建议。
            严格基于给定的每场摘要与聚合统计，不要臆造；每场之间不要混淆（实体/时钟各自独立）。""";

    /**
     * 多场趋势复盘：每场独立取结算摘要，后端确定性计算聚合统计后交给 AI，
     * <b>不拼接各场的原始事件流</b>（不同场次时钟/实体各自独立，直接合并会语义冲突）。
     *
     * @param battles 各场结算数据（均应含玩家名册；顺序保留）
     */
    public AnalyzeResult analyzeMulti(List<Battle> battles) {
        if (!isConfigured()) {
            throw new AiNotConfiguredException();
        }
        final String summary = buildMultiSummary(battles);

        final Map<String, Object> requestBody = new LinkedHashMap<>();
        requestBody.put("model", model);
        requestBody.put("stream", false);
        requestBody.put("messages", List.of(
                Map.of("role", "system", "content", MULTI_SYSTEM_PROMPT),
                Map.of("role", "user", "content", summary)));

        final String content = call(requestBody);
        return new AnalyzeResult(content, model, List.of());
    }

    /**
     * 发送请求并取回文本；统一异常处理。
     */
    private String call(Map<String, Object> requestBody) {
        final ChatCompletionResponse response;
        try {
            response = restClient.post()
                    .uri("/chat/completions")
                    .header("Authorization", "Bearer " + apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(requestBody)
                    .retrieve()
                    .body(ChatCompletionResponse.class);
        } catch (RestClientResponseException e) {
            throw new AiUpstreamException("AI_UPSTREAM_ERROR: HTTP " + e.getStatusCode().value());
        } catch (RestClientException e) {
            throw new AiUpstreamException("AI_UPSTREAM_ERROR: " + e.getClass().getSimpleName());
        }
        final String content = extractContent(response);
        if (content.isBlank()) {
            throw new AiUpstreamException("AI_EMPTY_RESPONSE");
        }
        return content;
    }

    /**
     * 每场独立摘要 + 后端确定性聚合（录像者视角）。
     */
    private static String buildMultiSummary(List<Battle> battles) {
        final StringBuilder sb = new StringBuilder(4096);
        sb.append("共 ").append(battles.size()).append(" 场。\n\n=== 各场摘要（录像者视角）===\n");

        int wins = 0, withRec = 0;
        long sumDmg = 0, sumRecv = 0, sumAssist = 0;
        double sumSurvival = 0;
        int survivedCount = 0;

        for (int i = 0; i < battles.size(); i++) {
            final Battle b = battles.get(i);
            final PlayerResult rec = b.recorderResult();
            sb.append("场 ").append(i + 1).append(": 地图 ").append(safe(b.mapName));
            if (rec != null) {
                final boolean win = b.winnerTeam != null && b.winnerTeam == rec.team;
                sb.append(" | ").append(safe(rec.tankName))
                        .append(win ? " | 胜" : " | 负")
                        .append(" | 输出").append(rec.damageDealt)
                        .append(" 承伤").append(rec.damageReceived)
                        .append(" 助攻").append(rec.damageAssisted)
                        .append(" 击杀").append(rec.kills)
                        .append(rec.survived ? " | 存活"
                                : " | 阵亡@" + String.format("%.1f", deathSec(rec)) + "s");
                withRec++;
                if (win) {
                    wins++;
                }
                sumDmg += rec.damageDealt;
                sumRecv += rec.damageReceived;
                sumAssist += rec.damageAssisted;
                if (rec.survived) {
                    survivedCount++;
                    if (b.durationS != null) {
                        sumSurvival += b.durationS;
                    }
                } else {
                    sumSurvival += deathSec(rec);
                }
            } else {
                sb.append(" | (未能定位录像者战绩)");
            }
            sb.append('\n');
        }

        sb.append("\n=== 聚合统计（后端计算，录像者）===\n");
        if (withRec > 0) {
            sb.append("可统计场数: ").append(withRec).append('\n');
            sb.append("胜率: ").append(String.format("%.0f%%", 100.0 * wins / withRec)).append('\n');
            sb.append("场均输出: ").append(sumDmg / withRec).append('\n');
            sb.append("场均承伤: ").append(sumRecv / withRec).append('\n');
            sb.append("场均助攻: ").append(sumAssist / withRec).append('\n');
            sb.append("平均存活时间: ").append(String.format("%.1f", sumSurvival / withRec)).append("s\n");
            sb.append("存活率: ").append(String.format("%.0f%%", 100.0 * survivedCount / withRec)).append('\n');
        } else {
            sb.append("(无法定位任一场的录像者战绩，无法聚合)\n");
        }
        return sb.toString();
    }

    private static String extractContent(final ChatCompletionResponse response) {
        if (response == null || response.choices() == null || response.choices().isEmpty()) {
            return "";
        }
        final ChatCompletionResponse.Choice choice = response.choices().getFirst();
        if (choice == null || choice.message() == null || choice.message().content() == null) {
            return "";
        }
        return choice.message().content();
    }

    /**
     * 从结算数据构建可靠的死亡时间线（按死亡时刻升序），外加战斗结束事件。
     */
    private static List<KeyBattleEvent> buildDeathTimeline(final Battle battle) {
        final List<KeyBattleEvent> events = new ArrayList<>();
        if (battle.players != null) {
            final List<PlayerResult> dead = new ArrayList<>();
            for (final PlayerResult p : battle.players) {
                if (!p.survived) {
                    dead.add(p);
                }
            }
            dead.sort(Comparator.comparingDouble(AiReplayAnalysisService::deathSec));
            for (final PlayerResult p : dead) {
                events.add(new KeyBattleEvent(
                        (float) deathSec(p), "VEHICLE_DESTROYED",
                        "队伍" + p.team + " " + safe(p.nickname)
                                + " (" + safe(p.tankName) + ") 阵亡"));
            }
        }
        final float endSec = battle.durationS != null ? battle.durationS.floatValue() : 0f;
        events.add(new KeyBattleEvent(endSec, "BATTLE_END",
                battle.winnerTeam != null ? "战斗结束，胜方队伍 " + battle.winnerTeam : "战斗结束"));
        return List.copyOf(events);
    }

    /**
     * 死亡时刻（秒）：优先 deathTimeMillis，回退 survivalTimeSec。
     */
    private static double deathSec(final PlayerResult p) {
        if (p.deathTimeMillis > 0) {
            return p.deathTimeMillis / 1000.0;
        }
        return p.survivalTimeSec;
    }

    private static String safe(String s) {
        return (s == null || s.isBlank()) ? "?" : s;
    }

    /**
     * 构建以结算数据为准的紧凑战局摘要。
     */
    private static String buildSummary(final Battle battle, final ReplayReconstruction recon, final List<KeyBattleEvent> keyEvents) {
        final StringBuilder sb = new StringBuilder(2048);
        sb.append("地图: ").append(safe(battle.mapName)).append('\n');
        if (battle.arenaBonusType != null) {
            sb.append("模式编号: ").append(battle.arenaBonusType).append('\n');
        }
        if (battle.durationS != null) {
            sb.append("时长: ").append(String.format("%.1f", battle.durationS)).append("s\n");
        }
        sb.append("胜方队伍: ")
                .append(battle.winnerTeam != null ? battle.winnerTeam : "未知").append('\n');

        final PlayerResult rec = battle.recorderResult();
        if (rec != null) {
            sb.append("\n录像者: ").append(safe(rec.nickname))
                    .append(" | 队伍").append(rec.team)
                    .append(" | ").append(safe(rec.tankName))
                    .append(" | 输出").append(rec.damageDealt)
                    .append(" 承伤").append(rec.damageReceived)
                    .append(" 助攻").append(rec.damageAssisted)
                    .append(" 格挡").append(rec.damageBlocked)
                    .append(" 击杀").append(rec.kills)
                    .append(rec.survived ? " 存活" : " 阵亡@" + String.format("%.1f", deathSec(rec)) + "s")
                    .append('\n');
        } else {
            sb.append("\n(未能定位录像者战绩)\n");
        }

        sb.append("\n全体玩家战绩 (队伍/昵称/坦克/输出/承伤/助攻/格挡/击杀/存活):\n");
        if (battle.players != null) {
            final List<PlayerResult> players = new ArrayList<>(battle.players);
            players.sort(Comparator.<PlayerResult>comparingInt(p -> p.team)
                    .thenComparing(Comparator.comparingInt((PlayerResult p) -> p.damageDealt).reversed()));
            for (final PlayerResult p : players) {
                sb.append("- 队伍").append(p.team)
                        .append(' ').append(safe(p.nickname))
                        .append(" (").append(safe(p.tankName)).append(')')
                        .append(" 输出").append(p.damageDealt)
                        .append(" 承伤").append(p.damageReceived)
                        .append(" 助攻").append(p.damageAssisted)
                        .append(" 格挡").append(p.damageBlocked)
                        .append(" 击杀").append(p.kills)
                        .append(p.survived ? " 存活"
                                : " 阵亡@" + String.format("%.1f", deathSec(p)) + "s")
                        .append('\n');
            }
        }

        sb.append("\n死亡时间线:\n");
        for (final KeyBattleEvent e : keyEvents) {
            sb.append("- [").append(String.format("%.1f", e.clockSec())).append("s] ")
                    .append(e.label()).append('\n');
        }

        // 位置/走位维度：仅报告可用性，不臆断（逐帧血量无法可靠解码，已在文档中说明）
        if (recon != null) {
            sb.append("\n位置时间线: 可用（").append(recon.events().size())
                    .append(" 个领域事件，含位置流；如需走位分析可据此展开）\n");
        } else {
            sb.append("\n位置时间线: 不可用（完整重建未成功，本次仅基于结算数据分析）\n");
        }

        return sb.toString();
    }

    /**
     * 分析结果。
     *
     * @param analysis  AI 生成的战术复盘文本
     * @param model     使用的模型
     * @param keyEvents 关键事件（死亡时间线，来自结算数据）
     */
    public record AnalyzeResult(String analysis, String model, List<KeyBattleEvent> keyEvents) {
    }

    /**
     * DeepSeek /chat/completions 响应的最小映射（OpenAI 兼容）。忽略未知字段。
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record ChatCompletionResponse(List<Choice> choices) {

        @JsonIgnoreProperties(ignoreUnknown = true)
        record Choice(Message message) {
        }

        @JsonIgnoreProperties(ignoreUnknown = true)
        record Message(String content) {
        }
    }
}