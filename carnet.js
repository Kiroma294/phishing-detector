// Carnet de confiance : fournisseurs/clients connus (domaines) et leurs RIB habituels.
// Stocké dans un fichier JSON local, jamais envoyé ailleurs.
const fs = require('fs');
const path = require('path');
const { trouverIBAN } = require('./regles');

// Forme du fichier : { "fournisseurs": [ { "nom": "...", "domaines": ["x.fr"], "ribs": ["FR76..."] } ] }

// IBAN sans espaces, en majuscules.
function normaliserIBAN(s) {
  return String(s || '').replace(/[\s.\u00a0-]/g, '').toUpperCase();
}

// Charge le carnet. Fichier absent → carnet vide. Fichier corrompu → copie .corrompu puis carnet vide
// (on ne l'écrase pas en silence).
function chargerCarnet(chemin) {
  try {
    const c = JSON.parse(fs.readFileSync(chemin, 'utf8'));
    return { fournisseurs: Array.isArray(c.fournisseurs) ? c.fournisseurs : [] };
  } catch (e) {
    if (e.code !== 'ENOENT') {
      try { fs.copyFileSync(chemin, chemin + '.corrompu'); } catch (_) { /* rien */ }
    }
    return { fournisseurs: [] };
  }
}

function sauverCarnet(chemin, carnet) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  fs.writeFileSync(chemin, JSON.stringify(carnet, null, 2), 'utf8');
}

// Ajoute un domaine et/ou un RIB à un fournisseur (créé s'il n'existe pas). Lève une erreur en français si invalide.
function ajouterEntree(carnet, { nom, domaine, iban }) {
  nom = String(nom || '').trim();
  domaine = String(domaine || '').trim().toLowerCase().replace(/^@/, '');
  iban = normaliserIBAN(iban);
  if (!nom) throw new Error('Indiquez le nom du fournisseur ou du client.');
  if (!domaine && !iban) throw new Error('Indiquez au moins un domaine ou un RIB.');
  if (domaine && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domaine)) throw new Error(`Domaine invalide : « ${domaine} » (exemple : papeterie-durand.fr).`);
  if (iban && !trouverIBAN(iban).length) throw new Error('RIB/IBAN invalide : vérifiez le code pays et la longueur.');

  let f = carnet.fournisseurs.find((x) => x.nom.toLowerCase() === nom.toLowerCase());
  if (!f) { f = { nom, domaines: [], ribs: [] }; carnet.fournisseurs.push(f); }
  if (domaine && !f.domaines.includes(domaine)) f.domaines.push(domaine);
  if (iban && !f.ribs.includes(iban)) f.ribs.push(iban);
  return carnet;
}

// Supprime un fournisseur entier, ou seulement un domaine / un RIB (type = 'domaine' | 'rib').
function supprimerEntree(carnet, nom, type, valeur) {
  const f = carnet.fournisseurs.find((x) => x.nom === nom);
  if (!f) return carnet;
  if (type === 'domaine') f.domaines = f.domaines.filter((d) => d !== valeur);
  else if (type === 'rib') f.ribs = f.ribs.filter((r) => r !== valeur);
  else carnet.fournisseurs = carnet.fournisseurs.filter((x) => x !== f);
  return carnet;
}

// Fournisseur dont le domaine est exactement celui du mail (ou un sous-domaine).
function trouverParDomaine(carnet, domaine) {
  if (!carnet || !domaine) return null;
  return carnet.fournisseurs.find((f) => f.domaines.some((d) => domaine === d || domaine.endsWith('.' + d))) || null;
}

function tousLesDomaines(carnet) {
  return carnet ? carnet.fournisseurs.flatMap((f) => f.domaines) : [];
}

module.exports = { chargerCarnet, sauverCarnet, ajouterEntree, supprimerEntree, trouverParDomaine, tousLesDomaines, normaliserIBAN };
