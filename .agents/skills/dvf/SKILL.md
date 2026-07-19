---
name: DVF Brest — Fetch ventes réelles
description: Télécharge et parse les données DVF brutes nationales de la DGFiP, filtre sur Brest (29019), géolocalise avec la BAN et sauvegarde en JSON pour le site VitePress.
---
# DVF Brest — Fetch

Ce skill télécharge les données DVF (Demandes de Valeurs Foncières) officielles nationales de la DGFiP depuis `files.data.gouv.fr/dvf/` (ou `static.data.gouv.fr`), les filtre sur Brest, les géolocalise à l'aide de l'API de la Base Adresse Nationale (BAN) et génère des fichiers JSON utilisés par le dashboard VitePress.

## Quand utiliser
- Pour mettre à jour les données de ventes immobilières réelles (1 à 2× par an)
- Après publication de nouvelles millésimes DVF (avril et octobre)

## Exécution

```bash
node .agents/skills/dvf/scripts/fetch_dvf.js
```

Puis régénérer le site :
```bash
node .agents/skills/leboncoin_generate_site/scripts/generate_site.js
```

## Données produites

- `dvf_data/brest_{annee}.json` — ventes filtrées Brest par année
- `dvf_data/metadata.json` — statistiques globales et date de dernière mise à jour
- `dvf_data/geocoding_cache.json` — cache local des adresses géolocalisées avec la BAN

## Filtres appliqués

- `Code commune = 19` et `Code departement = 29` (Brest uniquement)
- `Nature mutation = Vente` (exclut successions, échanges, VEFA)
- `Type local` : Appartement, Maison, Dépendance (garages inclus)
- `Valeur fonciere` entre 5 000 € et 3 000 000 € (exclut aberrations)
- Années couvertes : 2021 à 2025 (configurable)

