package com.wotb.core.processing;

import java.util.List;

/**
 * 多录像者冲突错误详情。
 */
public record MixedRecordersDetail(
        String message,
        List<RecorderGroup> recorders
) {
}
