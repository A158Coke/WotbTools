<script setup>
import {ref} from 'vue'

const contacts = [
  { key: 'qq', icon: '🐧', value: '1582536892' },
  { key: 'wechat', icon: '💬', value: 'a1582536892' },
  { key: 'discord', icon: '🎮', value: 'a158coke' },
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
        <span class="contact-icon" aria-hidden="true">{{ c.icon }}</span>
        <h2>{{ $t(`contact.${c.key}`) }}</h2>
        <p class="contact-value">{{ c.value }}</p>
        <button class="copy-btn" @click="copyContact(c)">
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
  background: linear-gradient(180deg, var(--bg-card), color-mix(in srgb, var(--bg-card2) 42%, var(--bg-card)));
  border: 1px solid var(--border);
  border-radius: 8px;
}
.contact-card:hover { border-color: var(--accent); }
.contact-icon { font-size: 1.7rem; line-height: 1; }
.contact-card h2 { font-size: 1rem; color: var(--text-heading); margin: 0; }
.contact-value {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: .92rem;
  color: var(--text-label);
  background: var(--bg-card2);
  border: 1px solid var(--border-ghost);
  border-radius: 6px;
  padding: 6px 10px;
  margin: 0;
  word-break: break-all;
}
.copy-btn {
  margin-top: 4px;
  border: 1px solid var(--border-ghost);
  background: var(--bg-card2);
  color: var(--text-label);
  border-radius: 7px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: .82rem;
  font-family: inherit;
}
.copy-btn:hover { background: var(--bg-card-hover); border-color: var(--accent); color: var(--accent-dark); }
.contact-hint { margin-top: 18px; font-size: .78rem; color: var(--text-muted); }
@media (max-width: 560px) { .contact-page { padding: 14px 12px 44px; } }
</style>
