package com.wotb.control;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** Independent Control API entrypoint; it does not replace the existing Web application. */
@SpringBootApplication
public class ControlApiApplication {
    private ControlApiApplication() {
    }

    public static void main(final String[] args) {
        SpringApplication.run(ControlApiApplication.class, args);
    }
}
