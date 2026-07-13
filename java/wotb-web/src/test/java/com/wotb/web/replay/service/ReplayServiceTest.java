package com.wotb.web.replay.service;

import org.junit.jupiter.api.Test;
import org.springframework.web.multipart.MultipartFile;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ReplayServiceTest {

    @Test
    void rejectsNullReplayEntry() {
        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> ReplayService.validateUploads(new MultipartFile[]{null}));

        assertEquals("INVALID_REPLAY_FILE", error.getMessage());
    }

    @Test
    void rejectsTooManyReplayFilesBeforeReadingThem() {
        final MultipartFile file = multipartFile(1);
        final MultipartFile[] files = new MultipartFile[ReplayService.MAX_REPLAY_FILES + 1];
        Arrays.fill(files, file);

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> ReplayService.validateUploads(files));

        assertEquals("TOO_MANY_REPLAY_FILES", error.getMessage());
    }

    @Test
    void rejectsOversizedReplayFile() {
        final MultipartFile file = multipartFile(ReplayService.MAX_REPLAY_FILE_BYTES + 1);

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> ReplayService.validateUploads(new MultipartFile[]{file}));

        assertEquals("FILE_TOO_LARGE", error.getMessage());
    }

    @Test
    void rejectsOversizedAggregateRequest() {
        final MultipartFile file = multipartFile(ReplayService.MAX_REPLAY_FILE_BYTES);
        final MultipartFile[] files = new MultipartFile[11];
        Arrays.fill(files, file);

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> ReplayService.validateUploads(files));

        assertEquals("REQUEST_TOO_LARGE", error.getMessage());
    }

    private static MultipartFile multipartFile(final long size) {
        final MultipartFile file = mock(MultipartFile.class);
        when(file.getSize()).thenReturn(size);
        return file;
    }
}
