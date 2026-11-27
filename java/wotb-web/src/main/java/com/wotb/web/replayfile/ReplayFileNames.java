package com.wotb.web.replayfile;

import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

public final class ReplayFileNames {

    private static final int MAX_ORIGINAL_NAME = 255;

    private ReplayFileNames() {
    }

    public static String originalName(final MultipartFile file) {
        final String name = file.getOriginalFilename();
        String base = "";
        if (name != null) {
            final int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
            base = slash >= 0 ? name.substring(slash + 1) : name;
        }
        if (!StringUtils.hasText(base)) {
            return "replay.wotbreplay";
        }
        return base.length() <= MAX_ORIGINAL_NAME
                ? base : base.substring(0, MAX_ORIGINAL_NAME);
    }
}
