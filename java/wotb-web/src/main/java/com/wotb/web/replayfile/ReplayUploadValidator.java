package com.wotb.web.replayfile;

import org.springframework.web.multipart.MultipartFile;

public final class ReplayUploadValidator {

    public static final long MAX_FILE_SIZE = 20L * 1024 * 1024;
    public static final long MAX_TOTAL_SIZE = 200L * 1024 * 1024;

    private ReplayUploadValidator() {
    }

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
