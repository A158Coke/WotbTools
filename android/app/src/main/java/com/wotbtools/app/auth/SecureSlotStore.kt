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

internal interface SecureSlotStore {

    fun read(slot: String): String?

    fun write(slot: String, value: String): Boolean

    fun clear(slot: String, reason: String)
}

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
        clear(slot, "write-failed:${e.javaClass.simpleName}")
        false
    }

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
