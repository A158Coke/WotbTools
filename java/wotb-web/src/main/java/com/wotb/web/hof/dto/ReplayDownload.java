package com.wotb.web.hof.dto;

/**
 * 下载回放结果：文件字节 + 用于 Content-Disposition 的原始文件名。
 */
public record ReplayDownload(byte[] data, String fileName) {
}
