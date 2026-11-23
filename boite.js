// Boîte de réception simulée : tout est stocké dans un fichier JSON local (aucun serveur mail).
const fs = require('fs');
const path = require('path');

// Forme du fichier : { "mails": [ { id, expediteur, objet, corps, recu, lu, etat, analyse } ], "envoyes": [ ... ] }
// etat : 'en_attente' (pas encore analysé) | 'analyse' | 'erreur'

function chargerBoite(chemin) {
  try {
    const b = JSON.parse(fs.readFileSync(chemin, 'utf8'));
    return { mails: Array.isArray(b.mails) ? b.mails : [], envoyes: Array.isArray(b.envoyes) ? b.envoyes : [] };
  } catch (e) {
    if (e.code !== 'ENOENT') { try { fs.copyFileSync(chemin, chemin + '.corrompu'); } catch (_) { /* rien */ } }
    return { mails: [], envoyes: [] };
  }
}

function sauverBoite(chemin, boite) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  fs.writeFileSync(chemin, JSON.stringify(boite, null, 2), 'utf8');
}

let compteur = 0;
// Crée un mail « reçu » (pas encore analysé, non lu).
function creerMail({ expediteur, objet, corps }) {
  return {
    id: `${Date.now()}-${++compteur}`,
    expediteur: String(expediteur || ''), objet: String(objet || ''), corps: String(corps || ''),
    recu: new Date().toISOString(), lu: false, etat: 'en_attente', analyse: null,
  };
}

// Lit un fichier .txt de test : « De: … », « Objet: … », ligne vide, corps.
function lireFichierMail(chemin) {
  const brut = fs.readFileSync(chemin, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const i = brut.indexOf('\n\n');
  const entete = brut.slice(0, i);
  return {
    expediteur: (entete.match(/^De:\s*(.*)$/m) || [, ''])[1].trim(),
    objet: (entete.match(/^Objet:\s*(.*)$/m) || [, ''])[1].trim(),
    corps: brut.slice(i + 2).trim(),
  };
}

// Les 10 mails de la démo, pris dans le 2e lot aveugle selon une règle fixe (pas de tri selon les résultats) :
// les 5 premiers « phishing » et les 5 premiers « légitime » par ordre de fichier, en alternance.
function mailsDemo(dossierLot) {
  const fichiers = fs.readdirSync(dossierLot).filter((f) => f.endsWith('.txt')).sort();
  const phishing = fichiers.filter((f) => f.startsWith('phishing__')).slice(0, 5);
  const legit = fichiers.filter((f) => f.startsWith('legitime__')).slice(0, 5);
  const ordre = [];
  for (let i = 0; i < 5; i++) ordre.push(phishing[i], legit[i]);
  return ordre.filter(Boolean).map((f) => lireFichierMail(path.join(dossierLot, f)));
}

module.exports = { chargerBoite, sauverBoite, creerMail, lireFichierMail, mailsDemo };
