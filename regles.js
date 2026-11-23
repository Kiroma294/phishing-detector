// Règles de détection déterministes (sans IA) : rapides, reproductibles, explicables.
// Chaque règle a un poids (0-100) = niveau de suspicion qu'elle apporte à elle seule.

// Coefficient appliqué au poids de l'urgence et de la confidentialité quand l'expéditeur est dans le carnet
// (un client connu écrit parfois « urgent » ou « confidentiel » pour de bonnes raisons).
const COEF_EXPEDITEUR_CONNU = 0.4;

// Fonctions du carnet de confiance, chargées au premier appel (carnet.js dépend de ce fichier).
const trouverParDomaine = (...a) => require('./carnet').trouverParDomaine(...a);
const tousLesDomaines = (...a) => require('./carnet').tousLesDomaines(...a);

// ---------------------------------------------------------------------------
// Données de référence (à adapter au cabinet)
// ---------------------------------------------------------------------------

// Marques souvent usurpées. « mots » = ce qu'on cherche dans le nom affiché ;
// « ok » = expression qui décrit les domaines réellement légitimes de la marque.
const MARQUES = [
  { nom: 'Crédit Agricole', mots: ['credit agricole'], domaine: 'credit-agricole.fr', ok: /(^|\.)(credit-agricole\.(fr|com)|ca-[a-z-]+\.fr)$/ },
  { nom: 'BNP Paribas', mots: ['bnp paribas', 'bnpparibas'], domaine: 'bnpparibas.com', ok: /(^|\.)bnpparibas(\.(com|net|fr))$/ },
  { nom: 'Société Générale', mots: ['societe generale'], domaine: 'societegenerale.fr', ok: /(^|\.)societegenerale\.(fr|com)$/ },
  { nom: 'Caisse d\'Épargne', mots: ['caisse d epargne', 'caisse d\'epargne'], domaine: 'caisse-epargne.fr', ok: /(^|\.)caisse-epargne\.fr$/ },
  { nom: 'La Banque Postale', mots: ['banque postale'], domaine: 'labanquepostale.fr', ok: /(^|\.)labanquepostale\.fr$/ },
  { nom: 'Crédit Mutuel', mots: ['credit mutuel'], domaine: 'creditmutuel.fr', ok: /(^|\.)creditmutuel\.fr$/ },
  { nom: 'PayPal', mots: ['paypal'], domaine: 'paypal.com', ok: /(^|\.)paypal\.(com|fr)$/ },
  { nom: 'Microsoft', mots: ['microsoft'], domaine: 'microsoft.com', ok: /(^|\.)(microsoft|microsoftonline)\.(com|fr)$/ },
  { nom: 'Google', mots: ['google'], domaine: 'google.com', ok: /(^|\.)google\.(com|fr)$/ },
  { nom: 'Amazon', mots: ['amazon'], domaine: 'amazon.fr', ok: /(^|\.)amazon\.(fr|com)$/ },
  { nom: 'Orange', mots: ['orange'], domaine: 'orange.fr', ok: /(^|\.)orange\.(fr|com)$/ },
  { nom: 'La Poste', mots: ['la poste', 'colissimo'], domaine: 'laposte.fr', ok: /(^|\.)(laposte\.(fr|net)|colissimo\.fr)$/ },
  { nom: 'Impots.gouv', mots: ['impots', 'dgfip'], domaine: 'impots.gouv.fr', ok: /(^|\.)gouv\.fr$/ },
  { nom: 'URSSAF', mots: ['urssaf'], domaine: 'urssaf.fr', ok: /(^|\.)urssaf\.fr$/ },
  { nom: 'Ameli', mots: ['ameli', 'assurance maladie'], domaine: 'ameli.fr', ok: /(^|\.)(ameli|assurance-maladie)\.fr$/ },
];

// Messageries gratuites : on les compare aussi pour le typosquatting (gmial.com...).
const MESSAGERIES_GRATUITES = ['gmail.com', 'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'yahoo.fr', 'yahoo.com', 'laposte.net', 'free.fr', 'orange.fr', 'icloud.com'];

// Pays dont l'IBAN est reconnu (code → longueur attendue).
const LONGUEUR_IBAN = {
  FR: 27, DE: 22, ES: 24, IT: 27, BE: 16, LU: 20, NL: 18, PT: 25, GB: 22, IE: 22, CH: 21, LT: 20, LV: 21, EE: 20,
  PL: 28, CZ: 24, SK: 24, AT: 20, MT: 31, CY: 28, GR: 27, RO: 24, BG: 22, HU: 28, SE: 24, DK: 18, NO: 15, FI: 18,
  MC: 27, AE: 23, TR: 26,
};

// Néobanques : mots-clés dans le texte, préfixes de BIC, codes banque d'IBAN français.
const NEOBANQUES = [
  { nom: 'Revolut', mot: /revolut/, bic: /\bREVO[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/, codeBanqueFR: '28233' },
  { nom: 'Wise', mot: /\bwise\b|transferwise/, bic: /\b(?:TRWI|WIS)[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/, codeBanqueFR: '16798' },
  { nom: 'N26', mot: /\bn26\b/, bic: /\bNTSB[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/ },
  { nom: 'Bunq', mot: /\bbunq\b/, bic: /\bBUNQ[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/ },
  { nom: 'Monzo', mot: /\bmonzo\b/, bic: /\bMONZ[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/ },
];

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

// Minuscules + suppression des accents pour comparer les textes simplement.
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’`]/g, "'");
}

// Distance de Levenshtein : nombre minimal de modifications entre deux mots.
function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// Sépare « Nom affiché <adresse@domaine> » en ses parties.
function parserExpediteur(texte) {
  const t = String(texte || '').trim();
  const m = t.match(/^(.*?)<([^>]+)>/);
  const adresse = (m ? m[2] : (t.match(/[^\s<>]+@[^\s<>]+/) || [''])[0]).trim().toLowerCase();
  const nom = m ? m[1].replace(/["']/g, '').trim() : '';
  const domaine = adresse.includes('@') ? adresse.split('@').pop() : '';
  return { nom, adresse, domaine };
}

// Partie « marque » d'un domaine : papeterie-durand.fr → papeterie-durand.
function libelleDomaine(domaine) {
  const p = domaine.split('.');
  return p.length >= 2 ? p[p.length - 2] : domaine;
}

// Remplace les caractères qui ressemblent à d'autres (micr0soft → microsoft).
function sansHomoglyphes(s) {
  return s.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/5/g, 's');
}

// Cherche tous les IBAN du texte (espaces tolérés) et renvoie {pays, iban}.
function trouverIBAN(texte) {
  const trouves = [];
  const re = /\b([A-Z]{2}\d{2}(?:[ \u00a0.-]?[A-Z0-9]{3,4}){3,8})\b/g;
  let m;
  while ((m = re.exec(texte)) !== null) {
    const iban = m[1].replace(/[ \u00a0.-]/g, '');
    const pays = iban.slice(0, 2);
    if (LONGUEUR_IBAN[pays] && Math.abs(iban.length - LONGUEUR_IBAN[pays]) <= 2) trouves.push({ pays, iban });
  }
  return trouves;
}

// Dit si le domaine d imite le domaine connu k (renvoie une explication, sinon null).
function imitation(d, k, estMessagerie) {
  const l = libelleDomaine(d), kl = libelleDomaine(k);
  if (kl.length < 5) return null;
  const ln = sansHomoglyphes(l), kn = sansHomoglyphes(kl);
  if (l !== kl && (ln === kn || (kl.length >= 6 && ln.includes(kn)))) return `@${d} imite @${k} (nom repris ou caractères trompeurs)`;
  const dist = levenshtein(l, kl);
  if (dist >= 1 && dist <= (kl.length >= 8 ? 2 : 1)) return `@${d} ressemble à @${k} (${dist} caractère(s) de différence)`;
  if (l.includes(kl) && kl.length >= 6) return `@${d} reprend le nom de @${k} avec un ajout`;
  // Même nom, autre extension : seulement pour les marques/clients, pas pour les messageries
  if (l === kl && !estMessagerie) return `@${d} reprend le nom de @${k} avec une autre extension`;
  return null;
}

// Domaine connu caché dans un autre domaine : cabinet-roux.fr.partage-docs.net (préfixe),
// cabinet-roux.partage-docs.net (nom en sous-domaine) ou x-cabinet-roux.fr. Le vrai domaine ou un
// vrai sous-domaine (mail.cabinet-roux.fr) ne comptent pas.
function imbrique(d, k) {
  if (d === k || d.endsWith('.' + k)) return null;
  if (d.includes(k)) return `@${d} contient @${k} mais appartient à un autre domaine`;
  const kl = libelleDomaine(k);
  if (kl.length >= 5 && d.split('.').slice(0, -2).includes(kl)) return `@${d} utilise le nom « ${kl} » comme sous-domaine d'un autre site`;
  return null;
}

// Fournisseur du carnet auquel le mail se rapporte : domaine exact, sinon domaine imité.
function fournisseurConcerne(domaine, carnet) {
  if (!carnet || !domaine) return null;
  const exact = trouverParDomaine(carnet, domaine);
  if (exact) return { fournisseur: exact, exact: true };
  for (const f of carnet.fournisseurs) {
    if (f.domaines.some((k) => imitation(domaine, k, false) || imbrique(domaine, k))) return { fournisseur: f, exact: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Les règles : chacune renvoie null (non déclenchée) ou un texte de détail.
// ---------------------------------------------------------------------------
const REGLES = [
  {
    id: 'iban_etranger', poids: 30,
    libelle: 'IBAN dont le pays n\'est pas la France',
    test: ({ texte }) => {
      const etrangers = trouverIBAN(texte).filter((i) => i.pays !== 'FR');
      return etrangers.length ? `IBAN ${etrangers.map((i) => i.pays).join(', ')} : ${etrangers[0].iban}` : null;
    },
  },
  {
    id: 'neobanque', poids: 30,
    libelle: 'Coordonnées d\'une néobanque (Revolut, Wise, N26…)',
    test: ({ texte, brut }) => {
      const t = norm(texte);
      for (const n of NEOBANQUES) {
        if (n.mot.test(t)) return `Mention de ${n.nom}`;
        if (n.bic.test(brut)) return `BIC de ${n.nom}`;
        if (n.codeBanqueFR && trouverIBAN(brut).some((i) => i.pays === 'FR' && i.iban.slice(4, 9) === n.codeBanqueFR)) return `IBAN français hébergé chez ${n.nom}`;
      }
      return null;
    },
  },
  {
    id: 'domaine_nom_affiche', poids: 35,
    libelle: 'Domaine de l\'expéditeur différent du nom affiché',
    test: ({ exp }) => {
      if (!exp.domaine) return null;
      // Cas 1 : le nom affiché contient une autre adresse ou un autre domaine
      const dansNom = norm(exp.nom).match(/[a-z0-9._-]+@([a-z0-9.-]+\.[a-z]{2,})|\b([a-z0-9-]+\.(?:com|fr|net|org|eu|io|info))\b/);
      if (dansNom) {
        const affiche = dansNom[1] || dansNom[2];
        if (affiche !== exp.domaine && !exp.domaine.endsWith('.' + affiche)) return `Nom affiché « ${exp.nom} » mais adresse en @${exp.domaine}`;
      }
      // Cas 2 : le nom affiché cite une marque mais le domaine n'est pas le sien
      const nomNorm = norm(exp.nom);
      for (const m of MARQUES) {
        if (m.mots.some((mot) => nomNorm.includes(mot)) && !m.ok.test(exp.domaine)) {
          return `Nom affiché « ${m.nom} » mais domaine @${exp.domaine}`;
        }
      }
      return null;
    },
  },
  {
    id: 'typosquatting', poids: 40,
    libelle: 'Domaine proche d\'un domaine connu (typosquatting)',
    test: ({ exp, domainesConnus }) => {
      const d = exp.domaine;
      if (!d) return null;
      const connus = [...domainesConnus, ...MARQUES.map((m) => m.domaine), ...MESSAGERIES_GRATUITES];
      // Un domaine exact ou un sous-domaine d'un domaine connu est légitime
      if (connus.some((k) => d === k || d.endsWith('.' + k))) return null;
      // Variantes légitimes d'une marque (ex. amazon.com pour amazon.fr)
      if (MARQUES.some((m) => m.ok.test(d))) return null;
      for (const k of connus) {
        const m = imitation(d, k, MESSAGERIES_GRATUITES.includes(k));
        if (m) return m;
      }
      return null;
    },
  },
  {
    id: 'domaine_imbrique', poids: 45,
    libelle: 'Domaine connu caché dans un autre domaine',
    test: ({ exp, domainesConnus }) => {
      const d = exp.domaine;
      if (!d) return null;
      for (const k of [...domainesConnus, ...MARQUES.map((m) => m.domaine)]) {
        const m = imbrique(d, k);
        if (m) return m;
      }
      return null;
    },
  },
  {
    id: 'urgence', poids: 15, allegeSiConnu: true,
    libelle: 'Mots d\'urgence',
    test: ({ texte }) => {
      const motifs = [/\burgent(e|s)?\b/, /\burgence\b/, /\bimmediatement\b/, /\baujourd'hui\b/, /\bavant \d{1,2} ?h/, /\bsans delai\b/, /\bdans l'heure\b/, /\ble plus vite possible\b/, /\bdernier rappel\b/];
      const hits = motifs.map((re) => (texte.match(re) || [])[0]).filter(Boolean);
      return hits.length ? `Termes : « ${[...new Set(hits)].join(' », « ')} »` : null;
    },
  },
  {
    id: 'confidentialite', poids: 25, allegeSiConnu: true,
    libelle: 'Demande de confidentialité / discrétion',
    test: ({ texte }) => {
      const motifs = [/ne previen(ez|s) (personne|pas)/, /\bconfidentiel(le)?\b/, /\bdiscretion\b/, /n'en parlez (a )?(personne|pas)/, /entre nous/, /garde(z)? (cela|ca) secret/, /ne (le )?dites? (a )?personne/];
      const hits = motifs.map((re) => (texte.match(re) || [])[0]).filter(Boolean);
      return hits.length ? `Termes : « ${[...new Set(hits)].join(' », « ')} »` : null;
    },
  },
  {
    id: 'refus_telephone', poids: 30,
    libelle: 'Refus ou impossibilité de confirmer par téléphone',
    test: ({ texte }) => {
      const motifs = [
        /sans (nous |m')?appeler/, /ne (nous |m')?appelez pas/, /ne pas (nous |m')?appeler/, /ne (me )?telephonez pas/,
        /(ne )?(peux|pouvons|puis) pas (telephoner|etre joint|repondre au telephone|prendre d'appel)/, /impossible de (me )?(telephoner|joindre|appeler)/,
        /pas (de|d') ?(appel|telephone)/, /standard (est )?(en cours|indisponible|ferme)/, /(par )?(mail|courriel|email|e-mail) uniquement/,
        /confirm\w+ par (retour de )?(mail|courriel|email|e-mail)/, /repondez[- ]moi par (mail|email)/,
      ];
      const hits = motifs.map((re) => (texte.match(re) || [])[0]).filter(Boolean);
      return hits.length ? `Termes : « ${hits[0]} »` : null;
    },
  },
  {
    id: 'changement_rib', poids: 30,
    libelle: 'Demande de changement de coordonnées bancaires',
    test: ({ texte }) => {
      const motifs = [
        /changement de (nos |mes |vos )?(coordonnees|banque|rib|iban|compte)/, /nouveau(x)? (rib|iban|compte|coordonnees bancaires)/,
        /nouvelles? coordonnees bancaires/, /(mettre|mise) a jour (de )?(nos|les|mes|vos) (coordonnees|rib|iban)/, /\bancien (rib|iban|compte)\b/,
        /(modifi\w+|chang\w+) (de )?(nos|mes|vos|le|notre) (rib|iban|compte bancaire|banque)/, /virement sur (ce )?(nouveau|autre) compte/,
      ];
      const hits = motifs.map((re) => (texte.match(re) || [])[0]).filter(Boolean);
      return hits.length ? `Termes : « ${hits[0]} »` : null;
    },
  },
  // Alerte forte : le RIB du mail n'est pas celui que le cabinet connaît pour ce fournisseur.
  {
    id: 'rib_modifie', poids: 70,
    libelle: 'Ce RIB a changé : appelez le fournisseur au numéro habituel avant tout paiement.',
    test: ({ ibansMail, concerne }) => {
      if (!concerne || !concerne.fournisseur.ribs.length || !ibansMail.length) return null;
      const f = concerne.fournisseur;
      const inconnus = ibansMail.filter((i) => !f.ribs.includes(i.iban));
      if (!inconnus.length) return null;
      return {
        detail: `${f.nom} : RIB reçu ${inconnus[0].iban}, RIB connu ${f.ribs.join(' / ')}` + (concerne.exact ? '' : ' (le domaine de l\'expéditeur est une imitation)'),
        donnees: { fournisseur: f.nom, recu: inconnus[0].iban, connus: f.ribs, domaineExact: concerne.exact },
      };
    },
  },
  // Règle rassurante : domaine ET RIB connus. Elle ne s'additionne pas aux risques, elle les réduit.
  {
    id: 'confiance_domaine_rib', type: 'confiance', poids: 50,
    libelle: 'Domaine et RIB connus du carnet de confiance',
    test: ({ ibansMail, concerne }) => {
      if (!concerne || !concerne.exact || !concerne.fournisseur.ribs.length || !ibansMail.length) return null;
      const f = concerne.fournisseur;
      return ibansMail.every((i) => f.ribs.includes(i.iban)) ? `${f.nom} : domaine et RIB conformes au carnet` : null;
    },
  },
];

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

// Exécute toutes les règles sur un mail ; renvoie celles qui se déclenchent.
function analyserRegles({ expediteur = '', objet = '', corps = '' }, options = {}) {
  const exp = parserExpediteur(expediteur);
  const brut = `${objet}\n${corps}`;
  const carnet = options.carnet || { fournisseurs: [] };
  const contexte = {
    exp, brut,
    texte: norm(brut),
    carnet,
    domainesConnus: tousLesDomaines(carnet),
    ibansMail: trouverIBAN(brut),
    concerne: fournisseurConcerne(exp.domaine, carnet),
  };
  const declenchees = [];
  for (const r of REGLES) {
    const res = r.test(contexte);
    if (!res) continue;
    const obj = typeof res === 'string' ? { detail: res } : res;   // une règle peut renvoyer aussi des données structurées
    let poids = r.poids;
    let detail = obj.detail;
    if (r.allegeSiConnu && contexte.concerne && contexte.concerne.exact) {
      poids = Math.round(poids * COEF_EXPEDITEUR_CONNU);
      detail += ' (poids réduit : expéditeur connu du carnet)';
    }
    declenchees.push({ id: r.id, type: r.type || 'risque', libelle: r.libelle, poids, detail, donnees: obj.donnees });
  }
  return declenchees;
}

// Faits sur l'expéditeur calculés par le programme (donnés au LLM pour éviter qu'il les invente).
function faitsExpediteur(mail, options = {}) {
  const exp = parserExpediteur(mail.expediteur);
  const carnet = options.carnet || { fournisseurs: [] };
  const concerne = fournisseurConcerne(exp.domaine, carnet);
  const ibans = trouverIBAN(`${mail.objet || ''}\n${mail.corps || ''}`);
  let rib = 'non vérifiable (aucun RIB dans le mail ou aucun RIB connu pour cet expéditeur)';
  if (concerne && concerne.fournisseur.ribs.length && ibans.length) {
    rib = ibans.every((i) => concerne.fournisseur.ribs.includes(i.iban))
      ? 'IDENTIQUE au RIB connu dans le carnet'
      : 'DIFFÉRENT du RIB connu dans le carnet (alerte forte)';
  }
  return {
    adresse: exp.adresse,
    domaine: exp.domaine,
    messagerieGratuite: MESSAGERIES_GRATUITES.includes(exp.domaine),
    domaineConnuCabinet: !!(concerne && concerne.exact),
    fournisseur: concerne ? concerne.fournisseur.nom : null,
    rib,
  };
}

// Score de risque des règles : « OU probabiliste ». Chaque règle de risque est un indice indépendant ;
// R = 100 × (1 − Π(1 − poids/100)). Deux règles à 30 donnent 51, jamais plus de 100.
function scoreRegles(declenchees) {
  const reste = declenchees.filter((r) => r.type !== 'confiance').reduce((acc, r) => acc * (1 - r.poids / 100), 1);
  return Math.round(100 * (1 - reste));
}

// Score de confiance T (0-100) : même principe sur les règles rassurantes.
function scoreConfiance(declenchees) {
  const reste = declenchees.filter((r) => r.type === 'confiance').reduce((acc, r) => acc * (1 - r.poids / 100), 1);
  return Math.round(100 * (1 - reste));
}

// Score final en deux temps :
//   1. risque  S = L + (100 − L) × R / 100      (R = règles de risque, L = IA : le risque ne fait que monter)
//   2. confiance  final = S × (1 − T / 100)     (T = règles rassurantes : réduction proportionnelle)
// Avec une règle rassurante à 50, un score de 44 tombe à 22, mais un score de 99 reste à 50 (« suspect ») :
// la confiance ne peut pas à elle seule blanchir un mail très suspect.
function scoreFinal(r, l, t = 0) {
  const s = l + ((100 - l) * r) / 100;
  return Math.round(s * (1 - t / 100));
}

// Seuils de verdict appliqués au score final.
const SEUIL_PHISHING = 70;
const SEUIL_SUSPECT = 35;
function verdictDepuisScore(score) {
  if (score >= SEUIL_PHISHING) return 'phishing';
  if (score >= SEUIL_SUSPECT) return 'suspect';
  return 'légitime';
}

module.exports = { faitsExpediteur, analyserRegles, scoreRegles, scoreConfiance, scoreFinal, verdictDepuisScore, parserExpediteur, trouverIBAN, REGLES, SEUIL_PHISHING, SEUIL_SUSPECT };
