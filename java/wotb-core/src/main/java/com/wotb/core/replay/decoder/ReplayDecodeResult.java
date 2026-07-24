package com.wotb.core.replay.decoder;

import com.wotb.core.replay.event.ReplayEvent;

import java.util.Collections;
import java.util.List;

/**
 * 解码结果：一个原始包可以产生零个、一个或多个领域事件。
 *
 * @param status   解码状态
 * @param events   解码产生的领域事件列表
 * @param warnings 解码警告列表
 */
public record ReplayDecodeResult(
        DecodeStatus status,
        List<ReplayEvent> events,
        List<ReplayDecodeWarning> warnings
) {

    public ReplayDecodeResult {
        if (events == null) {
            events = List.of();
        }
        if (warnings == null) {
            warnings = List.of();
        }
    }

    /** 无事件、无警告的成功结果 */
    public static ReplayDecodeResult empty() {
        return new ReplayDecodeResult(DecodeStatus.SUCCESS, List.of(), List.of());
    }

    /** 单个事件的成功结果 */
    public static ReplayDecodeResult of(ReplayEvent event) {
        return new ReplayDecodeResult(DecodeStatus.SUCCESS,
                Collections.singletonList(event), List.of());
    }

    /** 多个事件的成功结果 */
    public static ReplayDecodeResult of(List<ReplayEvent> events) {
        return new ReplayDecodeResult(DecodeStatus.SUCCESS, events, List.of());
    }

    /** 未知类型的占位结果 */
    public static ReplayDecodeResult unsupported() {
        return new ReplayDecodeResult(DecodeStatus.UNSUPPORTED, List.of(), List.of());
    }
}
