package com.wotb.web.hundred.dto;

public record BulkDeleteItemResult(long id, boolean deleted, String errorCode) {
}
