package com.wotb.web.replay.dto;

import com.wotb.core.replay.evidence.TeamAiReviewResult;

import java.util.List;

/**
 * AI Review SSE {@code done} 事件的唯一 transport 形状
 * （contracts/http/openapi.yaml {@code #/components/schemas/AiReviewDonePayload}：
 * required = [analysis, preBattleSection, capability, teamReview, teamPlayers]）。
 *
 * <p>两个复盘分支共用本类型：PLAYER_FOCUSED 的 {@code analysis} 为随机战复盘正文、
 * {@code teamReview} 为 {@code null}、{@code teamPlayers} 为空数组；TEAM_PERSPECTIVE 的
 * {@code analysis} 为 v0.5 structured result 的 {@code summary.verdict} 兼容文本，
 * {@code teamReview}/{@code teamPlayers} 来自 {@code TeamReplayAnalysisService}。
 * 任何分支都必须发出全部 5 个 key（null 值按 wire contract 保留）。</p>
 *
 * @param analysis         AI 生成的战术复盘文本（team 分支为 structured result 的 verdict 兼容文本）
 * @param preBattleSection 赛前预测区块（用户可见中文 Markdown；不可用时为 null）
 * @param capability       AVAILABLE / AVAILABLE_WITH_LIMITED_TIMELINE / UNAVAILABLE
 *                         （派生：recon.battleStartRawClockSec 非 finite 或投影声明 limitations → LIMITED；
 *                         见 {@link Capability}）
 * @param teamReview       Team AI Review v0.5 structured result；个人复盘时为 null
 * @param teamPlayers      authoritative playerKey → display identity mapping；个人复盘时为空
 */
public record AiReviewDonePayload(
        String analysis,
        String preBattleSection,
        Capability capability,
        TeamAiReviewResult teamReview,
        List<TeamPlayer> teamPlayers
) {
    public AiReviewDonePayload {
        teamPlayers = teamPlayers == null ? List.of() : List.copyOf(teamPlayers);
    }

    /**
     * AI Review capability（与 prompt planner battleStart 判定一致；前端本地化）。
     * <p>wire enum 只有 AVAILABLE / AVAILABLE_WITH_LIMITED_TIMELINE 由 producer 产出；
     * {@code UNAVAILABLE} 保留在 contract 中（N12：不改 wire shape）——时间线不可用由
     * {@code AI_TIMELINE_UNUSABLE} 错误路径表达，{@code done} payload 内不出现该值。</p>
     */
    public enum Capability {
        AVAILABLE,
        AVAILABLE_WITH_LIMITED_TIMELINE,
        UNAVAILABLE
    }

    /** 与 openapi {@code TeamAiPlayerIdentity} 一致（playerKey / displayName / tankName）。 */
    public record TeamPlayer(String playerKey, String displayName, String tankName) {
    }
}
