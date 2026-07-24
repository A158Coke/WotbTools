package com.wotb.core.replay.stream;

/**
 * 回放流头部解析异常。
 * 在遇到非法头部时抛出稳定、可测试的错误。
 */
public class ReplayHeaderException extends RuntimeException {

    public ReplayHeaderException(String message) {
        super(message);
    }

    public ReplayHeaderException(String message, Throwable cause) {
        super(message, cause);
    }
}
