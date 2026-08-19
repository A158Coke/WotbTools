package com.wotb.core.replay.reconstruction;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.util.Map;

/**
 * 回放重建上下文 —— 将普通 ReplayParser 解析得到的 roster 传入 reconstruction。
 * <p>
 * 用于解决 reconstruction 无法可靠识别录像者对应实体的问题。
 * </p>
 *
 * @param battle              现有 Battle 解析结果
 * @param playersByAccountId  全量 playerResult 索引
 * @param recorderAccountId   录像者 accountId（可 null）
 * @param recorderNickname    录像者昵称（回退识别用）
 */
public record ReplayReconstructionContext(
        Battle battle,
        Map<Long, PlayerResult> playersByAccountId,
        Long recorderAccountId,
        String recorderNickname
) {

    /** 仅包含录像者身份的最小上下文。 */
    public static ReplayReconstructionContext recorderOnly(
            Long recorderAccountId, String recorderNickname) {
        return new ReplayReconstructionContext(null, Map.of(),
                recorderAccountId, recorderNickname);
    }

    /** 无上下文。 */
    public static ReplayReconstructionContext empty() {
        return new ReplayReconstructionContext(null, Map.of(), null, null);
    }
}
