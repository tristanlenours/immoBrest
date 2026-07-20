---
name: Leboncoin, Agence Henry, Luxior, Human & Castorus Real Estate Fetch
description: Scrapes Brest real estate listings on Leboncoin, Agence Henry, Luxior, Human Immobilier, and Castorus (published <= 30 days), filtering them strictly based on surface (85-150m²), price (300k-600k€), and Brest boundaries, excluding Lambezellec, Kervao, Bohars, Saint-Pierre, Quatre Moulins, Kerbonne, Bellevue, and La Croix-Rouge.
---
# Leboncoin, Agence Henry, Luxior, Human & Castorus Real Estate Fetch Skill

This skill searches Brest real estate listings on Leboncoin, Agence Henry, Luxior Immobilier, Human Immobilier, and Castorus (recent <= 30 days), filters them based on strict criteria, deduplicates/merges matching properties across sites, and saves them to the local repository.

## When to Use
Use this skill when the user asks to:
* Search for new houses or apartments in Brest across Leboncoin, Agence Henry, Luxior, Human Immobilier, and Castorus.
* Run a fetch session to update the repository with new listings, check for price changes, or check for sold properties.

## Search Filters Enforced
*   **Surface Area**: Strictly between **85 m² and 150 m²** (inclusive).
*   **Price**: Strictly between **300 000 € and 600 000 €** (inclusive) OR listed as **"Prix sur demande"**.
*   **Castorus Age**: Listings published within the last **30 days**.
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
    - **Kerbonne**
    - **Bellevue**


## How to Execute
1. Ensure Google Chrome is running in debugging mode:
   * Started with `--remote-debugging-port=9222 --user-data-dir="C:\Users\trist\AppData\Local\Google\Chrome\User Data\TempProfile"`.
2. Run the helper script:
   `node .agents/skills/leboncoin_fetch/scripts/fetch_listings.js`

## Staging Area ("Sas d'attente") & Validation
Newly detected properties are stored in the staging area (`leboncoin_sas/`) to prevent unverified or duplicate listings from directly entering the active database.

### Managing Staged Listings
* **List staged properties**:
  `node .agents/skills/leboncoin_fetch/scripts/manage_sas.js list`
* **Approve property (move to active database `leboncoin_searches/` and rebuild site)**:
  `node .agents/skills/leboncoin_fetch/scripts/manage_sas.js approve <folder_or_id|all>`
* **Reject property (move to trash `corbeille/`)**:
  `node .agents/skills/leboncoin_fetch/scripts/manage_sas.js reject <folder_or_id|all>`

