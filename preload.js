// Pont sécurisé entre l'interface et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  modeles: () => ipcRenderer.invoke('modeles'),
  analyser: (mail, modele) => ipcRenderer.invoke('analyser', mail, modele),
  boiteLire: () => ipcRenderer.invoke('boite:lire'),
  boiteRecevoir: (donnees) => ipcRenderer.invoke('boite:recevoir', donnees),
  boiteLu: (id) => ipcRenderer.invoke('boite:lu', id),
  boiteReanalyser: (id) => ipcRenderer.invoke('boite:reanalyser', id),
  boiteVider: () => ipcRenderer.invoke('boite:vider'),
  boiteDemo: () => ipcRenderer.invoke('boite:demo'),
  boiteRepondre: (id, texte) => ipcRenderer.invoke('boite:repondre', id, texte),
  // L'interface est prévenue à chaque changement de la boîte (nouveau mail, analyse terminée)
  onBoiteMaj: (rappel) => ipcRenderer.on('boite:maj', (_e, boite) => rappel(boite)),
  carnetLire: () => ipcRenderer.invoke('carnet:lire'),
  carnetAjouter: (entree) => ipcRenderer.invoke('carnet:ajouter', entree),
  carnetSupprimer: (nom, type, valeur) => ipcRenderer.invoke('carnet:supprimer', nom, type, valeur),
});
