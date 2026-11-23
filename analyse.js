// Logique d'analyse : dialogue avec Ollama (localhost uniquement).
// Ce module est indépendant d'Electron pour pouvoir être testé en ligne de commande.

// Seule adresse autorisée : la machine locale. Aucune donnée ne sort du PC.
const OLLAMA_URL = 'http://127.0.0.1:11434';
const MODELE_PAR_DEFAUT = 'qwen3:8b';
const { faitsExpediteur, analyserRegles, scoreRegles, scoreConfiance, scoreFinal, verdictDepuisScore, SEUIL_PHISHING } = require('./regles');
const VERDICTS = ['phishing', 'suspect', 'légitime'];

// Consigne système : impose une réponse JSON stricte, en français.
// Les règles déjà déclenchées par le programme (regles.js) sont insérées dans la consigne.
function construireConsigne(regles, faits) {
  const blocRegles = regles.length
    ? 'Le programme a déjà détecté ces signaux avec des règles automatiques (fiables, ne les contredis pas sans raison) :\n' +
      regles.map((r) => `- ${r.libelle} : ${r.detail}`).join('\n') +
      '\nTa mission est de juger le contexte et de relever les signaux que les règles ne voient pas.'
    : "Le programme n'a déclenché aucune règle automatique. Cela ne prouve pas que le mail est sûr : juge le contexte.";

  return `Tu es un expert en cybersécurité qui protège un petit cabinet comptable français.
L'utilisateur travaille DANS le cabinet comptable. Les expéditeurs des mails sont donc des clients, des fournisseurs
ou des collègues : ce ne sont jamais le cabinet lui-même. Ne confonds pas « l'expéditeur » et « le cabinet ».
On te donne un mail reçu (expéditeur, objet, corps). Tu dois dire s'il s'agit d'un phishing.

Faits sur l'expéditeur, calculés par le programme (exacts, ne les contredis pas) :
- adresse : ${faits.adresse || 'inconnue'} (domaine : ${faits.domaine || 'inconnu'})
- messagerie gratuite (gmail, outlook, hotmail, yahoo...) : ${faits.messagerieGratuite ? 'OUI' : 'NON'}
- domaine déjà connu du cabinet (client ou fournisseur habituel) : ${faits.domaineConnuCabinet ? 'OUI' + (faits.fournisseur ? ' (' + faits.fournisseur + ')' : '') : 'non'}
- RIB/IBAN présent dans le mail, comparé au carnet de confiance : ${faits.rib}

${blocRegles}

Signaux à rechercher :
- domaine de l'expéditeur qui imite un domaine connu ou ne correspond pas à la signature
- demande de changement de coordonnées bancaires (IBAN/RIB) ou de virement inhabituel
- urgence artificielle, confidentialité exigée, pression de la hiérarchie
- liens ou pièces jointes suspects, demande d'identifiants
- adresse de messagerie gratuite (gmail, outlook, hotmail, yahoo...) utilisée par un dirigeant ou par une entreprise : relève-le dans les indices UNIQUEMENT si le fait « messagerie gratuite » ci-dessus vaut OUI
- ton ou fautes qui ne correspondent pas à l'interlocuteur habituel
- à l'inverse, un mail cohérent, sans demande d'argent ni de données sensibles, avec un contexte précis et vérifiable est probablement légitime

Calibration du score (le verdict et le score doivent être cohérents) :
- légitime : score de 0 à 30 ; suspect : 31 à 69 ; phishing : 70 à 100.
- Un mail normal, sans aucun signal inquiétant : score de 0 à 10.
- Une adresse de messagerie gratuite SEULE (sans demande d'argent, de RIB ou d'identifiants) est un signal faible : score 30 maximum, verdict « légitime ».
- Un changement de RIB annoncé par un fournisseur connu du cabinet, déjà notifié par un autre canal (courrier, téléphone) et invitant à rappeler le numéro habituel, est légitime ; il reste simplement à vérifier : score d'environ 20 à 30.
- Une banque ou un service réel qui invite à se connecter via son application officielle SANS lien ni demande d'identifiants, avec un domaine officiel, est légitime. Une proposition de rendez-vous « aujourd'hui » n'est pas une urgence artificielle.
- Si le fait ci-dessus indique un RIB DIFFÉRENT du RIB connu : c'est une alerte forte, jamais « légitime » ; recommande de rappeler le fournisseur au numéro connu avant tout paiement.
- Si le RIB est IDENTIQUE au RIB connu et que le domaine est connu : c'est un signal rassurant.
- Ne mets un score ≥ 70 que s'il y a au moins un signal fort : demande d'argent ou de RIB incohérente, domaine imité, identifiants demandés, confidentialité exigée.

Interdictions :
- L'outil n'analyse NI les liens NI les pièces jointes. Ne dis jamais qu'un lien ou une pièce jointe est sûr(e) ou fiable.
  S'il y en a, écris « vérifiez avant d'ouvrir » dans l'action.

L'action recommandée doit être concrète :
- pour toute demande d'argent ou de changement de RIB : rappeler l'expéditeur au numéro déjà connu du cabinet (jamais celui indiqué dans le mail),
  et ne pas modifier le RIB ni effectuer le virement avant cette vérification ;
- pour un mail suspect : ne pas répondre, ne pas cliquer, signaler au responsable ;
- pour un mail légitime : dire simplement quoi faire du mail (répondre, classer...), sans formule vague.

Réponds UNIQUEMENT avec un objet JSON, sans texte autour, au format exact :
{
  "verdict": "phishing" | "suspect" | "légitime",
  "score": nombre entier de 0 (sûr) à 100 (phishing certain),
  "indices": ["signal détecté 1", "signal détecté 2"],
  "explication": "2 à 3 phrases simples, pour quelqu'un qui n'est pas informaticien",
  "action": "ce que l'utilisateur doit faire concrètement"
}`;
}

// Liste les modèles installés. Lève une erreur claire si Ollama est éteint.
async function listerModeles() {
  let rep;
  try {
    rep = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
  } catch (e) {
    throw new ErreurOllama('OLLAMA_INDISPONIBLE',
      "Ollama ne répond pas. Lancez l'application Ollama (ou « ollama serve ») puis réessayez.");
  }
  if (!rep.ok) throw new ErreurOllama('OLLAMA_HTTP', `Ollama a répondu avec le code ${rep.status}.`);
  const data = await rep.json();
  return (data.models || []).map((m) => m.name);
}

// Erreur typée pour que l'interface affiche un message adapté.
class ErreurOllama extends Error {
  constructor(code, message, brut) {
    super(message);
    this.code = code;
    this.brut = brut;
  }
}

// Extrait un objet JSON d'un texte (le modèle ajoute parfois du texte ou des ```).
function extraireJSON(texte) {
  const nettoye = texte.replace(/```json|```/gi, '').trim();
  try { return JSON.parse(nettoye); } catch (_) { /* on tente l'extraction ci-dessous */ }
  const debut = nettoye.indexOf('{');
  const fin = nettoye.lastIndexOf('}');
  if (debut !== -1 && fin > debut) {
    try { return JSON.parse(nettoye.slice(debut, fin + 1)); } catch (_) { /* échec */ }
  }
  return null;
}

// Vérifie et normalise la réponse du modèle. Retourne null si inutilisable.
function validerResultat(obj) {
  if (!obj || typeof obj !== 'object') return null;
  // Tolère les variantes de casse/accents du verdict
  let v = String(obj.verdict || '').toLowerCase().trim();
  if (v === 'legitime' || v === 'légitime' || v === 'legit') v = 'légitime';
  if (!VERDICTS.includes(v)) return null;
  const score = Math.round(Number(obj.score));
  if (!Number.isFinite(score)) return null;
  return {
    verdict: v,
    score: Math.min(100, Math.max(0, score)),
    indices: Array.isArray(obj.indices) ? obj.indices.map(String) : [],
    explication: String(obj.explication || ''),
    action: String(obj.action || ''),
  };
}

// Appel du LLM seul : une nouvelle tentative est faite si le JSON est invalide.
async function analyserLLM({ expediteur, objet, corps }, regles, faits, modele = MODELE_PAR_DEFAUT) {
  const message = `Expéditeur : ${expediteur}\nObjet : ${objet}\n\nCorps du mail :\n${corps}`;
  let dernierBrut = '';

  for (let essai = 1; essai <= 2; essai++) {
    let rep;
    try {
      rep = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modele,
          stream: false,
          think: false,      // pas de « réflexion » longue : réponse plus rapide
          format: 'json',    // force Ollama à produire du JSON syntaxiquement valide
          options: { temperature: 0.1 }, // peu de hasard : verdicts reproductibles
          messages: [
            { role: 'system', content: construireConsigne(regles, faits) },
            { role: 'user', content: message },
          ],
        }),
        signal: AbortSignal.timeout(180000),
      });
    } catch (e) {
      throw new ErreurOllama('OLLAMA_INDISPONIBLE',
        "Ollama ne répond pas. Lancez l'application Ollama (ou « ollama serve ») puis réessayez.");
    }
    if (!rep.ok) {
      const detail = await rep.text();
      if (rep.status === 404) {
        throw new ErreurOllama('MODELE_ABSENT',
          `Le modèle « ${modele} » n'est pas installé. Installez-le avec : ollama pull ${modele}`, detail);
      }
      throw new ErreurOllama('OLLAMA_HTTP', `Ollama a répondu avec le code ${rep.status}.`, detail);
    }
    const data = await rep.json();
    dernierBrut = (data.message && data.message.content) || '';
    const resultat = validerResultat(extraireJSON(dernierBrut));
    if (resultat) return resultat;
  }
  throw new ErreurOllama('JSON_INVALIDE',
    "Le modèle a renvoyé une réponse inexploitable (JSON invalide). Réessayez l'analyse.", dernierBrut);
}

// Analyse hybride : règles déterministes + LLM, puis combinaison des deux scores.
// Le carnet de confiance (domaines + RIB connus) est passé en paramètre : { fournisseurs: [...] }.
async function analyserMail(mail, modele = MODELE_PAR_DEFAUT, carnet = { fournisseurs: [] }) {
  const regles = analyserRegles(mail, { carnet });
  const scoreR = scoreRegles(regles);
  const scoreT = scoreConfiance(regles);
  const llm = await analyserLLM(mail, regles, faitsExpediteur(mail, { carnet }), modele);
  // Cohérence : le LLM met parfois « suspect » avec un score de 85. On ramène son score
  // dans la tranche de son propre verdict (légitime 0-30, suspect 31-69, phishing 70-100).
  const tranches = { 'légitime': [0, 30], suspect: [31, 69], phishing: [70, 100] };
  const [min, max] = tranches[llm.verdict];
  llm.scoreBrut = llm.score;
  llm.score = Math.min(max, Math.max(min, llm.score));
  let score = scoreFinal(scoreR, llm.score, scoreT);
  // RIB changé MAIS domaine exact d'un fournisseur connu : on ne peut pas affirmer que c'est une arnaque
  // (changement de banque réel possible), mais il faut vérifier. Plafond : « suspect ».
  const rib = regles.find((r) => r.id === 'rib_modifie');
  const plafonne = !!(rib && rib.donnees.domaineExact && score >= SEUIL_PHISHING);
  if (plafonne) score = SEUIL_PHISHING - 1;
  return {
    verdict: verdictDepuisScore(score),   // le verdict découle du score final, pas du seul LLM
    score,
    scoreRegles: scoreR,
    scoreConfiance: scoreT,
    ribModifie: rib ? rib.donnees : null,   // { fournisseur, recu, connus, domaineExact }
    plafonne,
    scoreLLM: llm.score,
    regles,
    llm,
    // Textes destinés à l'utilisateur : ceux du LLM
    indices: llm.indices,
    explication: llm.explication,
    action: llm.action,
  };
}

module.exports = { listerModeles, analyserMail, analyserLLM, extraireJSON, validerResultat, ErreurOllama, MODELE_PAR_DEFAUT };
