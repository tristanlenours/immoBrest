<template>
  <div class="dvf-dashboard">

    <!-- Hero -->
    <div class="dvf-hero">
      <div class="dvf-hero-inner">
        <div class="dvf-hero-left">
          <div class="dvf-hero-icon">📊</div>
          <div>
            <h1 class="dvf-hero-title">Ventes Réelles — DVF Brest</h1>
            <p class="dvf-hero-sub">Source : Demandes de Valeurs Foncières · DGFiP · Open Data</p>
          </div>
        </div>
        <p class="dvf-hero-desc">
          Transactions immobilières <strong>réellement enregistrées</strong> chez le notaire à Brest :
          appartements, maisons et dépendances (garages). Données officielles de la DGFiP, millésimes 2021–2024.
        </p>
      </div>
    </div>

    <!-- No data -->
    <div v-if="!metadata" class="dvf-loading">Chargement des données DVF...</div>

    <template v-else>

      <!-- Year selector -->
      <div class="dvf-year-bar">
        <span class="dvf-year-label">Année :</span>
        <button
          v-for="y in availableYears"
          :key="y"
          @click="selectedYear = y"
          :class="['dvf-year-btn', { active: selectedYear === y }]"
        >{{ y }}</button>
        <span class="dvf-update">Données récupérées le {{ formatDate(metadata.last_fetch) }}</span>
      </div>

      <!-- KPI cards -->
      <div class="dvf-kpis" v-if="yearStats">
        <div class="dvf-kpi">
          <div class="dvf-kpi-icon">🏘️</div>
          <div class="dvf-kpi-val">{{ yearStats.total.toLocaleString('fr-FR') }}</div>
          <div class="dvf-kpi-label">Ventes totales</div>
          <div class="dvf-kpi-sub">{{ yearStats.appartements }} apparts · {{ yearStats.maisons }} maisons · {{ yearStats.garages }} garages</div>
        </div>
        <div class="dvf-kpi">
          <div class="dvf-kpi-icon">💰</div>
          <div class="dvf-kpi-val">{{ formatEuro(yearStats.prixMedianAppart) }}</div>
          <div class="dvf-kpi-label">Prix médian appart.</div>
          <div class="dvf-kpi-sub">{{ formatEuro(yearStats.prixMedianMaison) }} pour les maisons</div>
        </div>
        <div class="dvf-kpi">
          <div class="dvf-kpi-icon">📐</div>
          <div class="dvf-kpi-val">{{ formatEuro(yearStats.prixM2MedianAppart) }}/m²</div>
          <div class="dvf-kpi-label">Prix médian/m² appart.</div>
          <div class="dvf-kpi-sub">{{ formatEuro(yearStats.prixM2MedianMaison) }}/m² pour les maisons</div>
        </div>
        <div class="dvf-kpi">
          <div class="dvf-kpi-icon">📏</div>
          <div class="dvf-kpi-val">{{ yearStats.surfaceMedianeAppart }} m²</div>
          <div class="dvf-kpi-label">Surface médiane appart.</div>
          <div class="dvf-kpi-sub">Appartements uniquement</div>
        </div>
      </div>


      <!-- Filters for table + map -->
      <div class="dvf-section">
        <h2 class="dvf-section-title">Explorer les {{ selectedYear }} ventes</h2>

        <div class="dvf-filters">
          <div class="dvf-filter-group">
            <label>Type</label>
            <select v-model="filterType" class="dvf-select">
              <option value="all">Tous</option>
              <option value="Appartement">Appartement</option>
              <option value="Maison">Maison</option>
              <option value="Dépendance">Garage / Dépendance</option>
            </select>
          </div>
          <div class="dvf-filter-group">
            <label>Prix max : <strong>{{ formatEuro(filterPrixMax) }}</strong></label>
            <input type="range" v-model.number="filterPrixMax" :min="prixLimits.min" :max="prixLimits.max" :step="10000" class="dvf-range" />
          </div>
          <div class="dvf-filter-group">
            <label>Surface min : <strong>{{ filterSurfMin }} m²</strong></label>
            <input type="range" v-model.number="filterSurfMin" :min="0" :max="200" :step="5" class="dvf-range" />
          </div>
          <div class="dvf-filter-group dvf-filter-search">
            <label>Adresse</label>
            <input type="text" v-model="filterAdresse" placeholder="Rue, quartier..." class="dvf-input" />
          </div>
        </div>

        <div class="dvf-results-count">
          {{ filteredVentes.length.toLocaleString('fr-FR') }} vente(s) affichée(s)
          <span v-if="filteredVentes.length !== currentYearData.length"> sur {{ currentYearData.length.toLocaleString('fr-FR') }} cette année</span>
        </div>
      </div>


      <!-- TABLE -->
      <div class="dvf-section">
        <h2 class="dvf-section-title">Tableau des ventes</h2>
        <div class="dvf-sort-bar">
          <span class="dvf-sort-label">Trier par :</span>
          <button v-for="f in sortFields" :key="f.key" @click="toggleSort(f.key)" :class="['dvf-sort-btn', { active: sortField === f.key }]">
            {{ f.label }}
            <span v-if="sortField === f.key">{{ sortAsc ? '▲' : '▼' }}</span>
          </button>
        </div>
        <div class="dvf-table-wrap">
          <table class="dvf-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Adresse</th>
                <th>Surface</th>
                <th>Pièces</th>
                <th>Prix</th>
                <th>Prix/m²</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in pagedVentes" :key="v.id">
                <td class="td-date">{{ formatDateShort(v.date) }}</td>
                <td><span :class="['type-badge', typeClass(v.type)]">{{ v.type }}</span></td>
                <td class="td-addr">{{ v.adresse || '—' }}</td>
                <td>{{ v.surfaceAffichee ? v.surfaceAffichee + ' m²' : '—' }}</td>
                <td>{{ v.pieces || '—' }}</td>
                <td class="td-prix">{{ formatEuro(v.prix) }}</td>
                <td>{{ v.prixM2 ? formatEuro(v.prixM2) + '/m²' : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="dvf-pagination">
          <button @click="page = Math.max(1, page - 1)" :disabled="page === 1" class="pg-btn">← Préc.</button>
          <span class="pg-info">Page {{ page }} / {{ totalPages }}</span>
          <button @click="page = Math.min(totalPages, page + 1)" :disabled="page === totalPages" class="pg-btn">Suiv. →</button>
        </div>
      </div>

    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'

const metadata = ref(null)
const dataByYear = ref({})

const selectedYear = ref(2024)
const filterType = ref('all')
const filterPrixMax = ref(600000)
const filterSurfMin = ref(0)
const filterAdresse = ref('')
const sortField = ref('date')
const sortAsc = ref(false)
const page = ref(1)
const PAGE_SIZE = 50

const sortFields = [
  { key: 'date', label: 'Date' },
  { key: 'prix', label: 'Prix' },
  { key: 'surfaceAffichee', label: 'Surface' },
  { key: 'prixM2', label: 'Prix/m²' }
]

onMounted(async () => {
  try {
    const meta = await fetch(`${import.meta.env.BASE_URL}dvf/metadata.json`).then(r => r.json())
    metadata.value = meta
    selectedYear.value = meta.years[meta.years.length - 1]

    // Load all years
    for (const y of meta.years) {
      const data = await fetch(`${import.meta.env.BASE_URL}dvf/brest_${y}.json`).then(r => r.json())
      dataByYear.value[y] = data
    }
    // Set price slider max
    const maxP = Math.max(...currentYearData.value.map(v => v.prix))
    filterPrixMax.value = Math.min(600000, maxP)
  } catch (e) {
    console.error('DVF data load failed', e)
  }
})

watch(selectedYear, () => {
  page.value = 1
  const maxP = Math.max(...(currentYearData.value.map(v => v.prix)), 600000)
  filterPrixMax.value = Math.min(600000, maxP)
})

watch([filterType, filterPrixMax, filterSurfMin, filterAdresse, sortField, sortAsc], () => {
  page.value = 1
})

const availableYears = computed(() => metadata.value?.years || [])
const yearStats = computed(() => metadata.value?.stats_by_year?.[selectedYear.value] || null)
const currentYearData = computed(() => dataByYear.value[selectedYear.value] || [])

const prixLimits = computed(() => {
  const prices = currentYearData.value.map(v => v.prix)
  return { min: 0, max: Math.max(...prices, 600000) }
})

const filteredVentes = computed(() => {
  let list = currentYearData.value
  if (filterType.value !== 'all') list = list.filter(v => v.type === filterType.value)
  list = list.filter(v => v.prix <= filterPrixMax.value)
  if (filterSurfMin.value > 0) list = list.filter(v => v.surfaceAffichee && v.surfaceAffichee >= filterSurfMin.value)
  if (filterAdresse.value.trim()) {
    const q = filterAdresse.value.trim().toLowerCase()
    list = list.filter(v => (v.adresse || '').toLowerCase().includes(q))
  }
  // Sort
  list = [...list].sort((a, b) => {
    const va = a[sortField.value] ?? 0
    const vb = b[sortField.value] ?? 0
    if (typeof va === 'string') return sortAsc.value ? va.localeCompare(vb) : vb.localeCompare(va)
    return sortAsc.value ? va - vb : vb - va
  })
  return list
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredVentes.value.length / PAGE_SIZE)))
const pagedVentes = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return filteredVentes.value.slice(start, start + PAGE_SIZE)
})

function typeClass(type) {
  if (type === 'Appartement') return 'badge-appart'
  if (type === 'Maison') return 'badge-maison'
  return 'badge-garage'
}

// Helpers
function formatEuro(v) {
  if (!v) return '—'
  return v.toLocaleString('fr-FR') + ' €'
}
function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}
function formatDateShort(str) {
  if (!str) return '—'
  const [y, m, d] = str.split('-')
  return `${d}/${m}/${y}`
}
function toggleSort(field) {
  if (sortField.value === field) sortAsc.value = !sortAsc.value
  else { sortField.value = field; sortAsc.value = false }
}
</script>

<style scoped>
/* ── Hero ─────────────────────────────────────────────── */
.dvf-dashboard { max-width: 1100px; margin: 0 auto; padding: 0 16px 48px; }

.dvf-hero {
  background: linear-gradient(135deg, #0a1628 0%, #1a2744 55%, #0d3050 100%);
  border-radius: 16px;
  padding: 32px 36px;
  margin-bottom: 24px;
  border: 1px solid rgba(96,165,250,0.15);
}
.dvf-hero-inner { max-width: 820px; }
.dvf-hero-left { display: flex; align-items: center; gap: 16px; margin-bottom: 14px; }
.dvf-hero-icon { font-size: 2.8rem; }
.dvf-hero-title { margin: 0 0 4px; font-size: 1.7rem; font-weight: 800; color: #f0f6ff; }
.dvf-hero-sub { margin: 0; font-size: 0.85rem; color: #94a3b8; }
.dvf-hero-desc { margin: 0; font-size: 0.95rem; color: #cbd5e1; line-height: 1.7; }
.dvf-hero-desc strong { color: #e2e8f0; }

/* ── Year bar ─────────────────────────────────────────── */
.dvf-year-bar {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  margin-bottom: 20px; padding: 14px 18px;
  background: var(--vp-c-bg-soft); border-radius: 10px; border: 1px solid var(--vp-c-gutter);
}
.dvf-year-label { font-weight: 600; color: var(--vp-c-text-2); font-size: 0.9rem; margin-right: 4px; }
.dvf-year-btn {
  padding: 6px 16px; border-radius: 20px; border: 1px solid var(--vp-c-gutter);
  background: transparent; color: var(--vp-c-text-1); cursor: pointer; font-size: 0.9rem;
  transition: all 0.2s;
}
.dvf-year-btn.active { background: #3b82f6; color: white; border-color: #3b82f6; }
.dvf-update { margin-left: auto; font-size: 0.78rem; color: var(--vp-c-text-3); }

/* ── KPI cards ─────────────────────────────────────────── */
.dvf-kpis {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px; margin-bottom: 28px;
}
.dvf-kpi {
  background: var(--vp-c-bg-soft); border: 1px solid var(--vp-c-gutter);
  border-radius: 12px; padding: 18px 20px; text-align: center;
}
.dvf-kpi-icon { font-size: 1.8rem; margin-bottom: 8px; }
.dvf-kpi-val { font-size: 1.5rem; font-weight: 800; color: var(--vp-c-text-1); }
.dvf-kpi-label { font-size: 0.8rem; color: var(--vp-c-text-2); text-transform: uppercase; letter-spacing: 0.5px; margin: 4px 0; }
.dvf-kpi-sub { font-size: 0.78rem; color: var(--vp-c-text-3); }

/* ── Section ─────────────────────────────────────────── */
.dvf-section { margin-bottom: 36px; }
.dvf-section-title {
  font-size: 1.15rem; font-weight: 700; margin: 0 0 16px;
  color: var(--vp-c-text-1); border-bottom: 1px solid var(--vp-c-gutter); padding-bottom: 10px;
}
.dvf-year-badge {
  background: #3b82f6; color: white; font-size: 0.75rem;
  padding: 2px 8px; border-radius: 10px; margin-left: 8px; vertical-align: middle;
}


/* ── Filters ─────────────────────────────────────────── */
.dvf-filters {
  display: flex; flex-wrap: wrap; gap: 16px;
  background: var(--vp-c-bg-soft); border: 1px solid var(--vp-c-gutter);
  border-radius: 10px; padding: 16px; margin-bottom: 12px;
}
.dvf-filter-group { display: flex; flex-direction: column; gap: 6px; min-width: 160px; }
.dvf-filter-group label { font-size: 0.82rem; color: var(--vp-c-text-2); font-weight: 600; }
.dvf-select, .dvf-input {
  background: var(--vp-c-bg); border: 1px solid var(--vp-c-gutter);
  border-radius: 6px; padding: 6px 10px; color: var(--vp-c-text-1); font-size: 0.88rem;
}
.dvf-filter-search { flex: 1; min-width: 200px; }
.dvf-filter-search .dvf-input { width: 100%; }
.dvf-range { width: 100%; accent-color: #3b82f6; }
.dvf-results-count { font-size: 0.88rem; color: var(--vp-c-text-2); margin-bottom: 8px; }


/* ── Sort bar ─────────────────────────────────────────── */
.dvf-sort-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.dvf-sort-label { font-size: 0.85rem; color: var(--vp-c-text-2); }
.dvf-sort-btn {
  padding: 4px 12px; border-radius: 14px; border: 1px solid var(--vp-c-gutter);
  background: transparent; color: var(--vp-c-text-2); cursor: pointer; font-size: 0.83rem;
  transition: all 0.15s;
}
.dvf-sort-btn.active { background: #3b82f6; color: white; border-color: #3b82f6; }

/* ── Table ─────────────────────────────────────────── */
.dvf-table-wrap { overflow-x: auto; border-radius: 10px; border: 1px solid var(--vp-c-gutter); }
.dvf-table { width: 100%; border-collapse: collapse; font-size: 0.87rem; }
.dvf-table th {
  text-align: left; padding: 10px 12px;
  background: var(--vp-c-bg-soft); border-bottom: 2px solid var(--vp-c-gutter);
  font-weight: 700; color: var(--vp-c-text-2); text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.5px;
}
.dvf-table td { padding: 9px 12px; border-bottom: 1px solid var(--vp-c-gutter); }
.dvf-table tr:last-child td { border-bottom: none; }
.dvf-table tr:hover td { background: var(--vp-c-bg-soft); }
.td-date { white-space: nowrap; color: var(--vp-c-text-3); }
.td-addr { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-prix { font-weight: 700; color: var(--vp-c-text-1); }

.type-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; font-weight: 600; white-space: nowrap; }
.badge-appart { background: rgba(96,165,250,0.15); color: #60a5fa; }
.badge-maison { background: rgba(52,211,153,0.15); color: #34d399; }
.badge-garage { background: rgba(245,158,11,0.15); color: #f59e0b; }

/* ── Pagination ─────────────────────────────────────────── */
.dvf-pagination { display: flex; align-items: center; gap: 12px; justify-content: center; margin-top: 16px; }
.pg-btn {
  padding: 6px 16px; border-radius: 8px; border: 1px solid var(--vp-c-gutter);
  background: var(--vp-c-bg-soft); color: var(--vp-c-text-1); cursor: pointer; font-size: 0.88rem;
}
.pg-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pg-info { font-size: 0.88rem; color: var(--vp-c-text-2); }

/* ── Loading ─────────────────────────────────────────── */
.dvf-loading { text-align: center; padding: 60px 0; color: var(--vp-c-text-3); font-size: 1rem; }

@media (max-width: 640px) {
  .dvf-hero { padding: 20px 18px; }
  .dvf-hero-title { font-size: 1.25rem; }
  .dvf-kpis { grid-template-columns: 1fr 1fr; }
}
</style>
