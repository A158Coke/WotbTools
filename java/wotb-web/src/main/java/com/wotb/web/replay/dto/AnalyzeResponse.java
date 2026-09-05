package com.wotb.web.replay.dto;

import com.wotb.core.replay.evidence.TeamAiReviewResult;

import java.util.List;

/**
 * AI 战术复盘响应：文本复盘或 Team v0.5 structured result + 可选的「赛前预测」区块。
 * <p>前端 {@code AnalysisResultPanel.vue} 消费
 * {@code analysis}（复盘正文）与 {@code preBattleSection}（Call #1 赛前预测的用户
 * 可见中文渲染，后端生成）；Call #1 失败/降级/非中文时 {@code preBattleSection} 为
 * {@code null}，前端不显示该区块。地图鸟瞰（mapOverview）不属于 AI 复盘响应——
 * 由独立 Processing Job 的 canonical {@code map-overview.json} artifact
 * （战局回放面板消费）承载。</p>
 *
 * @param analysis          AI 生成的战术复盘文本
 * @param preBattleSection  赛前预测区块（用户可见中文 Markdown；不可用时为 null）
 * @param capability        AVAILABLE / AVAILABLE_WITH_LIMITED_TIMELINE / UNAVAILABLE
 *                          （派生：recon.battleStartRawClockSec 非 finite → LIMITED；UNAVAILABLE 由
 *                          AI_TIMELINE_UNUSABLE 错误路径表达，response 内不出现）。
 * @param teamReview        Team AI Review v0.5 structured result；个人复盘时为 null
 * @param teamPlayers       authoritative playerKey → display identity mapping；个人复盘时为空
 */
public record AnalyzeResponse(
        String analysis,
        String preBattleSection,
        Capability capability,
        TeamAiReviewResult teamReview,
        List<TeamPlayer> teamPlayers
) {
    public AnalyzeResponse {
        teamPlayers = teamPlayers == null ? List.of() : List.copyOf(teamPlayers);
    }

    /** AI Review capability（与 prompt planner battleStart 判定一致；前端本地化）。 */
    public enum Capability {
        AVAILABLE,
        AVAILABLE_WITH_LIMITED_TIMELINE,
        UNAVAILABLE
    }

    public AnalyzeResponse(final String analysis) {
        this(analysis, null, Capability.AVAILABLE, null, List.of());
    }

    public AnalyzeResponse(final String analysis, final String preBattleSection) {
        this(analysis, preBattleSection, Capability.AVAILABLE, null, List.of());
    }

    public AnalyzeResponse(final String analysis, final String preBattleSection,
                           final Capability capability) {
        this(analysis, preBattleSection, capability, null, List.of());
    }

    public AnalyzeResponse(final String analysis, final String preBattleSection,
                           final Capability capability, final TeamAiReviewResult teamReview) {
        this(analysis, preBattleSection, capability, teamReview, List.of());
    }

    public record TeamPlayer(String playerKey, String displayName, String tankName) {
    }
}
