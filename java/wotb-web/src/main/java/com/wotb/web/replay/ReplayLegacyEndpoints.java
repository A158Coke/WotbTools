package com.wotb.web.replay;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Replay Processing V2 之后废弃的同步 full-processing HTTP 入口统一契约
 * ：这些端点仍保留路由以便旧客户端/手工请求得到稳定信号，但一律
 * 返回 <b>410 Gone + {@code REPLAY_LEGACY_DEPRECATED}</b>，绝不调用独立 full
 * processing——ReplayParseScheduler 是唯一 CPU budget authority，不存在第二套
 * ReplayCapacityLimiter 并行处理同一产品域。
 */
public final class ReplayLegacyEndpoints {

    public static final String DEPRECATED_ERROR = "REPLAY_LEGACY_DEPRECATED";

    /** 410 + 稳定错误码（GlobalExceptionHandler 按 ResponseStatusException 映射）。 */
    public static ResponseStatusException gone() {
        return new ResponseStatusException(HttpStatus.GONE, DEPRECATED_ERROR);
    }

    private ReplayLegacyEndpoints() {
    }
}
