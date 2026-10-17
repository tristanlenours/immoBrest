import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '../../')

function sasModerationPlugin() {
  return {
    name: 'immo-brest-sas-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method === 'POST' && req.url && req.url.endsWith('/api/sas/action')) {
          let body = ''
          req.on('data', chunk => {
            body += chunk.toString()
          })
          req.on('end', () => {
            try {
              const payload = JSON.parse(body || '{}')
              const { action, target } = payload
              if (!action || !target) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok: false, error: 'Missing action or target' }))
                return
              }

              const manageSasPath = path.resolve(rootDir, '.agents/skills/leboncoin_fetch/scripts/manage_sas.js')
              delete require.cache[require.resolve(manageSasPath)]
              const { approveListing, rejectListing } = require(manageSasPath)

              let processed = []
              if (action === 'approve') {
                processed = approveListing(target)
              } else if (action === 'reject') {
                processed = rejectListing(target)
              } else {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ ok: false, error: `Unknown action: ${action}` }))
                return
              }

              const dataFile = path.resolve(rootDir, 'docs/public/listings_data.json')
              const freshData = fs.existsSync(dataFile)
                ? JSON.parse(fs.readFileSync(dataFile, 'utf8'))
                : { listings: [], sas_listings: [] }

              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, processed, data: freshData }))
            } catch (err) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: err.message }))
            }
          })
          return
        }
        next()
      })
    }
  }
}

export default {
  base: '/immoBrest/',
  title: 'Brest Immo Hub',
  description: 'Synthèse et fiches des offres immobilières actives à Brest',
  vite: {
    plugins: [sasModerationPlugin()]
  },
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
