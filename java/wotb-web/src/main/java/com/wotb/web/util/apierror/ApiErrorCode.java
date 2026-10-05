package com.wotb.web.util.apierror;

import org.springframework.http.HttpStatus;

/** Canonical infrastructure error codes. Existing domain codes remain supported by {@link ApiErrorFactory}. */
public enum ApiErrorCode {
    AUTH_UNAUTHENTICATED(HttpStatus.UNAUTHORIZED, false),
    AUTH_FORBIDDEN(HttpStatus.FORBIDDEN, false),
    INVALID_ARGUMENT(HttpStatus.BAD_REQUEST, false),
    MISSING_PARAM(HttpStatus.BAD_REQUEST, false),
    INVALID_REQUEST(HttpStatus.BAD_REQUEST, false),
    UNSUPPORTED_MEDIA_TYPE(HttpStatus.UNSUPPORTED_MEDIA_TYPE, false),
    METHOD_NOT_ALLOWED(HttpStatus.METHOD_NOT_ALLOWED, false),
    RESOURCE_NOT_FOUND(HttpStatus.NOT_FOUND, false),
    REPLAY_BUSY(HttpStatus.SERVICE_UNAVAILABLE, true),
    TOURNAMENT_VERSION_CONFLICT(HttpStatus.CONFLICT, false),
    TOURNAMENT_LOCKED(HttpStatus.CONFLICT, false),
    TOURNAMENT_RULES_INCOMPLETE(HttpStatus.CONFLICT, false),
    TOURNAMENT_GROUP_CONFLICT(HttpStatus.CONFLICT, false),
    TOURNAMENT_DUPLICATE_GROUP(HttpStatus.CONFLICT, false),
    TOURNAMENT_NEW_CLAN_CONFIRMATION_REQUIRED(HttpStatus.CONFLICT, false),
    TOURNAMENT_GROUP_COUNT_MISMATCH(HttpStatus.CONFLICT, false),
    TOURNAMENT_RECOGNITION_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, false),
    TOURNAMENT_ALREADY_EXISTS(HttpStatus.CONFLICT, false),
    TOURNAMENT_EVIDENCE_INVALID(HttpStatus.BAD_REQUEST, false),
    TOURNAMENT_STORAGE_FULL(HttpStatus.INSUFFICIENT_STORAGE, false),
    TOURNAMENT_STORAGE_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, false),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, true);

    private final HttpStatus status;
    private final boolean retryable;

    ApiErrorCode(final HttpStatus status, final boolean retryable) {
        this.status = status;
        this.retryable = retryable;
    }

    public HttpStatus status() {
        return status;
    }

    public boolean retryable() {
        return retryable;
    }
}
