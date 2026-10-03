package com.wotbtools.app.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 加密槽位存储：一个 slot 一份密文，Keystore 密钥由所有 slot 共用。
 *
 * 存在的理由只有一个 —— 认证有**两个互不相干的状态域**：
 *
 *  - 进行中的授权交易（pending OIDC transaction，由 [AuthTransactionStore] 拥有）；
 *  - 已建立的会话（AppAuth `AuthState`，由 [AuthSessionStore] 拥有）。
 *
 * 两个域各有自己的 slot，因此「读会话」不会解析、也不会清掉交易，「清交易」也不会碰到会话。
 * 这正是把两者放进同一个 slot 时无法保证的性质：旧实现里 `authGetState` 会把持久化的
 * `AuthorizationRequest` 当成 `AuthState` 解析，解析失败就把整份状态（包括正在进行的交易）
 * 一起清掉，于是回程 callback 再也无法通过校验。
 *
 * 所有实现必须遵守同一个失败姿态：读不到 / 解不开 / 内容不合法 ⇒ 清空**该 slot**并返回
 * null；绝不抛、绝不返回半成品、绝不回退明文、绝不顺手清理别的 slot。
 */
internal interface SecureSlotStore {

    /** 读取并解密一个 slot；缺失或损坏一律 null（该 slot 已被清空）。 */
    fun read(slot: String): String?

    /** 写入加密值；false 表示没有成功落盘（此时该 slot 不留下任何旧值）。 */
    fun write(slot: String, value: String): Boolean

    /** 清空一个 slot（幂等）。reason 只用于日志分类，绝不携带内容。 */
    fun clear(slot: String, reason: String)
}

/**
 * Android 实现：Android Keystore + AES-256-GCM，密文（base64 IV + base64 ciphertext）落在
 * app private `SharedPreferences`（`MODE_PRIVATE`，且 manifest 关闭了 allowBackup）。
 *
 * 安全边界：
 *  - 密钥只存在于 `AndroidKeyStore`（alias [KEY_ALIAS]），生成时固定用途（GCM / 无 padding）
 *    且**不要求用户认证**（登录是后台刷新前提，要求解锁会把 refresh 变成随机失败）；
 *    密钥不可导出，进程内也拿不到原始字节。
 *  - GCM 自带完整性校验：任何篡改/损坏都会在 `doFinal` 抛 `AEADBadTagException`，
 *    而不是解出一段可疑明文。
 *  - 日志只记录 slot 名与原因分类，token / claims / 授权码 / verifier / 密文与 IV 一律不出现。
 */
internal class KeystoreSlotStore(context: Context) : SecureSlotStore {

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override fun read(slot: String): String? {
        val stored = prefs.getString(slot, null)
        if (stored.isNullOrBlank()) return null
        return try {
            decrypt(stored)
        } catch (e: Exception) {
            clear(slot, e.javaClass.simpleName)
            null
        }
    }

    override fun write(slot: String, value: String): Boolean = try {
        val encrypted = encrypt(value)
        val committed = prefs.edit().putString(slot, encrypted).commit()
        if (!committed) clear(slot, "write-not-committed")
        committed
    } catch (e: Exception) {
        // 写失败绝不能留下旧值：两份互相矛盾的状态比没有状态更危险。
        clear(slot, "write-failed:${e.javaClass.simpleName}")
        false
    }

    /**
     * 用 `commit()` 而不是 `apply()`：调用方紧接着可能返回「未认证 / 无交易」，而 `apply()` 是
     * 异步落盘，进程随后被杀就可能把已经撤销的状态又留在磁盘上。
     */
    override fun clear(slot: String, reason: String) {
        if (prefs.contains(slot)) prefs.edit().remove(slot).commit()
        Log.d(TAG, "auth-slot cleared slot=$slot reason=$reason")
    }

    private fun encrypt(plainText: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val ciphertext = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + SEPARATOR +
            Base64.encodeToString(ciphertext, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String? {
        val separator = stored.indexOf(SEPARATOR)
        if (separator <= 0) return null
        val iv = Base64.decode(stored.substring(0, separator), Base64.NO_WRAP)
        val ciphertext = Base64.decode(stored.substring(separator + 1), Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    }

    /**
     * 取密钥：存在就复用，不存在就生成（`setUserAuthenticationRequired(false)` —— 见类注释）。
     * 每次现取，不在字段里缓存 `SecretKey`：keystore 可能在系统事件后失效，缓存会拿到失效引用。
     */
    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(KEY_SIZE_BITS)
                .setUserAuthenticationRequired(false)
                .build()
        )
        return generator.generateKey()
    }

    private companion object {
        const val TAG = "WotbAuth"
        const val PREFS_NAME = "wotb_auth_state"
        const val KEY_ALIAS = "wotbtools.auth.v1"
        const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val KEY_SIZE_BITS = 256
        const val GCM_TAG_BITS = 128
        const val SEPARATOR = ":"
    }
}
