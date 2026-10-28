const path = require('node:path');
const { execSync } = require('node:child_process');
const { ListingStore, rowToParsed } = require('../../shared/listing_store');

const GENERATE_SCRIPT = path.resolve(__dirname, '../../leboncoin_generate_site/scripts/generate_site.js');

function getStagedListings(store) {
  return store.byReviewStatus('sas').map(row => {
    const parsed = rowToParsed(row);
    return {
      id: row.id,
      source: row.source,
      title: row.title,
      price: parsed.priceClean,
      location: row.location || '',
      surface: parsed.surfaceStr || 'N/A',
      score: `${parsed.score}/10`,
      url: row.url
    };
  });
}

function listSas(store) {
  const listings = getStagedListings(store);
  if (listings.length === 0) {
    console.log("Le sas d'attente est vide (0 annonce en attente de validation).");
    return;
  }

  console.log(`\n================ SAS D'ATTENTE (${listings.length} annonce(s) en attente) ================`);
  console.table(listings.map(l => ({
    Identifiant: l.id,
    Source: l.source,
    Titre: l.title.length > 40 ? l.title.substring(0, 37) + '...' : l.title,
    Prix: l.price,
    Localisation: l.location,
    Surface: l.surface,
    Score: l.score
  })));
  console.log('==================================================================================');
  console.log('\nCommandes disponibles :');
  console.log('  node --env-file=.env .agents/skills/leboncoin_fetch/scripts/manage_sas.js approve <id|all>');
  console.log('  node --env-file=.env .agents/skills/leboncoin_fetch/scripts/manage_sas.js reject <id|all> [motif]');
}

function refreshSite() {
  try {
    console.log('\nRégénération du site...');
    execSync(`node --env-file=.env "${GENERATE_SCRIPT}"`, { stdio: 'inherit' });
    console.log('Site VitePress mis à jour avec succès.');
  } catch (err) {
    console.error('Erreur lors de la génération du site:', err.message);
  }
}

async function decide(store, target, decision, reason = null) {
  const listings = getStagedListings(store);
  const verb = decision === 'approved' ? 'valider' : 'rejeter';
  if (listings.length === 0) {
    console.log(`Aucune annonce dans le sas à ${verb}.`);
    return [];
  }

  const selected = target === 'all'
    ? listings
    : listings.filter(l => l.id === target || l.id.includes(target));

  if (selected.length === 0) {
    console.error(`Aucune annonce ne correspond au terme "${target}" dans le sas.`);
    return [];
  }

  for (const item of selected) {
    await store.update(item.id, {
      review_status: decision,
      decided_at: new Date().toISOString(),
      decided_by: 'cli',
      reject_reason: decision === 'rejected' ? reason : null
    });
    console.log(decision === 'approved'
      ? `[APPROUVÉ] ${item.id} ajouté à la base active.`
      : `[REJETÉ] ${item.id} déplacé vers la corbeille.`);
  }

  refreshSite();
  return selected.map(i => i.id);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ? args[0].toLowerCase() : 'list';
  const target = args[1];

  const store = new ListingStore();
  await store.load();

  if (command === 'list' || command === 'ls') {
    listSas(store);
  } else if (command === 'approve' || command === 'accept') {
    if (!target) {
      console.error('Veuillez spécifier l\'identifiant ou "all". Exemple: node manage_sas.js approve all');
      process.exit(1);
    }
    await decide(store, target, 'approved');
  } else if (command === 'reject' || command === 'trash') {
    if (!target) {
      console.error('Veuillez spécifier l\'identifiant ou "all". Exemple: node manage_sas.js reject all');
      process.exit(1);
    }
    await decide(store, target, 'rejected', args[2] || null);
  } else {
    console.log(`Commande inconnue "${command}". Usage: node manage_sas.js [list|approve|reject] [target]`);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { getStagedListings };
