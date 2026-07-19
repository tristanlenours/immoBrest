---
name: Leboncoin, Agence Henry & Luxior Real Estate HTML Generation
description: Generates the VitePress static HTML site from the local real estate markdown database.
---
# Leboncoin, Agence Henry & Luxior Real Estate HTML Generation Skill

This skill allows you to generate and update the static HTML site (built with VitePress) from the real estate listings stored in the local repository (`leboncoin_searches`).

## When to Use
Use this skill when:
* New listings have been fetched using the `leboncoin_fetch` skill.
* Listings have been scored or re-scored using the `leboncoin_scoring` skill.
* You need to update the static website to reflect the latest state, price changes, or sold status of properties.
* You need to build the production static files or run the local development server to preview the dashboard.

## How to Execute

### 1. Generate Site Files (JSON data and Markdown detail sheets)
Run the generation script:
`node .agents/skills/leboncoin_generate_site/scripts/generate_site.js`

This will parse the local searches directory and output the markdown files inside `docs/biens/` and the JSON listings file inside `docs/public/listings_data.json`.

### 2. Standard NPM Scripts
Alternatively, you can use the configured workspace scripts:
* **Regenerate database only**: `npm run generate`
* **Regenerate & run development server (with hot reload)**: `npm run dev`
* **Regenerate & compile production static bundle**: `npm run build`
* **Preview the production build**: `npm run preview`
