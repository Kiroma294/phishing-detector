// Processus principal Electron : crée la fenêtre et relaie les analyses vers Ollama.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chargerCarnet, sauverCarnet, ajouterEntree, supprimerEntree } = require('./carnet');
const { listerModeles, analyserMail, MODELE_PAR_DEFAUT } = require('./analyse');
const { chargerBoite, sauverBoite, creerMail, mailsDemo } = require('./boite');

let fenetrePrincipale = null;

function creerFenetre() {
  const fenetre = new BrowserWindow({
    width: 980,
    height: 780,
    title: 'Détecteur de phishing',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // l'interface n'a pas accès à Node
      nodeIntegration: false,
    },
  });
  fenetre.setMenuBarVisibility(false);
  fenetre.loadFile('index.html');
  fenetrePrincipale = fenetre;
}

app.whenReady().then(() => {
  // Garde-fou : on bloque toute requête qui ne vise pas la machine locale ou un fichier de l'app.
  session.defaultSession.webRequest.onBeforeRequest((details, rappel) => {
    const url = new URL(details.url);
    const local = ['file:', 'devtools:', 'chrome-extension:'].includes(url.protocol) ||
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    rappel({ cancel: !local });
  });

  // Canaux de communication avec l'interface
  ipcMain.handle('modeles', async () => {
    try { return { ok: true, modeles: await listerModeles(), defaut: MODELE_PAR_DEFAUT }; }
    catch (e) { return { ok: false, code: e.code, message: e.message }; }
  });

  // Carnet de confiance : fichier JSON local dans le dossier de données de l'application.
  // Premier lancement : on le remplit avec le carnet de démonstration.
  const fichierCarnet = path.join(app.getPath('userData'), 'carnet.json');
  if (!fs.existsSync(fichierCarnet)) {
    sauverCarnet(fichierCarnet, chargerCarnet(path.join(__dirname, 'carnet-demo.json')));
  }

  ipcMain.handle('analyser', async (_evt, mail, modele) => {
    try { return { ok: true, resultat: await analyserMail(mail, modele, chargerCarnet(fichierCarnet)) }; }
    catch (e) { return { ok: false, code: e.code || 'INCONNU', message: e.message, brut: e.brut }; }
  });

  ipcMain.handle('carnet:lire', () => chargerCarnet(fichierCarnet));
  ipcMain.handle('carnet:ajouter', (_evt, entree) => {
    try {
      const c = ajouterEntree(chargerCarnet(fichierCarnet), entree);
      sauverCarnet(fichierCarnet, c);
      return { ok: true, carnet: c };
    } catch (e) { return { ok: false, message: e.message }; }
  });
  ipcMain.handle('carnet:supprimer', (_evt, nom, type, valeur) => {
    const c = supprimerEntree(chargerCarnet(fichierCarnet), nom, type, valeur);
    sauverCarnet(fichierCarnet, c);
    return { ok: true, carnet: c };
  });

  // -------------------------------------------------------------------------
  // Boîte de réception simulée (fichier JSON local) + analyse automatique en tâche de fond
  // -------------------------------------------------------------------------
  const fichierBoite = path.join(app.getPath('userData'), 'boite.json');
  const dossierEnvoyes = path.join(app.getPath('userData'), 'Envoyes');
  let boite = chargerBoite(fichierBoite);

  // Enregistre la boîte et prévient l'interface (elle se rafraîchit toute seule).
  function publier() {
    sauverBoite(fichierBoite, boite);
    if (fenetrePrincipale && !fenetrePrincipale.isDestroyed()) fenetrePrincipale.webContents.send('boite:maj', boite);
  }

  // File d'attente : un seul mail analysé à la fois (Ollama traite une requête après l'autre).
  const file = [];
  let enCours = false;
  async function traiterFile() {
    if (enCours) return;
    enCours = true;
    while (file.length) {
      const id = file.shift();
      const mail = boite.mails.find((x) => x.id === id);
      if (!mail) continue;
      try {
        mail.analyse = await analyserMail(mail, undefined, chargerCarnet(fichierCarnet));
        mail.etat = 'analyse';
      } catch (e) {
        mail.etat = 'erreur';
        mail.analyse = { erreur: e.message };
      }
      publier();
    }
    enCours = false;
  }
  function planifierAnalyse(mail) { mail.etat = 'en_attente'; file.push(mail.id); traiterFile(); }

  // Mails restés « en attente » lors d'un précédent lancement : on les analyse au démarrage.
  boite.mails.filter((x) => x.etat === 'en_attente').forEach((x) => file.push(x.id));
  traiterFile();

  function recevoir(donnees) {
    const mail = creerMail(donnees);
    boite.mails.unshift(mail);   // le plus récent en haut
    publier();
    planifierAnalyse(mail);
  }

  ipcMain.handle('boite:lire', () => boite);
  ipcMain.handle('boite:recevoir', (_evt, donnees) => { recevoir(donnees); return { ok: true }; });
  ipcMain.handle('boite:lu', (_evt, id) => {
    const mail = boite.mails.find((x) => x.id === id);
    if (mail && !mail.lu) { mail.lu = true; publier(); }
    return { ok: true };
  });
  ipcMain.handle('boite:reanalyser', (_evt, id) => {
    const mail = boite.mails.find((x) => x.id === id);
    if (mail) { mail.analyse = null; planifierAnalyse(mail); publier(); }
    return { ok: true };
  });
  ipcMain.handle('boite:vider', () => { boite = { mails: [], envoyes: boite.envoyes }; file.length = 0; publier(); return { ok: true }; });

  // Démo : 10 mails du 2e lot aveugle, un toutes les 4 secondes.
  let demoEnCours = false;
  ipcMain.handle('boite:demo', () => {
    if (demoEnCours) return { ok: false, message: 'La démo est déjà en cours.' };
    let lot;
    try { lot = mailsDemo(path.join(__dirname, 'mails-aveugles-2')); }
    catch (e) { return { ok: false, message: 'Dossier mails-aveugles-2 introuvable.' }; }
    demoEnCours = true;
    lot.forEach((donnees, i) => {
      setTimeout(() => {
        recevoir(donnees);
        if (i === lot.length - 1) demoEnCours = false;
      }, i * 4000);
    });
    return { ok: true, total: lot.length };
  });

  // Réponse : écrite dans le dossier « Envoyes » local. Rien n'est envoyé nulle part.
  ipcMain.handle('boite:repondre', (_evt, id, texte) => {
    const mail = boite.mails.find((x) => x.id === id);
    if (!mail) return { ok: false, message: 'Mail introuvable.' };
    const envoi = {
      id: `env-${Date.now()}`, a: mail.expediteur, objet: `Re: ${mail.objet}`.replace(/^Re: Re: /, 'Re: '),
      corps: String(texte || ''), date: new Date().toISOString(), enReponseA: mail.id,
    };
    fs.mkdirSync(dossierEnvoyes, { recursive: true });
    const fichier = path.join(dossierEnvoyes, `${envoi.date.replace(/[:.]/g, '-')}.txt`);
    fs.writeFileSync(fichier, `A: ${envoi.a}\nObjet: ${envoi.objet}\nDate: ${envoi.date}\n\n${envoi.corps}\n`, 'utf8');
    boite.envoyes.unshift(envoi);
    publier();
    return { ok: true, fichier };
  });

  // Démarrage d'Ollama : si le serveur local ne répond pas, on le lance (ollama serve, en arrière-plan,
  // en local uniquement). Une fois prêt, les mails dont l'analyse avait échoué sont ré-analysés.
  (async () => {
    const repond = async () => { try { await listerModeles(); return true; } catch (_) { return false; } };
    if (!(await repond())) {
      const exe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
      try {
        const enfant = spawn(fs.existsSync(exe) ? exe : 'ollama', ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
        enfant.on('error', () => {});   // Ollama introuvable : l'interface affichera « Ollama éteint »
        enfant.unref();
      } catch (_) { /* rien */ }
      for (let i = 0; i < 30 && !(await repond()); i++) await new Promise((r) => setTimeout(r, 1000));
    }
    if (await repond()) {
      boite.mails.filter((x) => x.etat === 'erreur').forEach((x) => planifierAnalyse(x));
      publier();
    }
  })();

  creerFenetre();
});

app.on('window-all-closed', () => app.quit());
