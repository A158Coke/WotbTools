package com.wotb.web.replay.exception;

import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;

public class ReplayBusyException extends ApiException {

    public ReplayBusyException() {
        super(ApiErrorCode.REPLAY_BUSY);
    }
}
