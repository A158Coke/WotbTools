package com.wotb.core.processing;

import com.wotb.core.replay.event.DecodeConfidence;

/**
 * 录像者身份标识。
 *
 * @param accountId  录像者账号 ID（首要标识）
 * @param nickname   录像者昵称（降级标识）
 * @param confidence 身份识别置信度
 */
public record RecorderIdentity(
        Long accountId,
        String nickname,
        DecodeConfidence confidence
) {

    public static RecorderIdentity unknown() {
        return new RecorderIdentity(null, null, DecodeConfidence.UNKNOWN);
    }

    public static RecorderIdentity exact(long accountId, String nickname) {
        return new RecorderIdentity(accountId, nickname, DecodeConfidence.EXACT);
    }

    public static RecorderIdentity inferred(String nickname) {
        return new RecorderIdentity(null, nickname, DecodeConfidence.INFERRED);
    }
}
