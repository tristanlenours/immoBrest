<template>
  <div class="dashboard-container">

    <!-- Hero Banner -->
    <div class="hub-hero">
      <div class="hub-hero-content">
        <div class="hub-hero-left">
          <div class="hub-logo">🏙️</div>
          <div>
            <h1 class="hub-title">Hub Immo Brest</h1>
            <p class="hub-tagline">Observatoire personnel du marché immobilier brestois</p>
          </div>
        </div>
        <p class="hub-desc">
          Cet outil agrège et suit en temps réel les annonces immobilières publiées sur
          <strong>Leboncoin</strong>, <strong>Agence Henry</strong>, <strong>Luxior</strong>,
          <strong>Barraine</strong> et <strong>Human Immobilier</strong> — de leur apparition
          jusqu'à leur retrait du marché. Chaque bien est enrichi d'un
          <strong>scoring personnalisé</strong> basé sur la localisation, l'étage, la terrasse,
          l'ascenseur et d'autres critères qualitatifs, et son
          <strong>historique de prix</strong> est tracé automatiquement pour révéler les baisses
          et le temps de mise en marché réel.
        </p>
        <div class="hub-features">
          <span class="hub-chip">📡 Suivi multi-sources</span>
          <span class="hub-chip">📈 Historique des prix</span>
          <span class="hub-chip">⏱️ Temps de mise en marché</span>
          <span class="hub-chip">⭐ Scoring personnalisé</span>
          <span class="hub-chip">🔔 Détection des baisses</span>
        </div>
      </div>
    </div>

    <!-- Header Summary Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">🏠</div>
        <div class="stat-content">
          <span class="stat-label">Offres Actives</span>
          <span class="stat-value">{{ stats.activeCount }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">💰</div>
        <div class="stat-content">
          <span class="stat-label">Prix Moyen</span>
          <span class="stat-value">{{ formatPrice(stats.avgPrice) }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">📐</div>
        <div class="stat-content">
          <span class="stat-label">Prix Moyen / m²</span>
          <span class="stat-value">{{ formatPrice(stats.avgPricePerM2) }}/m²</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">⭐</div>
        <div class="stat-content">
          <span class="stat-label">Meilleur Score</span>
          <span class="stat-value">{{ stats.maxScore }}/10</span>
        </div>
      </div>
    </div>

    <!-- Filters and Controls Panel -->
    <div class="controls-panel">
      <div class="search-box">
        <input 
          type="text" 
          v-model="filters.query" 
          placeholder="Rechercher par mot-clé (Siam, terrasse, calme...)" 
          class="search-input"
        />
      </div>
      
      <div class="filters-row">
        <div class="filter-group">
          <label>Type de bien</label>
          <select v-model="filters.type" class="filter-select">
            <option value="all">Tous les types</option>
            <option value="maison">Maison</option>
            <option value="appartement">Appartement</option>
          </select>
        </div>

        <div class="filter-group">
          <label>Prix Max: <span class="filter-val">{{ formatPrice(filters.maxPrice) }}</span></label>
          <input 
            type="range" 
            v-model.number="filters.maxPrice" 
            :min="limits.minPrice" 
            :max="limits.maxPrice" 
            step="10000"
            class="filter-range"
          />
        </div>

        <div class="filter-group">
          <label>Surface Min: <span class="filter-val">{{ filters.minSurface }} m²</span></label>
          <input 
            type="range" 
            v-model.number="filters.minSurface" 
            :min="limits.minSurface" 
            :max="limits.maxSurface" 
            step="5"
            class="filter-range"
          />
        </div>

        <div class="filter-group">
          <label>Score Min: <span class="filter-val">{{ filters.minScore }}/10</span></label>
          <input 
            type="range" 
            v-model.number="filters.minScore" 
            min="0" 
            max="10" 
            step="0.5"
            class="filter-range"
          />
        </div>
      </div>

      <div class="sorting-row">
        <span class="sort-label">Trier par :</span>
        <div class="sort-buttons">
          <button 
            v-for="field in ['score', 'price', 'surface', 'date']" 
            :key="field"
            @click="setSort(field)"
            :class="['sort-btn', { active: sort.field === field }]"
          >
            {{ translateField(field) }}
            <span v-if="sort.field === field" class="sort-direction">
              {{ sort.order === 'asc' ? '▲' : '▼' }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- Active Offers Listing -->
    <div class="listings-section">
      <!-- Tabs Segment Control -->
      <div class="tabs-control">
        <button 
          @click="currentTab = 'active'" 
          :class="['tab-btn', { active: currentTab === 'active' }]"
        >
          Offres Actives <span class="tab-count">{{ countStatus('active') }}</span>
        </button>
        <button 
          @click="currentTab = 'archived'" 
          :class="['tab-btn', { active: currentTab === 'archived' }]"
        >
          Archives & Vendus <span class="tab-count">{{ countStatus('archived') }}</span>
        </button>
        <button 
          @click="currentTab = 'all'" 
          :class="['tab-btn', { active: currentTab === 'all' }]"
        >
          Toutes les Offres <span class="tab-count">{{ listings.length }}</span>
        </button>
      </div>

      <div class="section-header">
        <h2>{{ currentTab === 'active' ? 'Offres Actives' : currentTab === 'archived' ? 'Offres Archivées' : 'Toutes les Offres' }} ({{ filteredListings.length }})</h2>
        <span class="subtitle">Mise à jour le {{ updateDate }}</span>
      </div>

      <div v-if="filteredListings.length === 0" class="no-results">
        Aucun bien ne correspond à vos critères de recherche.
      </div>

      <div v-else class="listings-grid">
        <div 
          v-for="item in filteredListings" 
          :key="item.folder" 
          :class="['listing-card', { 'is-archived': isArchived(item.status) }]"
        >
          <!-- Thumbnail -->
          <div class="card-image-container">
            <img 
              v-if="item.hasScreenshot" 
              :src="`/screenshots/${item.folder}.png`" 
              alt="Aperçu"
              class="card-image"
              loading="lazy"
            />
            <div v-else class="card-image-placeholder">
              <span class="placeholder-icon">{{ item.type.toLowerCase().includes('maison') ? '🏠' : '🏢' }}</span>
              <span class="placeholder-text">{{ item.source }}</span>
            </div>
            
            <div :class="['score-badge', getScoreClass(item.score)]">
              {{ item.score }}/10
            </div>

            <div class="card-tags">
              <span class="source-tag">{{ item.source }}</span>
              <span v-if="isArchived(item.status)" class="archive-tag">{{ item.status }}</span>
            </div>
          </div>

          <!-- Card Content -->
          <div class="card-body">
            <h3 class="card-title">{{ item.title }}</h3>
            
            <div class="card-meta">
              <span class="meta-price">{{ formatPrice(item.priceVal) }}</span>
              <span class="meta-separator">•</span>
              <span class="meta-surface">{{ item.surface }}</span>
              <span class="meta-separator">•</span>
              <span class="meta-pieces">{{ item.pieces }}</span>
            </div>

            <div class="card-location">
              <span class="loc-icon">📍</span> {{ item.location }}
            </div>

            <!-- Maluses / Criteria -->
            <div class="card-maluses" v-if="item.maluses && item.maluses.length > 0">
              <span 
                v-for="(malus, idx) in item.maluses" 
                :key="idx" 
                :class="['malus-tag', { 'bonus-tag-item': isBonus(malus) }]"
              >
                {{ cleanMalusText(malus) }}
              </span>
            </div>
            <div class="card-maluses-clean" v-else>
              <span class="bonus-tag">✓ Critères parfaits !</span>
            </div>

            <p class="card-desc">{{ truncateText(item.description, 120) }}</p>
          </div>

          <!-- Card Footer Buttons -->
          <div class="card-footer">
            <a :href="`/biens/${item.folder}.html`" class="btn-local">Fiche locale</a>
            <a :href="item.url" target="_blank" rel="noopener" class="btn-external">Annonce originale ↗</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'

export default {
  name: 'Dashboard',
  setup() {
    const listings = ref([])
    const updateDate = ref('')
    const loading = ref(true)

    // Limits for ranges
    const limits = ref({
      minPrice: 300000,
      maxPrice: 600000,
      minSurface: 80,
      maxSurface: 150
    })

    // Filter state
    const filters = ref({
      query: '',
      type: 'all',
      maxPrice: 600000,
      minSurface: 80,
      minScore: 0
    })

    // Sorting state
    const sort = ref({
      field: 'score',
      order: 'desc'
    })

    const currentTab = ref('active') // 'active', 'archived', 'all'

    // Fetch data
    onMounted(async () => {
      try {
        const response = await fetch('/listings_data.json')
        if (response.ok) {
          const data = await response.json()
          listings.value = data.listings || []
          updateDate.value = data.last_update || ''
          
          // Dynamically compute limits based on data
          if (listings.value.length > 0) {
            const prices = listings.value.map(l => l.priceVal).filter(p => p > 0)
            const surfaces = listings.value.map(l => l.surfaceVal).filter(s => s > 0)
            
            if (prices.length > 0) {
              limits.value.minPrice = Math.min(...prices)
              limits.value.maxPrice = Math.max(...prices)
              filters.value.maxPrice = limits.value.maxPrice
            }
            if (surfaces.length > 0) {
              limits.value.minSurface = Math.floor(Math.min(...surfaces))
              limits.value.maxSurface = Math.ceil(Math.max(...surfaces))
              filters.value.minSurface = limits.value.minSurface
            }
          }
        }
      } catch (err) {
        console.error('Failed to load listings data:', err)
      } finally {
        loading.value = false
      }
    })

    // Stats calculations (always computed on all ACTIVE offers in data)
    const stats = computed(() => {
      const activeOffers = listings.value.filter(item => {
        const status = (item.status || '').toLowerCase()
        return (status.includes('actif') && !status.includes('inactif')) || status === 'nouveau'
      })

      if (activeOffers.length === 0) {
        return { activeCount: 0, avgPrice: 0, avgPricePerM2: 0, maxScore: 0 }
      }

      const activeWithPrice = activeOffers.filter(l => l.priceVal > 0)
      const totalPrice = activeWithPrice.reduce((sum, l) => sum + l.priceVal, 0)
      const avgPrice = activeWithPrice.length > 0 ? totalPrice / activeWithPrice.length : 0

      const activeWithM2 = activeOffers.filter(l => l.priceVal > 0 && l.surfaceVal > 0)
      const totalM2 = activeWithM2.reduce((sum, l) => sum + (l.priceVal / l.surfaceVal), 0)
      const avgPricePerM2 = activeWithM2.length > 0 ? totalM2 / activeWithM2.length : 0

      const maxScore = Math.max(...activeOffers.map(l => l.score || 0))

      return {
        activeCount: activeOffers.length,
        avgPrice: Math.round(avgPrice),
        avgPricePerM2: Math.round(avgPricePerM2),
        maxScore: maxScore
      }
    })

    // Filter and Sort implementation
    const filteredListings = computed(() => {
      // 1. Filter by active / archived tabs
      let result = listings.value
      if (currentTab.value === 'active') {
        result = result.filter(item => {
          const status = (item.status || '').toLowerCase()
          return (status.includes('actif') && !status.includes('inactif')) || status === 'nouveau'
        })
      } else if (currentTab.value === 'archived') {
        result = result.filter(item => {
          const status = (item.status || '').toLowerCase()
          const isActive = (status.includes('actif') && !status.includes('inactif')) || status === 'nouveau'
          return !isActive
        })
      }

      // 2. Apply text search
      if (filters.value.query.trim()) {
        const q = filters.value.query.toLowerCase()
        result = result.filter(item => {
          return (item.title || '').toLowerCase().includes(q) ||
                 (item.description || '').toLowerCase().includes(q) ||
                 (item.location || '').toLowerCase().includes(q) ||
                 (item.prestations || '').toLowerCase().includes(q) ||
                 (item.source || '').toLowerCase().includes(q)
        })
      }

      // 3. Apply type filter
      if (filters.value.type !== 'all') {
        const t = filters.value.type
        result = result.filter(item => {
          const typeStr = (item.type || '').toLowerCase()
          if (t === 'maison') return typeStr.includes('maison')
          if (t === 'appartement') return typeStr.includes('appartement')
          return true
        })
      }

      // 4. Apply max price
      if (filters.value.maxPrice) {
        result = result.filter(item => {
          return item.priceVal === 0 || item.priceVal <= filters.value.maxPrice
        })
      }

      // 5. Apply min surface
      if (filters.value.minSurface) {
        result = result.filter(item => {
          return item.surfaceVal === 0 || item.surfaceVal >= filters.value.minSurface
        })
      }

      // 6. Apply min score
      if (filters.value.minScore !== undefined) {
        result = result.filter(item => item.score >= filters.value.minScore)
      }

      // 7. Sort
      result.sort((a, b) => {
        let diff = 0
        if (sort.value.field === 'price') {
          diff = a.priceVal - b.priceVal
        } else if (sort.value.field === 'surface') {
          diff = a.surfaceVal - b.surfaceVal
        } else if (sort.value.field === 'date') {
          diff = (a.dateVal || 0) - (b.dateVal || 0)
        } else {
          diff = a.score - b.score
        }
        return sort.value.order === 'asc' ? diff : -diff
      })

      return result
    })

    // Sort handlers
    const setSort = (field) => {
      if (sort.value.field === field) {
        // Toggle direction
        sort.value.order = sort.value.order === 'asc' ? 'desc' : 'asc'
      } else {
        sort.value.field = field
        // Defaults
        sort.value.order = field === 'price' ? 'asc' : 'desc'
      }
    }

    const translateField = (field) => {
      switch (field) {
        case 'score': return 'Score'
        case 'price': return 'Prix'
        case 'surface': return 'Surface'
        case 'date': return 'Date d\'ajout'
        default: return field
      }
    }

    // Formatting helpers
    const formatPrice = (val) => {
      if (!val) return 'Non spécifié'
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val)
    }

    const getScoreClass = (score) => {
      if (score >= 7) return 'score-high'
      if (score >= 5) return 'score-medium'
      return 'score-low'
    }

    const cleanMalusText = (text) => {
      // Remove starting check box markers or points text if any, keeping it compact
      return text.replace(/^-\s*/, '').replace(/\[\s*\]\s*/, '')
    }

    const truncateText = (text, len) => {
      if (!text) return ''
      if (text.length <= len) return text
      return text.substring(0, len) + '...'
    }

    const isBonus = (text) => {
      const lower = text.toLowerCase()
      return lower.includes('bonus') || lower.includes('+')
    }

    const isArchived = (status) => {
      const lower = (status || '').toLowerCase()
      const isActive = (lower.includes('actif') && !lower.includes('inactif')) || lower === 'nouveau'
      return !isActive
    }

    const countStatus = (type) => {
      return listings.value.filter(item => {
        const status = (item.status || '').toLowerCase()
        const isActive = (status.includes('actif') && !status.includes('inactif')) || status === 'nouveau'
        return type === 'active' ? isActive : !isActive
      }).length
    }

    return {
      listings,
      updateDate,
      loading,
      limits,
      filters,
      sort,
      stats,
      filteredListings,
      setSort,
      translateField,
      formatPrice,
      getScoreClass,
      cleanMalusText,
      truncateText,
      isBonus,
      currentTab,
      isArchived,
      countStatus
    }
  }
}
</script>

<style scoped>
.dashboard-container {
  font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--vp-c-text-1);
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 0;
}

/* Stats grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 20px;
  margin-bottom: 30px;
}

.stat-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-gutter);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 15px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.02);
  transition: transform 0.2s, box-shadow 0.2s;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 15px rgba(0, 0, 0, 0.05);
}

.stat-icon {
  font-size: 2.2rem;
  background: var(--vp-c-default-soft);
  width: 55px;
  height: 55px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.stat-content {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--vp-c-brand);
}

/* Controls Panel */
.controls-panel {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-gutter);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 40px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.04);
}

.search-box {
  margin-bottom: 20px;
}

.search-input {
  width: 100%;
  padding: 14px 20px;
  font-size: 1rem;
  border-radius: 10px;
  border: 1px solid var(--vp-c-gutter);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  outline: none;
  transition: border-color 0.25s, box-shadow 0.25s;
}

.search-input:focus {
  border-color: var(--vp-c-brand);
  box-shadow: 0 0 0 3px rgba(100, 108, 255, 0.15);
}

.filters-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-group label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
  display: flex;
  justify-content: space-between;
}

.filter-val {
  color: var(--vp-c-brand);
  font-weight: 700;
}

.filter-select {
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-gutter);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 0.95rem;
}

.filter-range {
  -webkit-appearance: none;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: var(--vp-c-gutter);
  outline: none;
  margin: 12px 0;
}

.filter-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--vp-c-brand);
  cursor: pointer;
  transition: transform 0.1s;
}

.filter-range::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.sorting-row {
  display: flex;
  align-items: center;
  gap: 15px;
  border-top: 1px solid var(--vp-c-gutter);
  padding-top: 20px;
  flex-wrap: wrap;
}

.sort-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.sort-buttons {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.sort-btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 500;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-gutter);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.sort-btn:hover {
  border-color: var(--vp-c-brand);
  color: var(--vp-c-brand);
}

.sort-btn.active {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand);
  color: var(--vp-c-brand);
  font-weight: 600;
}

/* Listings grid */
.listings-section {
  margin-top: 20px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 25px;
  border-bottom: 2px solid var(--vp-c-gutter);
  padding-bottom: 10px;
}

.section-header h2 {
  font-size: 1.8rem;
  font-weight: 800;
  margin: 0;
  background: linear-gradient(135deg, var(--vp-c-brand), #c084fc);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.subtitle {
  font-size: 0.9rem;
  color: var(--vp-c-text-3);
}

.no-results {
  text-align: center;
  padding: 50px 20px;
  background: var(--vp-c-bg-soft);
  border-radius: 12px;
  border: 1px dashed var(--vp-c-gutter);
  color: var(--vp-c-text-2);
  font-size: 1.1rem;
}

.listings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 25px;
}

.listing-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-gutter);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 100%;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
  transition: transform 0.25s, box-shadow 0.25s, border-color 0.25s;
}

.listing-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.08);
  border-color: var(--vp-c-brand-soft);
}

.card-image-container {
  height: 200px;
  position: relative;
  background: linear-gradient(135deg, var(--vp-c-gutter), var(--vp-c-bg-soft));
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.card-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s;
}

.listing-card:hover .card-image {
  transform: scale(1.05);
}

.card-image-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.placeholder-icon {
  font-size: 3rem;
}

.placeholder-text {
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  letter-spacing: 1px;
}

.score-badge {
  position: absolute;
  top: 15px;
  right: 15px;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 0.95rem;
  color: white;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
}

.score-high {
  background: linear-gradient(135deg, #10b981, #059669);
}

.score-medium {
  background: linear-gradient(135deg, #f59e0b, #d97706);
}

.score-low {
  background: linear-gradient(135deg, #ef4444, #dc2626);
}

.source-tag {
  position: absolute;
  top: 15px;
  left: 15px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  color: white;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.card-body {
  padding: 20px;
  flex-grow: 1;
  display: flex;
  flex-direction: column;
}

.card-title {
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 1.4;
  margin: 0 0 10px 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 3.3rem;
  height: auto;
  color: var(--vp-c-text-1);
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.meta-price {
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--vp-c-brand);
}

.meta-separator {
  color: var(--vp-c-text-3);
}

.meta-surface, .meta-pieces {
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
}

.card-location {
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  margin-bottom: 15px;
}

.card-maluses {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 15px;
}

.malus-tag {
  font-size: 0.75rem;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #ef4444;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

.bonus-tag-item {
  background: rgba(16, 185, 129, 0.08) !important;
  border: 1px solid rgba(16, 185, 129, 0.2) !important;
  color: #10b981 !important;
}

.bonus-tag {
  font-size: 0.75rem;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.2);
  color: #10b981;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
  display: inline-block;
  margin-bottom: 15px;
}

.card-desc {
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Card footer buttons */
.card-footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-top: 1px solid var(--vp-c-gutter);
  background: var(--vp-c-bg-soft);
}

.btn-local, .btn-external {
  padding: 12px;
  font-size: 0.85rem;
  font-weight: 600;
  text-align: center;
  text-decoration: none;
  transition: background-color 0.2s, color 0.2s;
}

.btn-local {
  border-right: 1px solid var(--vp-c-gutter);
  color: var(--vp-c-brand);
}

.btn-local:hover {
  background: var(--vp-c-brand-soft);
}

.btn-external {
  color: var(--vp-c-text-2);
}

.btn-external:hover {
  background: var(--vp-c-gutter);
  color: var(--vp-c-text-1);
}

/* Tabs styling */
.tabs-control {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  background: var(--vp-c-bg-soft);
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--vp-c-gutter);
  width: fit-content;
}

.tab-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.tab-btn:hover {
  color: var(--vp-c-text-1);
}

.tab-btn.active {
  background: var(--vp-c-bg);
  color: var(--vp-c-brand);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.tab-count {
  font-size: 0.75rem;
  background: var(--vp-c-gutter);
  color: var(--vp-c-text-2);
  padding: 2px 6px;
  border-radius: 10px;
  font-weight: 700;
}

.tab-btn.active .tab-count {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand);
}

/* Card tags layout */
.card-tags {
  position: absolute;
  top: 15px;
  left: 15px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.source-tag {
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  color: white;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.archive-tag {
  background: rgba(239, 68, 68, 0.85);
  backdrop-filter: blur(4px);
  color: white;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* Archived cards */
.listing-card.is-archived {
  opacity: 0.75;
  border-color: var(--vp-c-gutter);
  filter: saturate(0.85);
}

.listing-card.is-archived:hover {
  opacity: 1;
  filter: none;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.05);
}

.detail-status-badge.status-vendu-ou-retiré-de-la-vente,
.detail-status-badge.status-hors-zone-surface-exclue {
  background: rgba(239, 68, 68, 0.1) !important;
  color: #ef4444 !important;
}

/* ── Hub Hero Banner ─────────────────────────────────────────── */
.hub-hero {
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #1e3a5f 100%);
  border-radius: 16px;
  padding: 36px 40px;
  margin-bottom: 28px;
  border: 1px solid rgba(99, 149, 255, 0.15);
  position: relative;
  overflow: hidden;
}

.hub-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 80% 0%, rgba(99, 149, 255, 0.08) 0%, transparent 60%);
  pointer-events: none;
}

.hub-hero-content {
  position: relative;
  z-index: 1;
}

.hub-hero-left {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 20px;
}

.hub-logo {
  font-size: 3rem;
  line-height: 1;
  filter: drop-shadow(0 4px 12px rgba(99, 149, 255, 0.3));
}

.hub-title {
  margin: 0 0 4px 0;
  font-size: 1.9rem;
  font-weight: 800;
  color: #f8fafc;
  letter-spacing: -0.5px;
  line-height: 1.2;
}

.hub-tagline {
  margin: 0;
  font-size: 0.95rem;
  color: #94a3b8;
  font-weight: 400;
  letter-spacing: 0.2px;
}

.hub-desc {
  margin: 0 0 22px 0;
  font-size: 0.97rem;
  color: #cbd5e1;
  line-height: 1.75;
  max-width: 820px;
}

.hub-desc strong {
  color: #e2e8f0;
  font-weight: 600;
}

.hub-features {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.hub-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 0.82rem;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.07);
  color: #bfdbfe;
  border: 1px solid rgba(147, 197, 253, 0.2);
  letter-spacing: 0.2px;
  transition: background 0.2s;
}

.hub-chip:hover {
  background: rgba(255, 255, 255, 0.12);
}

@media (max-width: 640px) {
  .hub-hero {
    padding: 24px 20px;
  }
  .hub-title {
    font-size: 1.4rem;
  }
  .hub-logo {
    font-size: 2.2rem;
  }
}
</style>
