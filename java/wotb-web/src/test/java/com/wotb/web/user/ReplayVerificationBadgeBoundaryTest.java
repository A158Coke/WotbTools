package com.wotb.web.user;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * 「用回放验证」徽章的边界（产品决策，docs/features/user-profile.md）：录像者 accountId 是客户端声称、
 * 可伪造的便利信息，徽章<b>不授予权限、不参与授权、不是身份安全边界</b>。
 *
 * <p>源码守卫：{@code wotbAccountVerifiedAt} 只允许出现在 user 域的实体 / DTO / Mapper / Service（读写徽章本身），
 * 任何安全配置、授权判定或其它业务域读取它都会让这里失败——想让它影响权限，先推翻产品决策。</p>
 */
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
