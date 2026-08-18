package com.wotb.web.hof.dto;

/** 回放文件元数据（上传侧准备，随名人堂记录入库）。 */
public record ReplayFileMeta(String sha256, String originalName, long size, String uploadedBy) {
}
