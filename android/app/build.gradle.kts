import groovy.json.JsonSlurper

// AGP 9 built-in Kotlin：不再 apply org.jetbrains.kotlin.android（KGP 版本见根 build.gradle.kts）。
plugins {
    id("com.android.application")
}

/** 随 APK 固定的引擎版本：只用 Mozilla stable channel，精确版本号，升级即一次 Android 发版。 */
private val geckoViewVersion = "158.0.20261007201254"

private val committedWotbVersion = (project.findProperty("wotbVersion") as String?)
    ?: error("android/gradle.properties must define wotbVersion")
private val versionPattern = Regex("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$")
versionPattern.matchEntire(committedWotbVersion)
    ?: error("wotbVersion must be strict X.Y.Z: $committedWotbVersion")
private val resolvedWotbVersion = (project.findProperty("wotbVersionOverride") as String?)
    ?.also { versionPattern.matchEntire(it) ?: error("wotbVersionOverride must be strict X.Y.Z: $it") }
    ?: committedWotbVersion
private val resolvedVersionParts = resolvedWotbVersion.split('.').map(String::toInt)
private val resolvedVersionCode = resolvedVersionParts[0] * 1_000_000 +
    resolvedVersionParts[1] * 1_000 + resolvedVersionParts[2]
require(resolvedVersionParts[0].toString().length <= 4 && resolvedVersionParts[1] <= 999 && resolvedVersionParts[2] <= 999) {
    "Android version segments exceed the versionCode allocation: $resolvedWotbVersion"
}
require(resolvedVersionCode in 1..2_100_000_000) {
    "Android versionCode is outside the supported range: $resolvedVersionCode"
}
private val bridgeContractFile = rootProject.file("../contracts/android-native-bridge.json")
check(bridgeContractFile.isFile) { "Missing contracts/android-native-bridge.json" }
private val bridgeContract = (JsonSlurper().parse(bridgeContractFile) as Map<*, *>)
private val contractBridgeVersion = (bridgeContract["bridgeVersion"] as Number).toInt()
private val propertyBridgeVersion = (project.findProperty("wotbNativeBridgeVersion") as String?)?.toIntOrNull()
    ?: error("android/gradle.properties must define wotbNativeBridgeVersion")
check(propertyBridgeVersion == contractBridgeVersion) {
    "wotbNativeBridgeVersion=$propertyBridgeVersion must match contracts/android-native-bridge.json bridgeVersion=$contractBridgeVersion"
}

// 签名参由 CI（android-release.yml）经 -PwotbKeystore* 注入；本地无 key 时不配置 release 签名。
// 绝不把 keystore/口令写入仓库（规格 §21）。
val keystorePath = (project.findProperty("wotbKeystorePath") as String?)?.takeIf { it.isNotBlank() }
val keystoreStorePass = (project.findProperty("wotbKeystoreStorePass") as String?) ?: ""
// 外层变量避免与 DSL property（SigningConfig.keyAlias）同名遮蔽，否则赋值命中本地 val，
// 导致 release SigningConfig.keyAlias 未被设置（Gradle：SigningConfig "release" is missing required property "keyAlias"）。
val signingKeyAlias = (project.findProperty("wotbKeyAlias") as String?) ?: ""
val keyPass = (project.findProperty("wotbKeyPass") as String?) ?: ""

android {
    namespace = "com.wotbtools.app"
    // GeckoView 158 的 AAR metadata 要求 minCompileSdk=37 / minCompileMinorSdk=2。
    // 只抬 compileSdk；targetSdk 不动（改 targetSdk 会改变运行时行为，不属于本次引擎迁移）。
    compileSdk {
        version = release(37) {
            minorApiLevel = 2
        }
    }

    defaultConfig {
        applicationId = "com.wotbtools.app"
        minSdk = 26
        targetSdk = 34
        // 单个 APK 覆盖全部 ARM 设备（不做 ABI split）；debug 另加 x86_64 供模拟器手测。
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
        versionCode = resolvedVersionCode
        versionName = resolvedWotbVersion
        buildConfigField("int", "NATIVE_BRIDGE_VERSION", contractBridgeVersion.toString())
        buildConfigField("String", "GECKOVIEW_VERSION", "\"$geckoViewVersion\"")
        // AppAuth 库 manifest 用 ${appAuthRedirectScheme} 声明回程 filter；不注入占位符 manifest 合并直接失败。
        // 值只取 scheme 段：库的 filter 只声明 scheme，精确 path 由我们自己的 filter 补充（见 AndroidManifest）。
        manifestPlaceholders["appAuthRedirectScheme"] = "com.wotbtools.app"
    }

    buildFeatures { buildConfig = true }
    // 侧载分发：压缩 Gecko native libs，优先减小下载体积（代价是安装时解压）。
    packaging { jniLibs { useLegacyPackaging = true } }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = keystoreStorePass
                keyAlias = signingKeyAlias
                keyPassword = keyPass
            }
        }
    }

    buildTypes {
        debug {
            ndk { abiFilters += "x86_64" }
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (keystorePath != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    // APK 自带的 Web 引擎（取代设备 System WebView）。仓库来源由 settings.gradle.kts 的 exclusiveContent 锁定。
    implementation("org.mozilla.geckoview:geckoview:$geckoViewVersion")
    // 原生认证（RFC 8252 external user-agent + PKCE S256 + Custom Tabs + App Links）：
    // 库只经浏览器完成授权、**从不使用内嵌 WebView/GeckoView**；固定 0.11.1 是因为上游发布节奏停滞
    // （维护风险与升级路径见 docs/android/architecture.md），升级需单独评审。
    implementation("net.openid:appauth:0.11.1")
    // Pure JVM policy tests.
    testImplementation("junit:junit:4.13.2")
    // Exercise ContentResolver/provider streams without a connected device.
    testImplementation("org.robolectric:robolectric:4.16.1")
}
