<script setup>
// 下拉菜单（design-language §7 Menu）：WAI-ARIA menu button。
// 打开后焦点进入第一项；方向键 / Home / End 移动，Esc 关闭并把焦点还给触发按钮，Tab 或点外部关闭。
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

// data-testid 等属性落在触发按钮上，而不是外层容器
defineOptions({ inheritAttrs: false })

const props = defineProps({
  label: { type: String, required: true },
  items: { type: Array, required: true }, // [{ key, label, disabled?, testid? }]
  variant: { type: String, default: 'secondary', validator: v => ['secondary', 'ghost'].includes(v) },
  disabled: { type: Boolean, default: false },
  icon: { type: [Object, Function], default: null },
})
const emit = defineEmits(['select'])

const open = ref(false)
const root = ref(null)
const trigger = ref(null)
const menu = ref(null)
const menuId = `menu-${Math.random().toString(36).slice(2, 9)}`

function menuItems() {
  return [...(menu.value?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])]
}

async function openMenu(focus = 'first') {
  if (props.disabled) return
  open.value = true
  await nextTick()
  const items = menuItems()
  ;(focus === 'last' ? items[items.length - 1] : items[0])?.focus()
}

function closeMenu({ restoreFocus = false } = {}) {
  if (!open.value) return
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}

function onTriggerKeydown(event) {
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    openMenu('first')
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    openMenu('last')
  }
}

function onMenuKeydown(event) {
  const items = menuItems()
  const index = items.indexOf(document.activeElement)
  const target = {
    ArrowDown: items[(index + 1) % items.length],
    ArrowUp: items[(index - 1 + items.length) % items.length],
    Home: items[0],
    End: items[items.length - 1],
  }[event.key]
  if (target) {
    event.preventDefault()
    target.focus()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu({ restoreFocus: true })
  } else if (event.key === 'Tab') {
    closeMenu()
  }
}

function choose(item) {
  if (item.disabled) return
  closeMenu({ restoreFocus: true })
  emit('select', item.key)
}

function onDocumentPointerDown(event) {
  if (!root.value?.contains(event.target)) closeMenu()
}

watch(open, (value) => {
  if (value) document.addEventListener('pointerdown', onDocumentPointerDown)
  else document.removeEventListener('pointerdown', onDocumentPointerDown)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<template>
  <div ref="root" class="menu-button">
    <button
      ref="trigger"
      type="button"
      class="menu-trigger"
      :class="`is-${variant}`"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      :disabled="disabled"
      v-bind="$attrs"
      @click="open ? closeMenu() : openMenu()"
      @keydown="onTriggerKeydown"
    >
      <component :is="icon" v-if="icon" :size="16" aria-hidden="true" />
      <span>{{ label }}</span>
      <ChevronDown :size="16" aria-hidden="true" />
    </button>
    <div v-if="open" :id="menuId" ref="menu" class="menu" role="menu" :aria-label="label" @keydown="onMenuKeydown">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        role="menuitem"
        class="menu-item"
        tabindex="-1"
        :disabled="item.disabled"
        :data-testid="item.testid"
        @click="choose(item)"
      >{{ item.label }}</button>
    </div>
  </div>
</template>

<style scoped>
.menu-button { position: relative; display: inline-flex; }

.menu-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-h-md);
  padding: 0 var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-primary);
  font: var(--type-body);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.menu-trigger.is-secondary { border-color: var(--color-border-strong); background: var(--color-surface-1); }
.menu-trigger:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.menu-trigger:disabled { cursor: not-allowed; opacity: .5; }

.menu {
  position: absolute;
  top: calc(100% + var(--space-1));
  right: 0;
  z-index: var(--z-menu);
  display: grid;
  min-width: 200px;
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-3);
  box-shadow: var(--elevation-2);
}

.menu-item {
  min-height: var(--control-h-md);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
  white-space: nowrap;
  cursor: pointer;
}

.menu-item:focus-visible { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }
.menu-item:disabled { color: var(--color-text-tertiary); cursor: not-allowed; }

@media (hover: hover) {
  .menu-trigger:not(:disabled):hover { background: var(--color-surface-2); }
  .menu-item:not(:disabled):hover { background: var(--color-surface-2); }
}
</style>
