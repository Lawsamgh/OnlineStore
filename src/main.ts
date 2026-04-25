import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import { initSupabaseAuth } from './lib/supabaseAuthSync'
import router from './router'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
initSupabaseAuth(pinia, router)
// Avoid a one-frame marketing header flash on deep links (e.g. /dashboard):
// App.vue reads `useRoute()` before the initial navigation + guards finish.
await router.isReady()
app.mount('#app')
