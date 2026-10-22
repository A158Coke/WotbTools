package com.wotb.web.util.csv;

public final class CsvSyntaxException extends RuntimeException {
    public CsvSyntaxException(final Throwable cause) { super("Invalid CSV syntax", cause); }
}
