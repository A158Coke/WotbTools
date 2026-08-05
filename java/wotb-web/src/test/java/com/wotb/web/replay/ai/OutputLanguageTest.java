package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class OutputLanguageTest {

    @Test
    void parsesWhitelistCaseInsensitively() {
        assertEquals(OutputLanguage.ZH, OutputLanguage.fromCode("zh"));
        assertEquals(OutputLanguage.ZH, OutputLanguage.fromCode("ZH"));
        assertEquals(OutputLanguage.EN, OutputLanguage.fromCode("en"));
        assertEquals(OutputLanguage.EN, OutputLanguage.fromCode("En"));
        assertEquals(OutputLanguage.RU, OutputLanguage.fromCode("ru"));
        assertEquals(OutputLanguage.RU, OutputLanguage.fromCode("RU "));
    }

    @Test
    void rejectsMissingAndUnknownCodes() {
        assertNull(OutputLanguage.fromCode(null));
        assertNull(OutputLanguage.fromCode(""));
        assertNull(OutputLanguage.fromCode("fr"));
        assertNull(OutputLanguage.fromCode("zh-CN"));
        assertNull(OutputLanguage.fromCode("en-US"));
    }

    @Test
    void zhDirectiveIsEmpty() {
        assertEquals("", OutputLanguage.ZH.directive());
    }

    @Test
    void enDirectiveRequestsEnglishWithLocalizedTimeFormat() {
        final String directive = OutputLanguage.EN.directive();
        assertTrue(directive.contains("英文"));
        assertTrue(directive.contains("1min 15s"));
        assertTrue(directive.contains("3min 0s"));
    }

    @Test
    void ruDirectiveRequestsRussianWithLocalizedTimeFormat() {
        final String directive = OutputLanguage.RU.directive();
        assertTrue(directive.contains("俄语"));
        assertTrue(directive.contains("мин"));
    }

}
