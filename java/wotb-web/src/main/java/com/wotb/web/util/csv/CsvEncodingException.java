package com.wotb.web.util.csv;

public final class CsvEncodingException extends RuntimeException {
    public CsvEncodingException(final Throwable cause) { super("Invalid UTF-8 CSV input", cause); }
}
