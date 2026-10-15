// Root build script — only declares plugin versions so subprojects can apply them.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        // AGP 9 内置 Kotlin 默认依赖 KGP 2.2.10；GeckoView 158 依赖 kotlin-stdlib 2.4.20，
        // 2.2 编译器读不了 2.4 metadata。按 AGP 官方方式把更高的 KGP 放上 classpath（模块不再 apply 插件）。
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}

plugins {
    id("com.android.application") version "9.4.1" apply false
}
