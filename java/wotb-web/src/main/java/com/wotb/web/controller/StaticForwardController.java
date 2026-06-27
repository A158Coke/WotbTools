package com.wotb.web.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/** Static page aliases for multi-page frontend builds. */
@Controller
public class StaticForwardController {

    @GetMapping("/extended")
    public String extended() {
        return "forward:/extended.html";
    }
}