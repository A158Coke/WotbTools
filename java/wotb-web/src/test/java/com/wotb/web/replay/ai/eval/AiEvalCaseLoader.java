package com.wotb.web.replay.ai.eval;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 从 classpath:ai-eval/cases/*.json 加载 golden cases（按 id 稳定排序）。
 */
public final class AiEvalCaseLoader {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AiEvalCaseLoader() {
    }

    public static List<AiEvalCase> loadAll() {
        try {
            final Resource[] resources = new PathMatchingResourcePatternResolver()
                    .getResources("classpath*:ai-eval/cases/*.json");
            final List<AiEvalCase> cases = new ArrayList<>();
            for (final Resource resource : resources) {
                try (InputStream in = resource.getInputStream()) {
                    cases.add(MAPPER.readValue(in, AiEvalCase.class));
                }
            }
            cases.sort(Comparator.comparing(AiEvalCase::id));
            return cases;
        } catch (final IOException e) {
            throw new IllegalStateException("Failed to load AI eval golden cases", e);
        }
    }
}
