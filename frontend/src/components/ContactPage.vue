<script setup>
import { showToast } from '../composables/useToast.js'
import { inject, ref } from 'vue'
import { ArrowRight, Check, Copy, Gamepad2, MessageCircle, MessageSquare, MessageSquareText } from 'lucide-vue-next'
import { FEEDBACK_KEY } from '../shared/feedback.js'
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
const openFeedback = inject(FEEDBACK_KEY, null)

async function copyContact(contact) {
  const ok = await copyText(contact.value)
  if (!ok) return
  showToast({ id: 'copy', tone: 'success', titleKey: 'toast.copied' })
  copiedKey.value = contact.key
  setTimeout(() => {
    if (copiedKey.value === contact.key) copiedKey.value = null
  }, 1600)
}
</script>

<template>
  <div class="contact-page layout-content">
    <PageHeader :title="$t('contact.title')" :description="$t('contact.subtitle')" />

    <!-- 最快的方式：站内反馈（4.0「联系我」稿） -->
    <button v-if="openFeedback" type="button" class="contact-feedback" data-testid="contact-feedback" @click="openFeedback()">
      <MessageSquare class="contact-feedback-icon" :size="24" aria-hidden="true" />
      <span class="contact-feedback-text"><strong>{{ $t('contact.fastestTitle') }}</strong><span>{{ $t('contact.fastestDesc') }}</span></span>
      <ArrowRight :size="20" aria-hidden="true" />
    </button>

    <div class="contact-grid">
      <div v-for="c in contacts" :key="c.key" class="contact-card">
        <component :is="c.icon" class="contact-icon" :size="28" aria-hidden="true" />
        <h2>{{ $t(`contact.${c.key}`) }}</h2>
        <p class="contact-value">{{ c.value }}</p>
        <AppButton class="copy-btn" :confirmed="copiedKey === c.key" :aria-label="`${$t('contact.copy')} ${c.value}`" @click="copyContact(c)">
          <component :is="copiedKey === c.key ? Check : Copy" :size="16" aria-hidden="true" />
          {{ copiedKey === c.key ? $t('contact.copied') : $t('contact.copy') }}
        </AppButton>
      </div>
    </div>

    <!-- 正式投诉/举报渠道声明（公安自评估「是否建立投诉举报机制」），整段保留。放在联系方式卡片
         下方，文案里的「上方联系方式」指向真实入口。 -->
    <section class="contact-report" data-testid="contact-report">
      <h2>{{ $t('contact.report_title') }}</h2>
      <p>{{ $t('contact.report_body') }}</p>
    </section>

    <p class="contact-hint">{{ $t('contact.hint') }}</p>
  </div>
</template>

<style scoped>
.contact-feedback {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  margin: 0 0 var(--space-6);
  padding: var(--space-5) var(--space-6);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-lg);
  background: color-mix(in oklab, var(--color-accent) 10%, var(--color-surface-1));
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
  cursor: pointer;
}
.contact-feedback:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.contact-feedback-icon { flex: none; color: var(--color-accent-text); }
.contact-feedback-text { display: grid; flex: 1 1 auto; gap: var(--space-1); min-width: 0; }
.contact-feedback-text strong { font: var(--type-h3); }
.contact-feedback-text span { color: var(--color-text-secondary); }
.contact-report {
  margin: var(--space-6) 0 0;
  padding: var(--space-4) var(--space-5);
  border-inline-start: var(--space-1) solid var(--color-danger);
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
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
.contact-value { margin: 0; color: var(--color-text-primary); font: var(--type-h2); font-family: var(--font-family-mono); overflow-wrap: anywhere; }
.copy-btn { margin-top: var(--space-2); }
.contact-hint { margin: var(--space-4) 0 0; color: var(--color-text-secondary); font: var(--type-body); line-height: var(--line-height-prose); }
@media (width < 768px) { .contact-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
