package com.wotb.web;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class WotbWebApplication {
    public static void main(final String[] args) {
        SpringApplication.run(WotbWebApplication.class, args);
    }
}
