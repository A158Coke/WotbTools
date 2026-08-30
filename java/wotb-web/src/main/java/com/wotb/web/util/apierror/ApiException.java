package com.wotb.web.util.apierror;

import java.util.Map;
import java.util.UUID;

/** Typed exception for new API error paths; legacy domain exceptions remain compatible during migration. */
public class ApiException extends RuntimeException {

    private final String id;
    private final ApiErrorCode errorCode;
    private final String errorMsg;
    private final Map<String, Object> details;

    public ApiException(final ApiErrorCode errorCode) {
        this(errorCode, null, Map.of());
    }

    public ApiException(final ApiErrorCode errorCode, final String errorMsg,
                        final Map<String, Object> details) {
        super(errorCode.name());
        this.id = UUID.randomUUID().toString();
        this.errorCode = errorCode;
        this.errorMsg = errorMsg;
        this.details = details == null ? Map.of() : Map.copyOf(details);
    }

    public String id() {
        return id;
    }

    public ApiErrorCode errorCode() {
        return errorCode;
    }

    public String errorMsg() {
        return errorMsg;
    }

    /** Safe backend diagnostic text: explicit message when supplied, otherwise this exception's ID. */
    public String diagnosticMessage() {
        return errorMsg == null || errorMsg.isBlank() ? id : errorMsg;
    }

    public Map<String, Object> details() {
        return details;
    }
}
