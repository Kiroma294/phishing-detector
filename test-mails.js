// Banc de test : 10 mails (5 phishing, 5 légitimes dont 2 « pièges »).
// Lancement : npm test. Chaque mail passe par le même code que l'application (règles + LLM).
const path = require('path');
const { listerModeles, analyserMail } = require('./analyse');
const { chargerCarnet } = require('./carnet');

// Carnet de démonstration fixe (le test ne dépend pas du carnet réel de l'utilisateur)
const CARNET = chargerCarnet(path.join(__dirname, 'carnet-demo.json'));

// « attendu » = verdict idéal ; « toleres » = autres verdicts acceptables (cas pièges).
const MAILS = [
  // ---------------------------- PHISHING ----------------------------
  {
    nom: 'P1 Faux IBAN fournisseur', attendu: 'phishing',
    expediteur: 'Service Comptabilité <compta@papeterie-durand-fournitures.com>',
    objet: 'Changement de coordonnées bancaires - facture 2026-1187',
    corps: `Bonjour,

Suite à notre changement de banque, merci de mettre à jour nos coordonnées bancaires dès aujourd'hui.
Le règlement de la facture n°2026-1187 (4 860,00 €) doit être effectué sur notre nouveau compte :

IBAN : LT60 3250 0187 4421 9930
BIC : REVOLT21

Ne tenez pas compte de l'ancien RIB. Merci de confirmer par retour de mail, sans appeler notre standard (en cours de migration).

Cordialement,
Service Comptabilité`,
  },
  {
    nom: 'P2 Faux « président » (gmail)', attendu: 'phishing',
    expediteur: 'Philippe Marchand <p.marchand.pdg@gmail.com>',
    objet: 'URGENT et confidentiel',
    corps: `Bonjour Sophie,

Je suis en réunion à l'extérieur et ne peux pas téléphoner. J'ai besoin que vous effectuiez un virement de 18 500 € aujourd'hui avant 16h pour une acquisition confidentielle. Ne prévenez personne, je vous expliquerai plus tard.

Répondez-moi dès que vous êtes disponible pour que je vous envoie les coordonnées du bénéficiaire.

Philippe Marchand
Envoyé de mon iPhone`,
  },
  {
    nom: 'P3 Faux Microsoft 365', attendu: 'phishing',
    expediteur: 'Support Microsoft <no-reply@micr0soft-support.com>',
    objet: 'Votre mot de passe Microsoft 365 expire dans 24 heures',
    corps: `Bonjour,

Le mot de passe de votre compte professionnel expire dans 24 heures. Pour conserver l'accès à votre messagerie et à vos documents, confirmez votre identité maintenant :

https://micr0soft-support.com/verification-compte

Si vous ne vérifiez pas votre compte, il sera suspendu.

L'équipe Microsoft 365`,
  },
  {
    nom: 'P4 Fausse banque', attendu: 'phishing',
    expediteur: 'Crédit Agricole <securite@credit-agricole-secure.info>',
    objet: 'Alerte : accès à votre espace professionnel bloqué',
    corps: `Cher client,

Une activité inhabituelle a été détectée sur le compte professionnel de votre cabinet. Par mesure de sécurité, l'accès a été bloqué.

Pour le réactiver, saisissez vos identifiants et votre code de validation ici : http://credit-agricole-secure.info/reactivation

Sans action de votre part sous 12 heures, le compte sera définitivement clôturé.

Service Sécurité - Crédit Agricole`,
  },
  {
    nom: 'P5 Faux client (domaine imité + Wise)', attendu: 'phishing',
    expediteur: 'Claire Bonnet <claire.bonnet@boulangerie-bonnnet.fr>',
    objet: 'Nouveau RIB pour le règlement de vos honoraires',
    corps: `Bonjour Madame Roux,

Mon RIB a changé, merci d'utiliser ce nouveau compte pour tous nos échanges de règlement :

IBAN : BE68 5390 0754 7034
BIC : TRWIBEB1XXX

Je suis en déplacement toute la semaine, ne m'appelez pas, répondez-moi simplement par mail pour confirmer la prise en compte.

Cordialement,
Claire Bonnet`,
  },
  // ---------------------------- LÉGITIMES ----------------------------
  {
    nom: 'L1 Client : documents bilan', attendu: 'légitime',
    expediteur: 'Claire Bonnet <claire.bonnet@boulangerie-bonnet.fr>',
    objet: 'Documents pour le bilan 2025',
    corps: `Bonjour Madame Roux,

Comme convenu lors de notre rendez-vous de mardi dernier, je vous joins les relevés bancaires de la boulangerie pour octobre et novembre ainsi que les factures fournisseurs scannées.
Pouvez-vous me dire s'il manque quelque chose avant notre point du 12 décembre ?

Merci beaucoup et bonne journée,
Claire Bonnet
Boulangerie Bonnet - 14 rue de la République, Toulon
04 94 00 00 00`,
  },
  {
    nom: 'L2 PIÈGE vrai mail de banque', attendu: 'légitime', toleres: ['suspect'],
    expediteur: 'Crédit Agricole <ne-pas-repondre@credit-agricole.fr>',
    objet: 'Votre relevé de compte professionnel est disponible',
    corps: `Bonjour,

Votre relevé de compte du mois de novembre est disponible dans votre espace client, rubrique « Documents ».
Votre conseiller vous propose un rendez-vous aujourd'hui ou demain pour faire le point sur votre financement.

Pour votre sécurité, Crédit Agricole ne vous demandera jamais vos identifiants ou codes par mail. Connectez-vous uniquement depuis l'application officielle ou en saisissant vous-même l'adresse de votre banque.

Cordialement,
Crédit Agricole Provence Côte d'Azur`,
  },
  {
    // Avec le carnet, ce RIB diffère du RIB connu : l'outil doit alerter (« suspect » = à vérifier par téléphone).
    nom: 'L3 PIÈGE vrai changement d\'IBAN annoncé', attendu: 'suspect',
    expediteur: 'Marc Durand <m.durand@papeterie-durand.fr>',
    objet: 'Confirmation de notre changement de banque (courrier du 4 novembre)',
    corps: `Bonjour Madame Roux,

Comme annoncé par courrier postal le 4 novembre et lors de notre échange téléphonique de lundi, nous changeons de banque au 1er décembre. Voici nos nouvelles coordonnées, que vous pouvez comparer avec le courrier signé reçu au cabinet :

IBAN : FR76 3000 4008 2800 0123 4567 890
BIC : BNPAFRPP

N'hésitez pas à me rappeler au numéro habituel du service comptabilité pour confirmer ces informations avant toute modification.

Bien cordialement,
Marc Durand - Papeterie Durand, Toulon`,
  },
  {
    nom: 'L4 Collègue du cabinet', attendu: 'légitime',
    expediteur: 'Julien Faure <j.faure@cabinet-roux.fr>',
    objet: 'Dossier Martin à relire avant ce soir',
    corps: `Salut Sophie,

Peux-tu relire la liasse fiscale du garage Martin aujourd'hui ? Je la dépose sur le serveur du cabinet dans le dossier Clients/Martin/2025. On en parle à la pause café si tu as des questions.

Merci,
Julien`,
  },
  {
    nom: 'L5 Petit client en gmail', attendu: 'légitime', toleres: ['suspect'],
    expediteur: 'Thomas Perrin <thomas.perrin.plomberie@gmail.com>',
    objet: 'Attestation de TVA',
    corps: `Bonjour,

Pourriez-vous m'envoyer mon attestation de régularité fiscale pour un dossier de marché public ? C'est pour la fin du mois.
Je passe au cabinet jeudi matin si c'est plus simple.

Merci d'avance,
Thomas Perrin
Plomberie Perrin - La Seyne-sur-Mer`,
  },
];

const pad = (s, n) => String(s).padEnd(n).slice(0, n);

(async () => {
  console.log('Modèles Ollama installés :', (await listerModeles()).join(', '));
  const lignes = [];
  const detail = [];
  for (const m of MAILS) {
    try {
      const r = await analyserMail(m, undefined, CARNET);
      const exact = r.verdict === m.attendu;
      const tolere = !exact && (m.toleres || []).includes(r.verdict);
      lignes.push({ nom: m.nom, attendu: m.attendu, obtenu: r.verdict, R: `${r.scoreRegles}${r.scoreConfiance ? '/-' + r.scoreConfiance : ''}`, L: r.scoreLLM, final: r.score, ok: exact ? 'OK' : tolere ? 'toléré' : 'ÉCHEC', exact, tolere });
      detail.push(`${m.nom}\n   règles : ${r.regles.map((x) => `${x.id}(${x.poids})`).join(', ') || 'aucune'}\n   LLM (${r.llm.verdict}) : ${r.llm.indices.join(' | ')}\n   action : ${r.action}`);
    } catch (e) {
      lignes.push({ nom: m.nom, attendu: m.attendu, obtenu: 'ERREUR', R: '-', L: '-', final: '-', ok: 'ÉCHEC', exact: false, tolere: false });
      detail.push(`${m.nom}\n   ERREUR [${e.code}] ${e.message}`);
    }
  }

  console.log('\n' + pad('Mail', 40) + pad('Attendu', 11) + pad('Obtenu', 11) + pad('R/-T', 8) + pad('LLM', 6) + pad('Final', 7) + 'Résultat');
  console.log('-'.repeat(92));
  for (const l of lignes) {
    console.log(pad(l.nom, 40) + pad(l.attendu, 11) + pad(l.obtenu, 11) + pad(l.R, 8) + pad(l.L, 6) + pad(l.final, 7) + l.ok);
  }
  const exacts = lignes.filter((l) => l.exact).length;
  const toleres = lignes.filter((l) => l.tolere).length;
  console.log('-'.repeat(92));
  console.log(`Taux de réussite strict : ${exacts}/${lignes.length} (${Math.round((100 * exacts) / lignes.length)} %)`);
  console.log(`Avec verdicts tolérés (cas pièges : « suspect » acceptable) : ${exacts + toleres}/${lignes.length} (${Math.round((100 * (exacts + toleres)) / lignes.length)} %)`);
  if (process.argv.includes('--detail')) console.log('\nDétail :\n' + detail.join('\n'));
})();
