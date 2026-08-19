package com.wotb.web.replay.exception;

/** 回放处理并发容量已满。 */
public class ReplayBusyException extends RuntimeException {

    public ReplayBusyException() {
        super("REPLAY_BUSY");
    }
}
