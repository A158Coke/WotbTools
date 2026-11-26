package com.wotb.web.hof.dto;

public record ReplayFileMeta(String sha256, String originalName, long size, String uploadedBy) {
}
