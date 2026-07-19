import DefaultTheme from 'vitepress/theme'
import Dashboard from './components/Dashboard.vue'
import DvfDashboard from './components/DvfDashboard.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Dashboard', Dashboard)
    app.component('DvfDashboard', DvfDashboard)
  }
}
