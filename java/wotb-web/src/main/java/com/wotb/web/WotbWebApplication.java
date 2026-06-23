package com.wotb.web;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.core.env.Environment;

import java.awt.Desktop;
import java.io.IOException;
import java.net.ServerSocket;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;

@SpringBootApplication
public class WotbWebApplication {
    public static void main(String[] args) {
        boolean desktop = false;
        for (String arg : args) {
            if ("--desktop".equals(arg)) {
                desktop = true;
                break;
            }
        }

        if (desktop) {
            int port = choosePort(8087);
            List<String> desktopArgs = new ArrayList<>(List.of(args));
            desktopArgs.add("--app.desktop=true");
            desktopArgs.add("--server.address=127.0.0.1");
            desktopArgs.add("--server.port=" + port);
            args = desktopArgs.toArray(String[]::new);
        }
        SpringApplication.run(WotbWebApplication.class, args);
    }

    @Bean
    ApplicationRunner desktopBrowserLauncher(Environment env) {
        return new ApplicationRunner() {
            @Override
            public void run(ApplicationArguments args) {
                if (!env.getProperty("app.desktop", Boolean.class, false)) {
                    return;
                }
                int port = env.getProperty("local.server.port", Integer.class,
                        env.getProperty("server.port", Integer.class, 8087));
                openBrowser("http://127.0.0.1:" + port + "/");
            }
        };
    }

    private static int choosePort(int preferred) {
        for (int port = preferred; port < preferred + 100; port++) {
            if (available(port)) {
                return port;
            }
        }
        throw new IllegalStateException("No available local port found near " + preferred);
    }

    private static boolean available(int port) {
        try (ServerSocket socket = new ServerSocket(port)) {
            socket.setReuseAddress(true);
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    private static void openBrowser(String url) {
        try {
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(URI.create(url));
                return;
            }
        } catch (Exception ignored) {
            // Fall through to Windows shell fallback.
        }
        try {
            new ProcessBuilder("rundll32", "url.dll,FileProtocolHandler", url).start();
        } catch (IOException ignored) {
            System.out.println("Open this URL in your browser: " + url);
        }
    }
}
