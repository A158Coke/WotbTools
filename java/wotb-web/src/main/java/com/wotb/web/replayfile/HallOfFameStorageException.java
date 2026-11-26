package com.wotb.web.replayfile;

import org.springframework.http.HttpStatus;

public class HallOfFameStorageException extends RuntimeException {

    private final String code;
    private final HttpStatus status;

    public HallOfFameStorageException(final String code, final HttpStatus status, final String message) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public HallOfFameStorageException(final String code, final HttpStatus status,
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
