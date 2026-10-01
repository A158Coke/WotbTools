<script setup>
import { ref } from 'vue'
import { Check, Copy, Gamepad2, MessageCircle, MessageSquareText } from 'lucide-vue-next'

// design-language §8：不用 emoji 当图标。Lucide 不收录品牌 logo，用语义相近的通用图标，平台名写在卡片标题里
const contacts = [
  { key: 'qq', icon: MessageCircle, value: '1582536892' },
  { key: 'wechat', icon: MessageSquareText, value: 'a1582536892' },
  { key: 'discord', icon: Gamepad2, value: 'a158coke' },
]
const copiedKey = ref(null)

async function copyContact(contact) {
  const ok = await copyText(contact.value)
  if (!ok) return
  copiedKey.value = contact.key
  setTimeout(() => {
    if (copiedKey.value === contact.key) copiedKey.value = null
  }, 1600)
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the textarea fallback
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
</script>

<template>
  <div class="contact-page">
    <h1 class="contact-title">{{ $t('contact.title') }}</h1>
    <p class="contact-subtitle">{{ $t('contact.subtitle') }}</p>

    <div class="contact-grid">
      <div v-for="c in contacts" :key="c.key" class="contact-card">
        <component :is="c.icon" class="contact-icon" :size="28" aria-hidden="true" />
        <h2>{{ $t(`contact.${c.key}`) }}</h2>
        <p class="contact-value">{{ c.value }}</p>
        <button class="copy-btn" @click="copyContact(c)">
          <component :is="copiedKey === c.key ? Check : Copy" :size="16" aria-hidden="true" />
          {{ copiedKey === c.key ? $t('contact.copied') : $t('contact.copy') }}
        </button>
      </div>
    </div>

    <p class="contact-hint">{{ $t('contact.hint') }}</p>
  </div>
</template>

<style scoped>
.contact-page { max-width: 1120px; margin: 0 auto; padding: 22px 24px 56px; }
.contact-title { font-size: 1.3rem; color: var(--text-heading); margin: 8px 0 8px; }
.contact-subtitle { font-size: .9rem; color: var(--text-muted); margin: 0 0 22px; line-height: 1.6; }
.contact-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
.contact-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 20px;
  background: var(--showcase-tactical);
  border: 1px solid var(--showcase-tactical-border);
  border-radius: 8px;
}
.contact-card:hover { border-color: var(--accent); }
.contact-icon { color: var(--color-accent-text); }
.contact-card h2 { font-size: 1rem; color: var(--showcase-tactical-heading); margin: 0; }
.contact-value {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: .92rem;
  color: #d8d5cd;
  background: var(--showcase-tactical-soft-2);
  border: 1px solid rgba(80, 92, 100, .5);
  border-radius: 6px;
  padding: 6px 10px;
  margin: 0;
  word-break: break-all;
}
.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: var(--control-h-sm);
  margin-top: 4px;
  border: 1px solid rgba(80, 92, 100, .55);
  background: rgba(20, 26, 30, .9);
  color: var(--showcase-tactical-text);
  border-radius: 7px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: .82rem;
  font-family: inherit;
}
.copy-btn:hover { background: rgba(30, 38, 43, .9); border-color: var(--accent); color: #f0a42b; }
.contact-hint { margin-top: 18px; font-size: .78rem; color: var(--showcase-tactical-muted); }
@media (width < 768px) { .contact-page { padding: 14px 12px 44px; } }
</style>
