package com.wotb.core.processing;

import com.wotb.core.replay.event.DecodeConfidence;
import java.util.List;

/**
 * 多录像者冲突错误详情。
 */
public record MixedRecordersDetail(
        String message,
        List<RecorderGroup> recorders
) {
    public record RecorderGroup(
            Long accountId,
            String nickname,
            List<String> fileNames
    ) {}
}
