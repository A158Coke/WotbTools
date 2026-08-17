package com.wotb.web.leaderboard.exception;

import org.springframework.http.HttpStatus;

/**
 * 回放文件存储异常。{@code code} 为稳定英文错误码，{@code status} 为对外 HTTP 状态。
 * 与普通参数错误（IllegalArgumentException → 400）严格区分，绝不让文件系统
 * IOException 被误报成 INVALID_REPLAY_FILE。
 */
public class LeaderboardStorageException extends RuntimeException {

    private final String code;
    private final HttpStatus status;

    public LeaderboardStorageException(final String code, final HttpStatus status, final String message) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public LeaderboardStorageException(final String code, final HttpStatus status,
                                       final String message, final Throwable cause) {
        super(message, cause);
        this.code = code;
        this.status = status;
    }

    public String getCode() {
        return code;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
