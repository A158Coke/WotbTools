package com.wotb.web.replay.dto;

/**
 * League Rating 质量限制元数据（非阻断 warning，不是 failure）。
 *
 * <p>评分可以生成，但某些子事实无法从回放可靠证明（如精确死亡时刻 UNKNOWN），
 * 依赖该事实的维度按 0 分保守计算。前端用此字段做非阻断提示，不得进入 failure 列表。</p>
 */
public record LeagueRatingQualityDto(int unknownDeathTimePlayers) {
}
