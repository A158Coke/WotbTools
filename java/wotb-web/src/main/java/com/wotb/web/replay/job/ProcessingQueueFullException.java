package com.wotb.web.replay.job;

import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;

/** Processing Job 队列满载（与 Export 共用同一有界 worker 池）→ 503 PROCESSING_QUEUE_FULL。 */
public class ProcessingQueueFullException extends ApiException {

    public ProcessingQueueFullException() {
        super(ApiErrorCode.PROCESSING_QUEUE_FULL);
    }
}
