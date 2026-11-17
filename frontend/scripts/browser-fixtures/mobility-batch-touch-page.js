import { createApp, h, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import messages from '../../src/locales/zh.json'
import MobilityBatchDialog from '../../src/components/MobilityBatchDialog.vue'
import '../../src/styles/tokens/scale.css'
import '../../src/styles/tokens/color.css'
import '../../src/styles/tokens.css'

const entries = ['Source', 'CS-63', 'Long vehicle alias with a different configuration'].map((alias, i) => ({
  id: String(i), tank: i + 1, alias, dataset: 'fixture', activations: {},
}))
const context = {
  modules: { turrets: [{ stem: 'turret', guns: [{ stem: 'gun' }] }], engines: [{ stem: 'engine' }], chassis: [{ stem: 'track' }] },
  provisions: [{ stem: 'improved_fuel', name_en: 'Improved fuel' }],
  provisionSlots: 3,
  selection: {
    canConfigure: true, config: 0, turret: 0, gun: 0, engine: 0, track: 0, shell: 0,
    devices: Array(9).fill(null), provisions: [], consumables: [], skills: {}, camouflage: false,
  },
}
const contexts = new Map(entries.map((entry, i) => [entry.id,
  { ...context, selection: { ...context.selection, provisions: i ? [] : ['improved_fuel'] } },
]))

createApp({
  setup() {
    const open = ref(true)
    const applied = ref([])
    return () => [
      h('output', { id: 'applied' }, JSON.stringify(applied.value)),
      open.value && h(MobilityBatchDialog, {
        group: 'provisions', source: entries[0], entries, contexts, dataset: 'fixture',
        onClose: () => { open.value = false },
        onApply: changes => { applied.value = [...changes.keys()]; open.value = false },
      }),
    ]
  },
}).use(createI18n({ legacy: false, locale: 'zh', messages: { zh: messages } })).mount('#app')
