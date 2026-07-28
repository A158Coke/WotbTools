package com.wotb.web.replay.exception;

public class ReplayFileCountExceededException extends RuntimeException {
    private final int maxFiles;
    private final int actualFiles;

    public ReplayFileCountExceededException(final int maxFiles, final int actualFiles) {
        super("REPLAY_FILE_COUNT_EXCEEDED");
        this.maxFiles = maxFiles;
        this.actualFiles = actualFiles;
    }

    public int getMaxFiles() {
        return maxFiles;
    }

    public int getActualFiles() {
        return actualFiles;
    }
}
