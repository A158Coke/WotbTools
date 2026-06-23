package com.wotb.web.dto;

/** 导出结果 (业务层产物, 与 HTTP 解耦): 真实文件名 + MIME 类型 + 字节内容。 */
public record ExportResult(String filename, String contentType, byte[] data) {
}
