---
name: Listing enrichment (photos, Gemini analysis, titles)
description: Adds photos to listings, analyses their description with Gemini (features yes/no/unknown, condition, DPE, title complement, strengths and weaknesses) and normalises their title as "Type surface Quartier complément".
---
# Listing enrichment

Runs automatically at the end of each fetch, before scoring. Can also be run on its own.

## What it does
1. **Photos**: for listings without photos, reads the `og:image` and gallery of the agency pages (Henry, Luxior, Barraine). Leboncoin photos come from the search results during the fetch; Human blocks scrapers.
2. **Gemini analysis**: for listings whose description changed since the last analysis (`ai_analysis.input_hash`), asks Gemini for a strict JSON (`shared/listing_ai.js`). Free keys are rotated on quota errors (`shared/gemini.js`).
3. **Title**: `buildHeadline` → `Maison 141 m² Saint-Michel avec jardin et garage`.

## How to Execute
`node --env-file=.env .agents/skills/listing_enrich/scripts/enrich_listings.js [--dry-run] [--force] [--only=<id>] [--no-ai] [--no-photos]`

Then rescore: `node --env-file=.env .agents/skills/leboncoin_scoring/scripts/score_listings.js`

Bump `AI_VERSION` in `shared/listing_ai.js` whenever the prompt or schema changes, so every listing is re-analysed.
