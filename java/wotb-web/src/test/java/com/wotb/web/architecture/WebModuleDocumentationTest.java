package com.wotb.web.architecture;

import com.wotb.web.WotbWebApplication;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;
import org.springframework.modulith.docs.Documenter;

class WebModuleDocumentationTest {

    @Test
    void writesDocumentationFromTheVerifiedProductionGraph() {
        final ApplicationModules modules = ApplicationModules.of(WotbWebApplication.class);
        modules.verify();
        new Documenter(modules).writeDocumentation();
    }
}
