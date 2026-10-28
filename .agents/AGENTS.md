# Consignes de Naming et Règles de Localisation

Ce document regroupe les règles de formatage et de naming à appliquer sur les annonces immobilières de Brest.

## Règle de Naming (Titre Personnalisé)

> [!IMPORTANT]
> Pour chaque annonce immobilière, le titre de la fiche markdown **doit inclure la localisation précise** (le quartier ou secteur) dès qu'il est identifiable dans le titre d'origine, la description ou les métadonnées. Il ne faut pas se contenter de la mention générique "Brest".
> 
> **Exclusion stricte pour absence de quartier** : Toute annonce pour laquelle **aucun quartier reconnu ne peut être identifié** est **strictement éliminée**. Elle est ignorée au fetch (`fetch_listings.js`) et déplacée automatiquement en `corbeille/` lors du scoring (`score_listings.js`).

### Quartiers reconnus et prioritaires
Les quartiers suivants doivent être extraits et insérés au centre du titre :
- **Siam** / **Triangle d'Or** / **Saint-Louis**
- **Place Wilson** / **Gare** / **Branda**
- **Saint-Michel** / **Gambetta** / **Pasteur**
- **Capucins** / **Recouvrance** / **Kerbonne** / **La Corniche**
- **Saint-Marc** (Hors secteur) / **Guelmeur** / **Saint-Martin**
- **Kérinou** / **Lanrédec** / **Linois**
- **Harteloire** / **Bellevue** / **Pilier Rouge**
- **Port de Commerce**

### Format du Titre dans les Fiches
Le titre principal de la fiche doit respecter le format suivant :
`# [Source] - type_de_bien [caractéristiques_temporelles/architecturales] Quartier - [attributs] (Score: X/10)`

Exemples :
- `# [Agence Henry] - maison années 30 Kérinou - jardin (Score: 7/10)`
- `# [Leboncoin] - appartement - 3 pièces 100m² (La Corniche) (Score: 2.4/10)`
- `# [Agence Henry] - grand appartement Branda Gare - seul à l'étage avec ascenseur (Score: 6.7/10)`

## Restitution des Résultats du Fetch

> [!IMPORTANT]
> Après chaque exécution du script de fetch (`fetch_listings.js`), l'agent doit **systématiquement et explicitement** présenter à l'utilisateur la liste des nouvelles annonces découvertes et placées dans le sas d'attente (`review_status = 'sas'` dans Supabase).
> Pour chaque annonce découverte, il convient d'indiquer :
> - La source (Leboncoin, Agence Henry, Luxior, Barraine, Human)
> - Le type de bien, quartier, surface, prix (ou "Prix sur demande")
> - Le score calculé automatiquement
> - Le lien de l'annonce (si disponible)

---

# Architecture, Mécanismes et Skills ImmoBrest

Ce document décrit le fonctionnement global de la plateforme d'analyse et de recherche immobilière sur Brest.

## 1. Ce que propose l'application ImmoBrest

ImmoBrest est une plateforme automatisée de recherche, d'évaluation et de consultation de biens immobiliers sur Brest centre. Elle permet de :
- **Agréger les annonces** issues de plusieurs sources (Leboncoin, Agence Henry, Luxior, Barraine, Human Immobilier).
- **Filtrer strictement** selon la surface (85–150m²) et le budget (300k–600k€).
- **Dédoublonner automatiquement** les annonces publiées sur plusieurs portails.
- **Sécuriser la base active via un Sas d'attente** afin de vérifier les nouvelles annonces avant publication.
- **Évaluer et noter chaque bien sur 10 points** selon une grille multicritères (Tiers 1: Siam/Wilson/Gare..., Tiers 2: Saint-Michel/Gambetta/Fac de médecine/Facultés/Yves Collet/Capucins..., Tiers 3: Autres). Exclusions strictes: Croix-Rouge, Bellevue, Saint-Marc, Lambézellec, Bohars, Saint-Pierre, Quatre Moulins, Kerbonne, Fontaine Margot, Les Jardins de la Falaise, Rive Droite (hors Capucins/Recouvrance).
- **Croiser avec les ventes réelles DVF (DGFiP)** géolocalisées sur Brest.
- **Générer un site statique dynamique VitePress** proposant un tableau de bord interactif, des filtres et des fiches détaillées avec historique des prix.

---

## 2. Structure des Données

Les annonces vivent dans le projet **Supabase partagé** (avec DraftMaster et Quiz), tables préfixées `immo_`. Les scripts utilisent la clé `service_role` lue dans `.env` (voir `.env.example`) : lancer avec `node --env-file=.env <script>`. Le schéma est dans `supabase/migrations/`.

- `immo_listings` : une ligne par annonce. `review_status` vaut `sas` (**sas d'attente**, nouvelles annonces à valider), `approved` (**base active** publiée sur le site) ou `rejected` (**corbeille**, sert aussi d'anti-doublon pour ne jamais ré-ingérer une annonce rejetée). `market_status` porte l'état sur le marché (Actif, Vendu ou retiré de la vente...).
- `immo_price_history` : historique des prix par annonce.
- `immo_dvf_sales` : transactions réelles DGFiP sur Brest.
- `immo_run_log` : journal des exécutions du fetch (date de dernière recherche, statistiques, erreurs).
- `immo_allowed_emails` : e-mails autorisés à consulter et modérer.
- `leboncoin_searches/<id>/latest_screenshot.png` : captures d'écran des annonces à fort score (les anciens dossiers `.md` sont conservés comme archive historique, plus lus par les scripts).
- `dvf_data/` et `docs/public/dvf/` : données DVF brutes et parsées ; `docs/` : site statique VitePress (`docs/biens/`, `docs/public/listings_data.json`), généré depuis la base.

---

## 3. Principaux Mécanismes du Pipeline

```mermaid
flowchart TD
    A[Scraper / Fetch Multi-sources] --> B{A déjà été vus?}
    B -- Non --> C[Sas d'attente : immo_listings review_status = sas]
    B -- Oui (Base Active) --> D[Mise à jour historique / prix : immo_listings + immo_price_history]
    B -- Oui (Corbeille) --> E[Ignoré / Non ingéré]
    
    C --> F[Scoring automatique sur 10]
    C --> G[Revue & Validation via manage_sas.js]
    G -- Approuvé --> D
    G -- Rejeté --> E
    
    D --> H[Génération Site VitePress docs/biens & JSON]
    H --> I[Interface Web VitePress]
```

1. **Ingestion (Fetch & Multi-dédoublonnage)** :
   - Scan Chrome Debugging sur Leboncoin + requêtes HTTP sur agences partenaires.
   - Contrôle anti-doublon global (toutes les annonces de `immo_listings`, quel que soit leur `review_status`).
2. **Sas d'attente (Staging)** :
   - Toute nouvelle propriété entre dans `immo_listings` avec `review_status = 'sas'`.
   - Le scoring est immédiatement calculé pour faciliter la décision.
3. **Validation / Modération** :
   - L'utilisateur ou l'agent valide (`manage_sas.js approve`) ou rejette (`manage_sas.js reject`).
4. **Scoring Multicritères** :
   - Note initiale de 10/10 déduite des maluses (Tiers localisation, prestations manquantes) et agrémentée de bonus qualité (+0.2 par mot-clé, max +1.0).
5. **Publication HTML (VitePress)** :
   - Exécution de `generate_site.js` pour créer les fiches markdown dans `docs/biens/` et la base JSON `docs/public/listings_data.json`.

---

## 4. Catalogue des Skills & Helper Scripts

### 🔍 `leboncoin_fetch` (Ingestion & Gestion du Sas)
- **Scraper d'annonces** : `node --env-file=.env .agents/skills/leboncoin_fetch/scripts/fetch_listings.js`
  - `--sources=leboncoin,henry,luxior,barraine,human` : limite les sources interrogées (toutes par défaut). Leboncoin s'exécute sur le PC (Chrome en debug), les autres sources peuvent tourner dans le cloud.
  - `--dry-run` : exécute tout le pipeline sans rien écrire dans la base.
  - Le scoring est lancé automatiquement à la fin, et chaque exécution est tracée dans `immo_run_log`.
- **Lister le Sas d'attente** : `node --env-file=.env .agents/skills/leboncoin_fetch/scripts/manage_sas.js list`
- **Valider une annonce du Sas** : `node --env-file=.env .agents/skills/leboncoin_fetch/scripts/manage_sas.js approve <id|all>`
- **Rejeter une annonce du Sas** : `node --env-file=.env .agents/skills/leboncoin_fetch/scripts/manage_sas.js reject <id|all> [motif]`

### 📊 `leboncoin_scoring` (Calcul des Notes)
- **Scorer toutes les annonces (actives + sas)** : `node --env-file=.env .agents/skills/leboncoin_scoring/scripts/score_listings.js` (`--dry-run` pour simuler)

### 💻 `leboncoin_display` (Consultation CLI)
- **Afficher les annonces actives** : `node --env-file=.env .agents/skills/leboncoin_display/scripts/display_listings.js`
- **Afficher les annonces du Sas d'attente** : `node --env-file=.env .agents/skills/leboncoin_display/scripts/display_listings.js --sas`

### 🌐 `leboncoin_generate_site` (Génération Web)
- **Régénérer les fiches et données du site depuis la base** : `npm run generate`
- **Lancer le serveur de développement VitePress** : `npm run dev`
- `npm run build` compile uniquement le site à partir des fichiers déjà générés (utilisé par le déploiement GitHub Pages, sans accès à la base) ; `npm run build:full` régénère puis compile.

### 🗄️ `supabase_sync` (Migration)
- **Migration unique des fiches markdown vers Supabase** : `node --env-file=.env .agents/skills/supabase_sync/scripts/migrate_files_to_supabase.js [--apply]` (dry-run par défaut ; n'insère que les lignes absentes).

### 🗺️ `dvf` (Données Ventes Réelles DGFiP)
- **Télécharger et géolocaliser les données DVF sur Brest** : Voir instructions dans `.agents/skills/dvf/SKILL.md`.

