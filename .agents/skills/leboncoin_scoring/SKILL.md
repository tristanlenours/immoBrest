---
name: Leboncoin & Agence Henry Real Estate Scoring
description: Scores saved Brest real estate properties on a 10-point scale based on specific location criteria, building features (last floor, elevator, terrace, parking), and handles maximum caps.
---
# Leboncoin & Agence Henry Real Estate Scoring Skill

This skill reads saved real estate listings in the local repository and computes/updates their scoring and criteria checkboxes based on specific bonuses and constraints.

## When to Use
Use this skill when the user asks to:
* Apply scoring to newly fetched real estate listings.
* Recalculate scores for properties stored in the repository.

## Scoring System Criteria (Deductive starting from 10/10)
All properties start with a default score of **10.0/10** and accumulate penalties (maluses) for missing criteria:

*   **Location Maluses**:
    - **Tiers 1** (Siam, Triangle d'Or, Place Wilson, Saint-Louis, Gare, Cours Dajot, Château, Jardin des Explorateurs) → No penalty (0.0).
    - **Tiers 2** (Saint-Michel, Gambetta, Fac de médecine, Centre-ville, Pasteur, Saint-Martin, Linois, Capucins, Branda, Liberté) → Penalty of **-2.0 points**.
    - **Tiers 3** (Others, e.g., Guelmeur, Saint-Marc, Lanrédec, Kérinou) → Penalty of **-4.0 points**.
*   **Common Prestations Maluses**:
    - No terrace or garden (Houses must have Jardin, Apartments must have Terrasse) → Penalty of **-2.0 points**.
    - No parking or garage → Penalty of **-1.5 points**.
*   **Apartment-Only Maluses** (Not applied to Houses):
    - Not last floor → Penalty of **-2.0 points**.
    - Not seul à l'étage → Penalty of **-1.5 points**.
    - No elevator → Penalty of **-1.5 points**.
    - Last floor AND no elevator → Extra penalty of **-2.0 points**.
*   **Surface Maluses & Exclusions**:
    - Surface <= 63 m² → Excluded (Statut: "Hors zone (surface exclue)").
    - Surface <= 85 m² → Penalty of **-2.0 points**.
    - Surface < 95 m² (and > 85 m²) → Penalty of **-1.0 point**.
    - Surface > 130 m² → Penalty of **-1.0 point**.
*   **Chambres & Pièces Maluses**:
    - 4 pièces and only 2 chambres → Penalty of **-2.0 points**.
    - 2 chambres (in other cases) → Penalty of **-1.0 point**.
    - >= 5 chambres → Penalty of **-1.0 point**.

*   **Quality Bonus (Bonus qualité)**:
    - Earn **+0.2 points** for each of the following keywords detected in the title, description, or prestations, up to a maximum total bonus of **+1.0 point**:
      - `coup de coeur` / `coup de cœur`
      - `standing`
      - `rare`
      - `exceptionnel` / `exceptionnelle` / `d'exception`
      - `vue mer` / `vue sur la mer` / `vue sur la rade`
      - `grand balcon`
      - `privilégié` / `privilégiée`
      - `beaux volumes` / `beau volume`
      - `privatif` / `privative`
      - `haut de gamme`
      - `prestations supérieures`
      - `matériaux de qualité` / `prestations de qualité`
      - `tranquillité` / `tranquille`
      - `dalle béton` / `dalle en béton`
      - `magnifique`
      - `baignée de lumière` / `baigné de lumière`
      - `suite parentale`
      - `superbe prestation` / `superbes prestations`
      - `quartier recherché`
      - `environnement calme` / `calme`
      - `sans vis-à-vis` / `sans vis a vis`
      - `bien exposé` / `exposé sud` / `exposé sud-ouest`
      - `unique`
      - `aucun travaux à prévoir`
      - `cachet`
      - `confort`
    - Capped at a maximum final score of **10.0/10**.

*   **Quality Malus (Malus qualité)**:
    - Penalty of **-1.0 point** if renovation terms are detected (`travaux à prévoir`, `à rafraîchir`, `à remettre au goût du jour`), EXCEPT if exclusions are also present (e.g. `pas de travaux`, `aucun travaux`, `sans travaux`, `travaux réalisés`).

## How to Execute
Run the helper script:
`node .agents/skills/leboncoin_scoring/scripts/score_listings.js`
