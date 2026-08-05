package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

class AllowedLanguageTest {

    @Test
    void parsesWhitelistCaseInsensitively() {
        assertEquals(AllowedLanguage.ZH, AllowedLanguage.fromCode("zh"));
        assertEquals(AllowedLanguage.ZH, AllowedLanguage.fromCode("ZH"));
        assertEquals(AllowedLanguage.EN, AllowedLanguage.fromCode("en"));
        assertEquals(AllowedLanguage.EN, AllowedLanguage.fromCode("En"));
        assertEquals(AllowedLanguage.RU, AllowedLanguage.fromCode("ru"));
        assertEquals(AllowedLanguage.RU, AllowedLanguage.fromCode("RU "));
    }

    @Test
    void rejectsMissingAndUnknownCodes() {
        assertNull(AllowedLanguage.fromCode(null));
        assertNull(AllowedLanguage.fromCode(""));
        assertNull(AllowedLanguage.fromCode("  "));
        assertNull(AllowedLanguage.fromCode("fr"));
        assertNull(AllowedLanguage.fromCode("zh-CN"));
        assertNull(AllowedLanguage.fromCode("en-US"));
    }

    @Test
    void codesMatchFrontendLocales() {
        assertEquals("zh", AllowedLanguage.ZH.code());
        assertEquals("en", AllowedLanguage.EN.code());
        assertEquals("ru", AllowedLanguage.RU.code());
    }
}
