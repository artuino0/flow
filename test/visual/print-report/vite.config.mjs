import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const fixture = fileURLToPath(new URL('./', import.meta.url))
export default defineConfig({
  root: fixture,
  resolve: { alias: { '~': root } },
  plugins: [{ name: 'nuxt-report-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('.vue') || !id.includes('components/PrintReport')) return
    const imports = `import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';\nimport { useFetch, useHead, useRequestHeaders } from '${path.join(fixture, 'runtime.mjs').replaceAll('\\', '/')}';\n`
    const components = id.endsWith('PrintReportSheet.vue') ? `import PrintReportPage from './PrintReportPage.vue';\n` : id.endsWith('PrintReportPreview.vue') ? `import PrintReportSheet from './PrintReportSheet.vue';\nimport PrintReportLayoutControls from './PrintReportLayoutControls.vue';\n` : ''
    return code.replace('<script setup lang="ts">', '<script setup lang="ts">\n' + imports + components)
  } }, vue()],
  server: { host: '127.0.0.1', port: 3015, strictPort: true, fs: { allow: [root] } }
})
