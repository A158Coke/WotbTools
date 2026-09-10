package com.wotb.web.replay;

import org.springframework.web.multipart.MultipartFile;

/**
 * 共享回放上传校验器：文件类型 / 单文件 20MiB / 总大小 200MiB / 空文件。
 *
 * <p>通用校验不限制文件数量（live {@code POST /api/replay/processing-jobs} 支持多文件）。
 * AI 的单文件策略由 AI 边界负责，百场 submission 复用本校验器的 size/type contract。</p>
 *
 * <p>错误码与既有端点保持一致：{@code NO_REPLAY_FILES} / {@code NO_REPLAY_FILE} /
 * {@code INVALID_REPLAY_FILE_TYPE} / {@code FILE_TOO_LARGE} / {@code TOTAL_REQUEST_TOO_LARGE}。</p>
 */
public final class ReplayUploadValidator {

    public static final long MAX_FILE_SIZE = 20L * 1024 * 1024;
    public static final long MAX_TOTAL_SIZE = 200L * 1024 * 1024;

    private ReplayUploadValidator() {
    }

    /** 通用上传校验：文件数组非空、每个文件非空/类型合法/单文件 ≤ 20MiB、累计 ≤ 200MiB。不限制文件数量。 */
    public static void validate(final MultipartFile[] files) {
        if (files == null || files.length == 0) {
            throw new IllegalArgumentException("NO_REPLAY_FILES");
        }
        long totalBytes = 0;
        for (final MultipartFile file : files) {
            if (file == null || file.isEmpty()) {
                throw new IllegalArgumentException("NO_REPLAY_FILE");
            }
            final String name = file.getOriginalFilename();
            if (name == null || name.isBlank() || !name.toLowerCase().endsWith(".wotbreplay")) {
                throw new IllegalArgumentException("INVALID_REPLAY_FILE_TYPE");
            }
            final long fileSize = file.getSize();
            if (fileSize > MAX_FILE_SIZE) {
                throw new IllegalArgumentException("FILE_TOO_LARGE");
            }
            if (fileSize > MAX_TOTAL_SIZE - totalBytes) {
                throw new IllegalArgumentException("TOTAL_REQUEST_TOO_LARGE");
            }
            totalBytes += fileSize;
        }
    }
}
