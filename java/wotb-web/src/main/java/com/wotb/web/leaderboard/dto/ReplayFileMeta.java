package com.wotb.web.leaderboard.dto;

/** 回放文件元数据（上传侧准备，随排行榜记录入库）。 */
public record ReplayFileMeta(String sha256, String originalName, long size, String uploadedBy) {
}
