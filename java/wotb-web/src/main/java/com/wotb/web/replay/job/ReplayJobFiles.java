package com.wotb.web.replay.job;

import com.wotb.core.model.Source;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.AbstractList;
import java.util.Comparator;
import java.util.List;

/**
 * Replay Job 共享的临时输入文件工具（Export Job 与 Replay Processing Job 共用，
 * plan §3 避免两套几乎相同的 job infrastructure）。
 *
 * <p>关键契约（PR #118 Blocker 1）：上传按 {@code N__name} 数字前缀持久化，处理时按
 * 前缀整数排序，严格保持 {@code MultipartFile[]} 原始上传顺序（10+ 时不得回退到
 * filename 字典序：0,1,10,11,…,2,…）。无法解析数字前缀的文件排最后（防御性）。</p>
 */
final class ReplayJobFiles {

    private ReplayJobFiles() {
    }

    /**
     * 按上传序号前缀（{@code 0__name}、{@code 1__name}、… {@code 10__name}）整数排序，
     * 严格保持上传顺序。无法解析数字前缀的文件排最后（不插入有效顺序中间）。
     */
    static List<Path> listInputsInOrder(final Path inputDir) throws IOException {
        try (var stream = Files.list(inputDir)) {
            return stream.sorted(Comparator.comparingInt(ReplayJobFiles::inputOrder)).toList();
        }
    }

    /** 解析 {@code N__rest} 的数字前缀；无法解析时返回 {@link Integer#MAX_VALUE}。 */
    static int inputOrder(final Path p) {
        final String file = p.getFileName().toString();
        final int sep = file.indexOf("__");
        if (sep <= 0) {
            return Integer.MAX_VALUE;
        }
        try {
            return Integer.parseInt(file.substring(0, sep));
        } catch (final NumberFormatException e) {
            return Integer.MAX_VALUE;
        }
    }

    /** 输入文件名安全化（防路径分隔符/异常字符）。 */
    static String sanitizeFileName(final String name) {
        final String safe = name.replace('\\', '_').replace('/', '_');
        return safe.isBlank() ? "replay.wotbreplay" : safe;
    }

    /** 去掉 {@code N__} 前缀还原原始文件名。 */
    static String inputName(final Path p) {
        final String file = p.getFileName().toString();
        final int sep = file.indexOf("__");
        return sep >= 0 ? file.substring(sep + 2) : file;
    }

    /**
     * 惰性 Source 列表：逐文件从磁盘读取（不在堆内一次性持有全部上传字节，O(1)
     * working set，PR #118 Blocker B 同款）。
     */
    static List<Source> lazySources(final List<Path> inputs) {
        return new AbstractList<>() {
            @Override
            public Source get(final int index) {
                final Path p = inputs.get(index);
                try {
                    return new Source(inputName(p), Files.readAllBytes(p));
                } catch (final IOException e) {
                    throw new UncheckedIOException(e);
                }
            }

            @Override
            public int size() {
                return inputs.size();
            }
        };
    }

    static String stripExt(final String name) {
        final int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }
}
