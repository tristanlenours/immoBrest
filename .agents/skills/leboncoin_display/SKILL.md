---
name: Leboncoin, Agence Henry & Luxior Real Estate Display
description: Displays, filters, and sorts saved Brest real estate listings from local markdown files.
---
# Leboncoin, Agence Henry & Luxior Real Estate Display Skill

This skill allows you to display, sort, and filter the real estate listings stored in the local repository (`leboncoin_searches`).

## When to Use
Use this skill when the user asks to:
* View, display, list, or show Brest real estate listings.
* Sort listings by score, price, size (surface), or date.
* Filter listings by price, score, surface, type (maison/appartement), status (actif, nouveau, vendu, etc.), or query keywords.

## How to Execute
Run the display helper script:
`node .agents/skills/leboncoin_display/scripts/display_listings.js [options]`

### Command Line Options
*   `--limit=<N>`: Limit the output to `N` listings (default: `10`).
*   `--sort=<score|price|surface|date>`: Sort field (default: `score`).
*   `--order=<asc|desc>`: Sort order (default: `desc` for score/surface/date, `asc` for price).
*   `--status=<active|all|vendu|...>`: Status filter. `active` includes "Actif" and "Nouveau" (default: `active`). `all` shows all.
*   `--type=<all|maison|appartement>`: Filter by property type (default: `all`).
*   `--query=<keyword>`: Case-insensitive text search in title, description, location, or prestations.
*   `--min-score=<X>`: Filter out listings with a score lower than `X`.
*   `--max-price=<Y>`: Filter out listings priced higher than `Y`.
*   `--min-surface=<Z>`: Filter out listings with surface smaller than `Z` m².
*   `--format=<markdown|json>`: Output format (default: `markdown` table).

### Examples
1. **Show Top 10 Active Listings (default)**:
   `node .agents/skills/leboncoin_display/scripts/display_listings.js`

2. **Show Top 5 Cheapest Active Listings**:
   `node .agents/skills/leboncoin_display/scripts/display_listings.js --limit=5 --sort=price`

3. **Show Top 10 Active Houses Sorted by Surface**:
   `node .agents/skills/leboncoin_display/scripts/display_listings.js --type=maison --sort=surface`

4. **Show Listings with "Triangle d'Or" in Siam area with Score >= 7**:
   `node .agents/skills/leboncoin_display/scripts/display_listings.js --query="triangle d'or" --min-score=7`
