<script setup>
import { ref } from 'vue'
import { Check, Copy, Gamepad2, MessageCircle, MessageSquareText } from 'lucide-vue-next'
import AppButton from './AppButton.vue'
import PageHeader from './PageHeader.vue'
import { copyText } from '../utils/clipboard.js'

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
</script>

<template>
  <div class="contact-page layout-content">
    <PageHeader :title="$t('contact.title')" :description="$t('contact.subtitle')" />

    <!-- 正式投诉/举报渠道声明（公安自评估「是否建立投诉举报机制」）。放在联系方式卡片
         上方，文案里的「下方联系方式」才指向真实入口。 -->
    <section class="contact-report">
      <h2>{{ $t('contact.report_title') }}</h2>
      <p>{{ $t('contact.report_body') }}</p>
    </section>

    <div class="contact-grid">
      <div v-for="c in contacts" :key="c.key" class="contact-card">
        <component :is="c.icon" class="contact-icon" :size="28" aria-hidden="true" />
        <h2>{{ $t(`contact.${c.key}`) }}</h2>
        <p class="contact-value">{{ c.value }}</p>
        <AppButton class="copy-btn" :aria-label="`${$t('contact.copy')} ${c.value}`" @click="copyContact(c)">
          <component :is="copiedKey === c.key ? Check : Copy" :size="16" aria-hidden="true" />
          {{ copiedKey === c.key ? $t('contact.copied') : $t('contact.copy') }}
        </AppButton>
      </div>
    </div>

    <p class="contact-hint">{{ $t('contact.hint') }}</p>
  </div>
</template>

<style scoped>
.contact-report {
  margin: 0 0 var(--space-6);
  padding: var(--space-6);
  background: var(--color-surface-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}
.contact-report h2 { margin: 0 0 var(--space-3); color: var(--color-text-primary); font: var(--type-h3); }
.contact-report p { margin: 0; color: var(--color-text-secondary); font: var(--type-body); line-height: var(--line-height-prose); }
.contact-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); }
.contact-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-6);
  background: var(--color-surface-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}
.contact-icon { color: var(--color-accent-text); }
.contact-card h2 { margin: 0; color: var(--color-text-primary); font: var(--type-h3); }
.contact-value { margin: 0; color: var(--color-text-secondary); font: var(--type-body); font-family: var(--font-family-mono); overflow-wrap: anywhere; }
.copy-btn { margin-top: var(--space-2); }
.contact-hint { margin: var(--space-5) 0 0; color: var(--color-text-secondary); font: var(--type-body); line-height: var(--line-height-prose); }
@media (width < 768px) { .contact-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
