// Test aveugle : lit les mails du dossier mails-aveugles/ (un .txt par mail).
// Le verdict attendu est dans le nom du fichier : phishing__01-xxx.txt, suspect__..., legitime__...
// Format d'un fichier : "De: ...", "Objet: ...", ligne vide, corps.
//
// RÈGLE : les résultats sont affichés tels quels. On ne modifie ni la consigne ni les règles
// après les avoir vus. Les empreintes (SHA-256) du code analysé sont imprimées et enregistrées
// dans resultats-aveugles.json pour pouvoir le prouver.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { analyserMail, listerModeles } = require('./analyse');
const { chargerCarnet } = require('./carnet');

// Dossier du lot à tester : premier argument qui n'est pas une option (défaut : mails-aveugles)
const NOM_LOT = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'mails-aveugles';
const DOSSIER = path.join(__dirname, NOM_LOT);
const CARNET = chargerCarnet(path.join(__dirname, 'carnet-demo.json'));
const ACCENTS = { phishing: 'phishing', suspect: 'suspect', legitime: 'légitime' };

const empreinte = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, f))).digest('hex').slice(0, 12);
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

// Lit un fichier mail et renvoie { nom, attendu, expediteur, objet, corps }.
function lireMail(fichier) {
  const brut = fs.readFileSync(path.join(DOSSIER, fichier), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const [prefixe] = fichier.split('__');
  const attendu = ACCENTS[prefixe.toLowerCase()];
  if (!attendu) throw new Error(`Nom de fichier invalide (attendu phishing__/suspect__/legitime__) : ${fichier}`);
  const i = brut.indexOf('\n\n');
  const entete = brut.slice(0, i);
  return {
    nom: fichier.replace(/\.txt$/, ''),
    attendu,
    expediteur: (entete.match(/^De:\s*(.*)$/m) || [, ''])[1].trim(),
    objet: (entete.match(/^Objet:\s*(.*)$/m) || [, ''])[1].trim(),
    corps: brut.slice(i + 2).trim(),
  };
}

(async () => {
  if (!fs.existsSync(DOSSIER)) { console.error(`Dossier ${NOM_LOT}/ introuvable.`); process.exit(1); }
  const fichiers = fs.readdirSync(DOSSIER).filter((f) => f.endsWith('.txt')).sort();
  const mails = fichiers.map(lireMail);

  console.log('Modèles Ollama :', (await listerModeles()).join(', '));
  const hashes = { 'analyse.js': empreinte('analyse.js'), 'regles.js': empreinte('regles.js') };
  console.log(`Code testé (SHA-256 tronqué) : analyse.js=${hashes['analyse.js']}  regles.js=${hashes['regles.js']}`);
  console.log(`${mails.length} mails lus dans ${NOM_LOT}/\n`);

  const lignes = [];
  for (const m of mails) {
    try {
      const r = await analyserMail(m, undefined, CARNET);
      lignes.push({ ...m, obtenu: r.verdict, R: r.scoreRegles, T: r.scoreConfiance, L: r.scoreLLM, final: r.score, regles: r.regles.map((x) => x.id), llm: r.llm, action: r.action });
    } catch (e) {
      lignes.push({ ...m, obtenu: 'ERREUR', R: '-', T: 0, L: '-', final: '-', regles: [], erreur: `${e.code}: ${e.message}` });
    }
  }

  const statut = (l) => (l.obtenu === l.attendu ? 'OK' : l.attendu === 'phishing' && l.obtenu === 'légitime' ? 'ÉCHEC GRAVE (phishing raté)'
    : l.attendu === 'légitime' && l.obtenu === 'phishing' ? 'ÉCHEC (fausse alerte)' : 'ÉCART');

  console.log(pad('Mail', 44) + pad('Attendu', 10) + pad('Obtenu', 10) + pad('R/-T', 8) + pad('LLM', 5) + pad('Final', 6) + 'Résultat');
  console.log('-'.repeat(100));
  for (const l of lignes) {
    console.log(pad(l.nom, 44) + pad(l.attendu, 10) + pad(l.obtenu, 10) + pad(l.R + (l.T ? '/-' + l.T : ''), 8) + pad(l.L, 5) + pad(l.final, 6) + statut(l));
  }
  console.log('-'.repeat(100));

  const total = lignes.length;
  const ok = lignes.filter((l) => l.obtenu === l.attendu).length;
  const phishings = lignes.filter((l) => l.attendu === 'phishing');
  const legits = lignes.filter((l) => l.attendu === 'légitime');
  const raterGrave = phishings.filter((l) => l.obtenu === 'légitime').length;
  const alertes = phishings.filter((l) => l.obtenu !== 'légitime').length;
  const fausseAlerte = legits.filter((l) => l.obtenu === 'phishing').length;
  console.log(`Réussite stricte : ${ok}/${total} (${Math.round((100 * ok) / total)} %)`);
  console.log(`Phishing signalés (phishing ou suspect) : ${alertes}/${phishings.length} — phishing classés « légitime » : ${raterGrave}`);
  console.log(`Légitimes classés « phishing » (fausses alertes) : ${fausseAlerte}/${legits.length}`);

  if (process.argv.includes('--detail')) {
    console.log('\nDétail :');
    for (const l of lignes) {
      console.log(`${l.nom}\n   règles : ${l.regles.join(', ') || 'aucune'}\n   LLM (${l.llm ? l.llm.verdict : '-'}) : ${l.llm ? l.llm.indices.join(' | ') : l.erreur}`);
    }
  }

  fs.writeFileSync(path.join(__dirname, `resultats-${NOM_LOT}.json`), JSON.stringify({ date: new Date().toISOString(), hashes, lignes }, null, 2));
  console.log(`
Résultats enregistrés dans resultats-${NOM_LOT}.json`);
})();
