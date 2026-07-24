package com.wotb.core.processing;

import java.util.List;

/** 多录像者冲突中一个录像者的文件组。 */
public record RecorderGroup(
        Long accountId,
        String nickname,
        List<String> fileNames
) {}
