package com.wotb.web.user;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ReplayVerificationBadgeBoundaryTest {

    private static final List<String> ALLOWED = List.of(
            "user/dto/UserProfileDto.java",
            "user/entity/UserProfile.java",
            "user/service/UserProfileMapper.java",
            "user/service/UserProfileService.java");

    @Test
    void badgeIsOnlyReadByTheUserProfileDomain() throws IOException {
        final Path root = Path.of("src/main/java/com/wotb/web");
        final List<String> users;
        try (Stream<Path> files = Files.walk(root)) {
            users = files.filter(p -> p.toString().endsWith(".java"))
                    .filter(p -> {
                        try {
                            final String text = Files.readString(p);
                            return text.contains("WotbAccountVerifiedAt") || text.contains("wotbAccountVerifiedAt");
                        } catch (final IOException e) {
                            throw new IllegalStateException(e);
                        }
                    })
                    .map(p -> root.relativize(p).toString().replace(java.io.File.separatorChar, '/'))
                    .sorted()
                    .toList();
        }
        assertEquals(ALLOWED, users);
    }
}
