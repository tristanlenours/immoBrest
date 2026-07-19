export default {
  base: '/immoBrest/',
  title: 'Brest Immo Hub',
  description: 'Synthèse et fiches des offres immobilières actives à Brest',
  themeConfig: {
    nav: [
      { text: '🏠 Annonces', link: '/' },
      { text: '📊 DVF — Ventes réelles', link: '/dvf/' }
    ],
    search: {
      provider: 'local'
    },
    footer: {
      message: 'Généré automatiquement depuis les données locales',
      copyright: 'Copyright © 2026'
    }
  }
}
