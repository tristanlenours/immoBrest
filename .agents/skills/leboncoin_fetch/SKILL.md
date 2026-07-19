---
name: Leboncoin, Agence Henry, Luxior & Human Real Estate Fetch
description: Scrapes Brest real estate listings on Leboncoin, Agence Henry, Luxior, and Human Immobilier, filtering them strictly based on surface (90-140m²), price (300k-600k€), and Brest boundaries, excluding Lambezellec, Kervao, Bohars, Saint-Pierre, and Quatre Moulins.
---
# Leboncoin, Agence Henry, Luxior & Human Real Estate Fetch Skill

This skill searches Brest real estate listings on Leboncoin, Agence Henry, Luxior Immobilier, and Human Immobilier, filters them based on strict criteria, deduplicates/merges matching properties across sites (prioritizing Leboncoin folders), and saves them to the local repository.

## When to Use
Use this skill when the user asks to:
* Search for new houses or apartments in Brest across Leboncoin, Agence Henry, Luxior, and Human Immobilier.
* Run a fetch session to update the repository with new listings, check for price changes, or check for sold properties.

## Search Filters Enforced
*   **Surface Area**: Strictly between **85 m² and 150 m²** (inclusive).
*   **Price**: Strictly between **300 000 € and 600 000 €** (inclusive) OR listed as **"Prix sur demande"**.
*   **Exclusion**: Any listing located outside Brest, or mentioning:
    - **Lambezellec** (or `lambezelec`)
    - **Kervao**
    - **Bohars**
    - **Saint-Pierre** (or `saint pierre`, `st pierre`, `sait pierre`)
    - **Quatre Moulins** (or `4 moulins`)
    - **La Croix-Rouge** (or `croix rouge`, `la croix rouge`, `croix-rouge`)
    - **Kergaradec**
    - **Europe**
    - **Saint-Renan** (or `saint renan`, `st renan`, `saint-renan`)


## How to Execute
1. Ensure Google Chrome is running in debugging mode:
   * Started with `--remote-debugging-port=9222 --user-data-dir="C:\Users\trist\AppData\Local\Google\Chrome\User Data\TempProfile"`.
2. Run the helper script:
   `node .agents/skills/leboncoin_fetch/scripts/fetch_listings.js`
