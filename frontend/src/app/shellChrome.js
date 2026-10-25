import { computed, reactive } from 'vue'

/** AppShell 的沉浸态 owner 表：至少一个申请方在申请时外壳就保持沉浸（契约见 shared/shellChrome.ts）。 */
export function createShellChrome() {
  const owners = reactive(new Set())
  return {
    immersive: computed(() => owners.size > 0),
    request(owner, on) {
      if (on) owners.add(owner)
      else owners.delete(owner)
    },
  }
}
