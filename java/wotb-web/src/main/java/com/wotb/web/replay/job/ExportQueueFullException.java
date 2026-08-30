package com.wotb.web.replay.job;

import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;

/** Export Job 队列满载（workers + queue 全占用）→ 503 EXPORT_QUEUE_FULL。 */
public class ExportQueueFullException extends ApiException {

    public ExportQueueFullException() {
        super(ApiErrorCode.EXPORT_QUEUE_FULL);
    }
}
