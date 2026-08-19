package com.wotb.core.processing;

import com.wotb.core.replay.event.DecodeConfidence;

import java.util.List;

/**
 * 训练房/联赛录像的团队视角解析结果。
 *
 * @param perspectiveTeam 录像者所属队伍；无法可靠解析时为 {@code null}
 * @param recorderAccountId 录像者账号 ID；未知时为 {@code null}
 * @param recorderEntityId 录像者当前/最后一次映射的实体 ID；未知时为 {@code null}
 * @param confidence 解析置信度
 * @param limitations 稳定英文限制码
 */
public record TeamPerspectiveResolution(
        Integer perspectiveTeam,
        Long recorderAccountId,
        Integer recorderEntityId,
        DecodeConfidence confidence,
        List<String> limitations
) {

    public TeamPerspectiveResolution {
        confidence = confidence == null ? DecodeConfidence.UNKNOWN : confidence;
        limitations = limitations == null ? List.of() : List.copyOf(limitations);
    }

    public boolean resolved() {
        return perspectiveTeam != null && perspectiveTeam > 0;
    }

    public static TeamPerspectiveResolution unresolved(final String limitation) {
        return new TeamPerspectiveResolution(
                null, null, null, DecodeConfidence.UNKNOWN, List.of(limitation));
    }
}
