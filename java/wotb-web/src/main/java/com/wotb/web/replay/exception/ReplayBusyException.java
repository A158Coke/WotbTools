package com.wotb.web.replay.exception;

import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;

/** 回放处理并发容量已满。 */
public class ReplayBusyException extends ApiException {

    public ReplayBusyException() {
        super(ApiErrorCode.REPLAY_BUSY);
    }
}
