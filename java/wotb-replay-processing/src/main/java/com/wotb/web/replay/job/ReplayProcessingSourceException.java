package com.wotb.web.replay.job;

/**
 * 单个源在 canonical 解析后被判定为失败（{@code ReplayProcessingResult.battle() == null}）。
 *
 * <p>携带结果里的稳定低基数 error code；本地执行器与 parser worker 都用它区分
 * "解析失败"（业务失败，发 outcome 后 ack）与"基础设施失败"（nack 交给既有 retry/DLQ 链路）。</p>
 */
public final class ReplayProcessingSourceException extends RuntimeException {

    private final String errorCode;

    public ReplayProcessingSourceException(final String errorCode, final String message) {
        super(message);
        this.errorCode = errorCode;
    }

    public String errorCode() {
        return errorCode;
    }
}
