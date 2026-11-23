// Interface : analyse d'un mail (alerte en français d'abord) et gestion du carnet de confiance.
const $ = (id) => document.getElementById(id);
let modele = null;

// Échappe le HTML : le contenu produit par l'IA ou saisi n'est jamais interprété comme du code.
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---------------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------------
function afficherOnglet(nom) {
  for (const n of ['boite', 'analyse', 'carnet']) {
    $('page-' + n).classList.toggle('cache', nom !== n);
    $('onglet-' + n).classList.toggle('actif', nom === n);
  }
  if (nom === 'carnet') chargerCarnet();
}
$('onglet-boite').addEventListener('click', () => afficherOnglet('boite'));
$('onglet-analyse').addEventListener('click', () => afficherOnglet('analyse'));
$('onglet-carnet').addEventListener('click', () => afficherOnglet('carnet'));

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------
async function verifierOllama() {
  const r = await window.api.modeles();
  if (!r.ok) { $('statut').textContent = '🔴 Ollama éteint'; return; }
  modele = r.modeles.includes(r.defaut) ? r.defaut : r.modeles[0];
  $('statut').textContent = modele
    ? `🟢 Ollama connecté — modèle : ${modele}`
    : '🟠 Ollama actif mais aucun modèle installé';
}

// ---------------------------------------------------------------------------
// Résultat d'analyse
// ---------------------------------------------------------------------------
// Phrase d'alerte en français, selon le verdict final.
const TITRES = {
  phishing: '🚫 Ne faites rien : ce mail est très probablement une arnaque',
  suspect: '⚠️ Prudence : vérifiez avant d\'agir',
  'légitime': '✅ Ce mail semble normal',
};

function afficherResultat(res, bloc = $('resultat')) {
  const classe = res.verdict === 'légitime' ? 'legitime' : res.verdict;
  const risques = res.regles.filter((r) => r.type !== 'confiance');
  const rassurantes = res.regles.filter((r) => r.type === 'confiance');
  const rib = res.regles.find((r) => r.id === 'rib_modifie');

  const liste = (rs) => `<ul>${rs.map((r) => `<li>${esc(r.libelle)} <span class="poids">${r.type === 'confiance' ? 'confiance' : 'poids'} ${r.poids}</span><span class="detail">${esc(r.detail)}</span></li>`).join('')}</ul>`;
  const indices = res.llm.indices.length
    ? `<ul>${res.llm.indices.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="petit">Aucun signal particulier.</p>';

  bloc.className = 'resultat ' + classe;
  bloc.style.display = 'block';
  bloc.innerHTML = `
    <p class="alerte">${esc(rib ? rib.libelle : TITRES[res.verdict])}</p>
    ${rib ? `<div class="alerte-rib">${esc(TITRES[res.verdict])}
      <small>Fournisseur : ${esc(rib.donnees.fournisseur)}${rib.donnees.domaineExact ? '' : ' — mais le domaine de l\'expéditeur est une imitation'}</small>
      <small><strong>RIB reçu :</strong> ${esc(rib.donnees.recu)}</small>
      <small><strong>RIB connu :</strong> ${esc(rib.donnees.connus.join(' / '))}</small></div>` : ''}
    ${rassurantes.length ? `<p class="petit">👍 ${esc(rassurantes[0].detail)}</p>` : ''}
    <p class="action"><strong>Que faire ?</strong> ${esc(res.action)}</p>
    <div class="cartes">
      <div class="carte"><h3>Règles détectées (${risques.length})</h3>${risques.length ? liste(risques) : '<p class="petit">Aucune règle déclenchée.</p>'}
        ${rassurantes.length ? `<h3>Règles rassurantes</h3>${liste(rassurantes)}` : ''}</div>
      <div class="carte"><h3>Analyse IA — ${esc(res.llm.verdict)}</h3>${indices}<p class="petit">${esc(res.explication)}</p></div>
    </div>
    <p class="score">Score : ${res.score}/100 (risque règles ${res.scoreRegles}, IA ${res.scoreLLM}, confiance ${res.scoreConfiance}).
      Liens et pièces jointes non analysés : vérifiez avant d'ouvrir.${res.plafonne ? ' Verdict plafonné à « suspect » : domaine du fournisseur connu.' : ''}</p>`;
}

function afficherErreur(r) {
  const bloc = $('resultat');
  bloc.className = 'resultat erreur';
  bloc.style.display = 'block';
  bloc.innerHTML = `<strong>⚠️ ${esc(r.message)}</strong>` +
    (r.brut ? `<h3>Réponse brute du modèle</h3><pre style="white-space:pre-wrap">${esc(r.brut)}</pre>` : '');
}

$('analyser').addEventListener('click', async () => {
  const mail = { expediteur: $('expediteur').value.trim(), objet: $('objet').value.trim(), corps: $('corps').value.trim() };
  if (!mail.corps) { afficherErreur({ message: 'Collez au moins le corps du mail.' }); return; }

  const bouton = $('analyser');
  bouton.disabled = true;
  bouton.textContent = 'Analyse en cours…';
  const r = await window.api.analyser(mail, modele || undefined);
  bouton.disabled = false;
  bouton.textContent = 'Analyser';

  if (r.ok) afficherResultat(r.resultat); else afficherErreur(r);
  verifierOllama();
});

// ---------------------------------------------------------------------------
// Carnet de confiance
// ---------------------------------------------------------------------------
function afficherCarnet(carnet) {
  const puce = (nom, type, valeur) =>
    `<span class="puce">${esc(valeur)}<button title="Supprimer" data-nom="${esc(nom)}" data-type="${type}" data-valeur="${esc(valeur)}">×</button></span>`;
  $('carnet-lignes').innerHTML = carnet.fournisseurs.length
    ? carnet.fournisseurs.map((f) => `<tr>
        <td><strong>${esc(f.nom)}</strong></td>
        <td>${f.domaines.map((d) => puce(f.nom, 'domaine', d)).join('') || '—'}</td>
        <td>${f.ribs.map((r) => puce(f.nom, 'rib', r)).join('') || '—'}</td>
        <td><button class="supprimer" title="Supprimer ce fournisseur" data-nom="${esc(f.nom)}" data-type="tout" data-valeur="">🗑</button></td></tr>`).join('')
    : '<tr><td colspan="4">Carnet vide.</td></tr>';
}

async function chargerCarnet() { afficherCarnet(await window.api.carnetLire()); }

$('carnet-lignes').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.type === 'tout' && !confirm(`Supprimer « ${b.dataset.nom} » du carnet ?`)) return;
  const r = await window.api.carnetSupprimer(b.dataset.nom, b.dataset.type, b.dataset.valeur);
  afficherCarnet(r.carnet);
});

$('c-ajouter').addEventListener('click', async () => {
  const r = await window.api.carnetAjouter({ nom: $('c-nom').value, domaine: $('c-domaine').value, iban: $('c-iban').value });
  $('msg-carnet').textContent = r.ok ? '' : r.message;
  if (r.ok) {
    afficherCarnet(r.carnet);
    $('c-domaine').value = ''; $('c-iban').value = '';
  }
});

// ---------------------------------------------------------------------------
// Boîte de réception simulée
// ---------------------------------------------------------------------------
let boite = { mails: [], envoyes: [] };
let vue = 'recus';          // 'recus' | 'envoyes'
let selection = null;       // id du mail ouvert
let cleDetail = '';         // pour ne redessiner le détail que si l'analyse a changé

// Alerte courte et couleur pour la liste.
function resume(mail) {
  if (mail.etat === 'en_attente') return { classe: 'attente', texte: 'Analyse en cours…' };
  if (mail.etat === 'erreur') return { classe: 'erreur', texte: 'Analyse impossible' };
  const a = mail.analyse;
  const classe = a.verdict === 'légitime' ? 'legitime' : a.verdict;
  if (a.ribModifie && a.verdict !== 'légitime') return { classe, texte: 'RIB modifié : à vérifier' };
  return { classe, texte: { phishing: 'Arnaque probable', suspect: 'À vérifier', 'légitime': 'Mail normal' }[a.verdict] };
}

// Nom affiché de l'expéditeur (sans l'adresse).
const nomExp = (s) => (s.match(/^(.*?)\s*</) || [, s])[1].replace(/"/g, '') || s;
const heure = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function dessinerListe() {
  $('b-recus').textContent = `Reçus (${boite.mails.length})`;
  $('b-envoyes').textContent = `Envoyés (${boite.envoyes.length})`;
  $('b-recus').classList.toggle('actif', vue === 'recus');
  $('b-envoyes').classList.toggle('actif', vue === 'envoyes');
  const c = $('liste-mails');
  if (vue === 'recus') {
    c.innerHTML = boite.mails.length ? boite.mails.map((m) => {
      const s = resume(m);
      return `<div class="item ${m.lu ? '' : 'nonlu'} ${m.id === selection ? 'sel' : ''}" data-id="${esc(m.id)}">
        <div class="pastille p-${s.classe}"></div>
        <div><div class="exp">${esc(nomExp(m.expediteur))} <span class="petit">${heure(m.recu)}</span></div>
        <div class="obj">${esc(m.objet)}</div><div class="court c-${s.classe}">${esc(s.texte)}</div></div></div>`;
    }).join('') : '<p class="petit" style="padding:14px">Boîte vide. Cliquez sur « Démo : recevoir 10 mails ».</p>';
  } else {
    c.innerHTML = boite.envoyes.length ? boite.envoyes.map((e) => `<div class="item ${e.id === selection ? 'sel' : ''}" data-id="${esc(e.id)}">
        <div class="pastille" style="background:#2563eb"></div>
        <div><div class="exp">À : ${esc(nomExp(e.a))} <span class="petit">${heure(e.date)}</span></div><div class="obj">${esc(e.objet)}</div></div></div>`).join('')
      : '<p class="petit" style="padding:14px">Aucun mail envoyé.</p>';
  }
}

// Détail d'un mail reçu : alerte, RIB reçu / connu, signaux, action (via afficherResultat), puis le mail.
function dessinerDetail() {
  const L = $('lecture');
  if (vue === 'envoyes') {
    const e = boite.envoyes.find((x) => x.id === selection);
    L.innerHTML = e ? `<div class="mail-entete"><h2>${esc(e.objet)}</h2>À : ${esc(e.a)} — ${new Date(e.date).toLocaleString('fr-FR')}<br>
      <span class="petit">Enregistré dans le dossier « Envoyes » de l'application. Rien n'a été envoyé.</span></div><div class="mail-corps">${esc(e.corps)}</div>`
      : '<p class="vide">Sélectionnez un mail envoyé.</p>';
    return;
  }
  const m = boite.mails.find((x) => x.id === selection);
  if (!m) { L.innerHTML = '<p class="vide">Sélectionnez un mail.</p>'; return; }
  cleDetail = m.id + m.etat;

  L.innerHTML = `
    <div id="d-analyse" class="resultat"></div>
    <div class="mail-entete" style="margin-top:16px"><h2>${esc(m.objet)}</h2>De : ${esc(m.expediteur)} — ${new Date(m.recu).toLocaleString('fr-FR')}</div>
    <div class="mail-corps">${esc(m.corps)}</div>
    <div class="barre"><button id="d-repondre">↩ Répondre</button></div>
    <div id="d-zone"></div>`;

  const zone = $('d-analyse');
  if (m.etat === 'analyse') afficherResultat(m.analyse, zone);
  else if (m.etat === 'erreur') {
    zone.className = 'resultat erreur'; zone.style.display = 'block';
    zone.innerHTML = `<strong>⚠️ Analyse impossible : ${esc(m.analyse && m.analyse.erreur)}</strong><br><button id="d-reanalyser">Réessayer</button>`;
    $('d-reanalyser').addEventListener('click', () => window.api.boiteReanalyser(m.id));
  } else {
    zone.className = 'resultat'; zone.style.display = 'block'; zone.style.borderColor = '#94a3b8';
    zone.innerHTML = '<p class="alerte" style="color:#64748b">⏳ Analyse en cours…</p>';
  }
  $('d-repondre').addEventListener('click', () => ouvrirReponse(m));
}

// Réponse : avertissement avant de répondre à un mail jugé phishing (ou suspect).
function ouvrirReponse(m) {
  const verdict = m.etat === 'analyse' ? m.analyse.verdict : null;
  const zone = $('d-zone');
  const formulaire = () => {
    zone.innerHTML = `<div class="reponse"><label>Votre réponse à ${esc(nomExp(m.expediteur))}</label><textarea id="r-texte"></textarea>
      <div class="barre"><button id="r-envoyer">Enregistrer dans « Envoyés »</button><button id="r-annuler" class="gris">Annuler</button></div>
      <p class="petit">Simulation : le message est écrit dans un dossier local, rien ne part.</p></div>`;
    $('r-annuler').addEventListener('click', () => { zone.innerHTML = ''; });
    $('r-envoyer').addEventListener('click', async () => {
      const r = await window.api.boiteRepondre(m.id, $('r-texte').value);
      zone.innerHTML = r.ok ? '<p class="petit">✅ Réponse enregistrée dans « Envoyés » (rien n\'est parti).</p>' : `<p class="petit">${esc(r.message)}</p>`;
    });
  };
  if (verdict === 'phishing' || verdict === 'suspect') {
    const fort = verdict === 'phishing';
    zone.innerHTML = `<div class="avertissement"><strong>${fort ? '🚫 Ce mail est probablement une arnaque.' : '⚠️ Ce mail est suspect.'}</strong>
      Ne confirmez aucun paiement ni changement de RIB par retour de mail : appelez l'expéditeur au numéro habituel.
      <br><button id="a-continuer" class="${fort ? 'rouge' : 'gris'}">Répondre quand même</button><button id="a-annuler" class="gris">Annuler</button></div>`;
    $('a-annuler').addEventListener('click', () => { zone.innerHTML = ''; });
    $('a-continuer').addEventListener('click', formulaire);
  } else if (m.etat !== 'analyse') {
    zone.innerHTML = '<div class="avertissement">L\'analyse de ce mail n\'est pas terminée : attendez le résultat avant de répondre. <button id="a-annuler" class="gris">OK</button></div>';
    $('a-annuler').addEventListener('click', () => { zone.innerHTML = ''; });
  } else formulaire();
}

$('liste-mails').addEventListener('click', (e) => {
  const it = e.target.closest('.item');
  if (!it) return;
  selection = it.dataset.id;
  if (vue === 'recus') window.api.boiteLu(selection);
  dessinerListe(); dessinerDetail();
});
$('b-recus').addEventListener('click', () => { vue = 'recus'; selection = null; dessinerListe(); dessinerDetail(); });
$('b-envoyes').addEventListener('click', () => { vue = 'envoyes'; selection = null; dessinerListe(); dessinerDetail(); });
$('b-demo').addEventListener('click', async () => {
  vue = 'recus';
  const r = await window.api.boiteDemo();
  if (!r.ok) alert(r.message);
});
$('b-vider').addEventListener('click', async () => { if (confirm('Vider la boîte de réception ?')) { selection = null; await window.api.boiteVider(); } });

// Mise à jour en direct : nouveau mail ou analyse terminée.
function appliquerBoite(b) {
  boite = b;
  dessinerListe();
  const m = boite.mails.find((x) => x.id === selection);
  // On ne redessine le détail que si l'analyse du mail ouvert a changé (pour garder la réponse en cours de saisie).
  if (vue === 'recus' && m && cleDetail !== m.id + m.etat) dessinerDetail();
  if (vue === 'recus' && !m && selection) { selection = null; dessinerDetail(); }
}
window.api.onBoiteMaj(appliquerBoite);
window.api.boiteLire().then(appliquerBoite);

verifierOllama();
setInterval(verifierOllama, 10000);   // le voyant suit l'état d'Ollama (démarrage tardif, arrêt)
