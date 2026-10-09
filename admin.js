'use strict';
/* Espace privé : ajoute, modifie et supprime des couteaux en écrivant dans le dépôt GitHub.
   Le jeton d'accès reste dans ce navigateur et n'est envoyé qu'à api.github.com. */
(() => {
  const $ = (sel, racine = document) => racine.querySelector(sel);

  const FICHIER_COUTEAUX = 'data/knives.json';
  const FICHIER_SITE = 'data/site.json';
  const CLE_STOCKAGE = 'thallions-connexion';
  const MAX_PHOTOS = 3;
  const LIEN_OK = /^https:\/\/[^\s"'<>]+$/;
  const LIBELLES = { disponible: 'Disponible', reserve: 'Réservé', vendu: 'Vendu' };

  let cfg = null;
  let couteaux = [];
  let site = {};
  let enEdition = null;
  let existantes = [];
  let aRetirer = [];
  let nouvelles = [];
  let comptes = {};

  /* ---------- Utilitaires ---------- */

  function el(tag, props, ...enfants) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else n.setAttribute(k, v);
      }
    }
    for (const e of enfants) if (e != null) n.append(e);
    return n;
  }

  function dire(noeud, texte, erreur = false) {
    noeud.textContent = texte;
    noeud.classList.toggle('erreur', erreur);
  }

  function octetsVersBase64(octets) {
    let s = '';
    const pas = 0x8000;
    for (let i = 0; i < octets.length; i += pas) s += String.fromCharCode.apply(null, octets.subarray(i, i + pas));
    return btoa(s);
  }
  const texteVersBase64 = (t) => octetsVersBase64(new TextEncoder().encode(t));
  function base64VersTexte(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  function slug(t) {
    return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'couteau';
  }

  function prixTexte(p) {
    return typeof p === 'number' && p > 0 ? `${p.toLocaleString('fr-FR')} €` : 'Prix sur demande';
  }

  /* ---------- API GitHub ---------- */

  async function gh(methode, chemin, corps) {
    const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/${chemin}`;
    const entetes = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (corps) entetes['Content-Type'] = 'application/json';
    let r;
    try {
      r = await fetch(url, { method: methode, cache: 'no-store', headers: entetes, body: corps ? JSON.stringify(corps) : undefined });
    } catch (e) {
      throw Object.assign(new Error('Connexion impossible. Vérifiez votre accès Internet.'), { status: 0 });
    }
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.json()).message || ''; } catch (e) { /* sans détail */ }
      let texte = `Erreur GitHub (${r.status}). ${detail}`;
      if (r.status === 401) texte = 'Jeton refusé ou expiré. Créez-en un nouveau et reconnectez-vous.';
      if (r.status === 403 || r.status === 404) texte = 'Accès refusé ou dépôt introuvable. Vérifiez le compte, le nom du dépôt et les droits du jeton (Contents : lecture et écriture).';
      throw Object.assign(new Error(texte), { status: r.status });
    }
    return r.status === 204 ? null : r.json();
  }

  async function lire(chemin) {
    try {
      const f = await gh('GET', `contents/${chemin}?ref=${encodeURIComponent(cfg.branch)}`);
      return { sha: f.sha, texte: base64VersTexte(f.content) };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async function ecrire(chemin, base64, message, sha) {
    const corps = { message, content: base64, branch: cfg.branch };
    if (sha) corps.sha = sha;
    return gh('PUT', `contents/${chemin}`, corps);
  }

  async function supprimerFichier(chemin) {
    const f = await gh('GET', `contents/${chemin}?ref=${encodeURIComponent(cfg.branch)}`);
    await gh('DELETE', `contents/${chemin}`, { message: `Suppression de ${chemin}`, sha: f.sha, branch: cfg.branch });
  }

  /* Relit toujours la dernière version du fichier avant d'y écrire, pour ne rien écraser. */
  async function modifierJSON(chemin, defaut, mutateur, message) {
    for (let essai = 0; essai < 3; essai++) {
      const f = await lire(chemin);
      const donnees = f ? JSON.parse(f.texte) : defaut;
      const resultat = mutateur(donnees);
      try {
        await ecrire(chemin, texteVersBase64(JSON.stringify(resultat, null, 2) + '\n'), message, f && f.sha);
        return resultat;
      } catch (e) {
        if (essai === 2 || (e.status !== 409 && e.status !== 422)) throw e;
      }
    }
  }

  async function preparerImage(fichier) {
    let bmp;
    try {
      bmp = await createImageBitmap(fichier, { imageOrientation: 'from-image' });
    } catch (e) {
      throw new Error(`La photo « ${fichier.name} » n'est pas dans un format pris en charge. Utilisez un JPEG ou un PNG.`);
    }
    const max = 1600;
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    if (bmp.close) bmp.close();
    return canvas.toDataURL('image/jpeg', 0.86).split(',')[1];
  }

  /* ---------- Compteurs de visites (GoatCounter) ---------- */

  function codeCompteur() {
    const c = site && site.compteur;
    return typeof c === 'string' && /^[a-z0-9-]{2,40}$/.test(c) ? c : '';
  }

  /* Renvoie le nombre affiché par GoatCounter, '0' si rien n'est encore compté, ou null si illisible. */
  async function lireCompteur(chemin) {
    const code = codeCompteur();
    if (!code) return null;
    try {
      const r = await fetch(`https://${code}.goatcounter.com/counter/${encodeURIComponent(chemin)}.json`, { cache: 'no-store' });
      if (r.status === 404) return '0';
      if (!r.ok) return null;
      const d = await r.json();
      return String(d.count).replace(/\s/g, '\u202f');
    } catch (e) { return null; }
  }

  function texteVues(id) {
    if (!codeCompteur()) return '';
    const v = comptes[id];
    if (v === undefined) return '…';
    return v === null ? 'n/d' : `${v} ${v === '1' ? 'vue' : 'vues'}`;
  }

  async function majCompteurs() {
    const total = $('#stat-total');
    const note = $('#stat-note');
    if (!codeCompteur()) {
      total.textContent = '–';
      note.textContent = 'Compteur non activé. Créez un compte gratuit sur goatcounter.com, puis indiquez son code dans « Textes du site ».';
      return;
    }
    note.textContent = '';
    const [t, ...autres] = await Promise.all([
      lireCompteur('/visite'),
      ...couteaux.map((c) => lireCompteur('/couteau/' + c.id)),
    ]);
    total.textContent = t === null ? 'n/d' : t;
    couteaux.forEach((c, i) => { comptes[c.id] = autres[i]; });
    document.querySelectorAll('.vues').forEach((n) => { n.textContent = texteVues(n.dataset.id); });
    if (t === null) {
      note.textContent = 'Compteur illisible. Vérifiez le code, et dans GoatCounter (Settings) l\'option « Allow adding visitor counts on your website ».';
    } else {
      note.textContent = 'Visites depuis le début. Vos propres visites, faites depuis un appareil où vous vous êtes connecté ici, ne sont pas comptées. Les visiteurs qui bloquent les traceurs ne le sont pas non plus : ce sont donc des chiffres minimaux.';
    }
  }

  /* ---------- Photos de l'atelier ---------- */

  function listeAtelier() {
    return Array.isArray(site.atelierPhotos) ? site.atelierPhotos : [];
  }

  function afficherAtelier() {
    const ul = $('#atelier-liste');
    ul.replaceChildren();
    const photos = listeAtelier();
    if (!photos.length) {
      ul.append(el('li', { class: 'vide-liste', text: 'Aucune photo pour le moment.' }));
      return;
    }
    photos.forEach((p, i) => {
      const img = el('img', { src: p, alt: `Photo ${i + 1} de l'atelier` });
      img.addEventListener('error', () => { img.alt = 'En cours de publication…'; });
      const rangee = el('div', { class: 'rangee' });
      if (i > 0) {
        const av = el('button', { type: 'button', text: 'Avancer' });
        av.addEventListener('click', () => deplacerAtelier(i, -1));
        rangee.append(av);
      }
      if (i < photos.length - 1) {
        const re = el('button', { type: 'button', text: 'Reculer' });
        re.addEventListener('click', () => deplacerAtelier(i, 1));
        rangee.append(re);
      }
      const ret = el('button', { type: 'button', text: 'Retirer' });
      ret.addEventListener('click', () => retirerAtelier(p));
      rangee.append(ret);
      ul.append(el('li', null, img, rangee));
    });
  }

  async function sauverAtelier(mutateur, message) {
    site = await modifierJSON(FICHIER_SITE, {}, (d) => { d.atelierPhotos = mutateur(Array.isArray(d.atelierPhotos) ? d.atelierPhotos : []); return d; }, message);
    afficherAtelier();
  }

  function deplacerAtelier(i, sens) {
    return action('Réorganisation', () => sauverAtelier((l) => {
      const j = i + sens;
      if (j < 0 || j >= l.length) return l;
      [l[i], l[j]] = [l[j], l[i]];
      return l;
    }, 'Atelier : ordre des photos'));
  }

  function retirerAtelier(chemin) {
    if (!window.confirm('Retirer cette photo de l\'atelier ?')) return;
    return action('Suppression', async () => {
      await sauverAtelier((l) => l.filter((x) => x !== chemin), 'Atelier : photo retirée');
      try { await supprimerFichier(chemin); } catch (e) { /* photo déjà absente */ }
    });
  }

  async function ajouterAtelier(fichiers) {
    const zone = $('#statut-global');
    const images = fichiers.filter((f) => f.type.startsWith('image/'));
    $('#atelier-fichiers').value = '';
    if (!images.length) return;
    const ajoutes = [];
    try {
      for (let i = 0; i < images.length; i++) {
        dire(zone, `Envoi de la photo ${i + 1} sur ${images.length}…`);
        const b64 = await preparerImage(images[i]);
        const chemin = `images/atelier/atelier-${Date.now().toString(36)}${i}.jpg`;
        await ecrire(chemin, b64, 'Atelier : nouvelle photo');
        ajoutes.push(chemin);
      }
      await sauverAtelier((l) => l.concat(ajoutes), `Atelier : ${ajoutes.length} photo(s) ajoutée(s)`);
      dire(zone, 'Enregistré. Les photos apparaissent sur le site dans environ une minute.');
    } catch (e) {
      if (ajoutes.length) { try { await sauverAtelier((l) => l.concat(ajoutes), 'Atelier : photos ajoutées'); } catch (e2) { /* rien */ } }
      dire(zone, e.message, true);
    }
  }

  /* ---------- Connexion ---------- */

  function stockage() {
    return localStorage.getItem(CLE_STOCKAGE) ? localStorage : sessionStorage;
  }

  function lireConnexion() {
    try {
      const brut = localStorage.getItem(CLE_STOCKAGE) || sessionStorage.getItem(CLE_STOCKAGE);
      return brut ? JSON.parse(brut) : null;
    } catch (e) { return null; }
  }

  function oublierConnexion() {
    try { localStorage.removeItem(CLE_STOCKAGE); sessionStorage.removeItem(CLE_STOCKAGE); } catch (e) { /* rien */ }
  }

  async function seConnecter(connexion, souvenir) {
    const msg = $('#msg-connexion');
    dire(msg, 'Connexion en cours…');
    cfg = connexion;
    try {
      await rafraichir();
      site = JSON.parse((await lire(FICHIER_SITE) || { texte: '{}' }).texte);
    } catch (e) {
      cfg = null;
      dire(msg, e.message, true);
      return;
    }
    try {
      oublierConnexion();
      (souvenir ? localStorage : sessionStorage).setItem(CLE_STOCKAGE, JSON.stringify(connexion));
    } catch (e) { /* stockage indisponible : la connexion reste valable pour cette session */ }
    try { localStorage.setItem('thallions-proprio', '1'); } catch (e) { /* rien */ }
    $('#f-connexion').token.value = '';
    $('#connexion').hidden = true;
    $('#espace').hidden = false;
    $('#deco').hidden = false;
    remplirTextes();
    afficherAtelier();
    majCompteurs();
    dire(msg, '');
  }

  /* ---------- Liste des couteaux ---------- */

  async function rafraichir() {
    const f = await lire(FICHIER_COUTEAUX);
    const donnees = f ? JSON.parse(f.texte) : { couteaux: [] };
    couteaux = Array.isArray(donnees.couteaux) ? donnees.couteaux : [];
    afficherListe();
  }

  function afficherListe() {
    const ul = $('#liste');
    ul.replaceChildren();
    if (!couteaux.length) {
      ul.append(el('li', { class: 'vide-liste', text: 'Aucun couteau pour le moment. Ajoutez le premier avec le bouton ci-dessus.' }));
      return;
    }
    couteaux.forEach((c) => {
      const photo = (c.photos || [])[0];
      const vignette = photo
        ? el('img', { class: 'mini-photo', src: photo, alt: '' })
        : el('div', { class: 'mini-photo sans', text: 'Sans photo' });
      if (photo) vignette.addEventListener('error', () => vignette.replaceWith(el('div', { class: 'mini-photo sans', text: 'En cours' })));

      const vendu = c.statut === 'vendu';
      const boutons = el('div', { class: 'boutons' });
      const modifier = el('button', { type: 'button', class: 'bouton secondaire petit', text: 'Modifier' });
      const basculer = el('button', { type: 'button', class: 'bouton secondaire petit', text: vendu ? 'Remettre en vente' : 'Marquer vendu' });
      const suppr = el('button', { type: 'button', class: 'bouton danger petit', text: 'Supprimer' });
      modifier.addEventListener('click', () => ouvrirEditeur(c));
      basculer.addEventListener('click', () => changerStatut(c, vendu ? 'disponible' : 'vendu'));
      suppr.addEventListener('click', () => supprimerCouteau(c));
      boutons.append(modifier, basculer, suppr);

      const vues = el('span', { class: 'vues', 'data-id': c.id || '', text: texteVues(c.id) });
      ul.append(el('li', null,
        el('div', { class: 'vignette-col' }, vignette, vues),
        el('div', null,
          el('div', { class: 'nom-ligne', text: c.nom || 'Sans nom' }),
          el('div', { class: 'meta', text: `${LIBELLES[c.statut] || 'Disponible'} · ${prixTexte(c.prix)}` }),
          boutons)));
    });
  }

  async function action(libelle, tache) {
    const zone = $('#statut-global');
    dire(zone, `${libelle}…`);
    try {
      await tache();
      await rafraichir();
      majCompteurs();
      dire(zone, 'Enregistré. Le site se met à jour dans environ une minute.');
    } catch (e) {
      dire(zone, e.message, true);
    }
  }

  function changerStatut(c, statut) {
    return action('Mise à jour', () => modifierJSON(FICHIER_COUTEAUX, { couteaux: [] }, (d) => {
      const x = (d.couteaux || []).find((k) => k.id === c.id);
      if (x) x.statut = statut;
      return d;
    }, `Statut de « ${c.nom} » : ${LIBELLES[statut]}`));
  }

  function supprimerCouteau(c) {
    if (!window.confirm(`Supprimer « ${c.nom} » et ses photos ? Cette action est définitive.`)) return;
    return action('Suppression', async () => {
      await modifierJSON(FICHIER_COUTEAUX, { couteaux: [] }, (d) => {
        d.couteaux = (d.couteaux || []).filter((k) => k.id !== c.id);
        return d;
      }, `Suppression de « ${c.nom} »`);
      for (const p of c.photos || []) {
        try { await supprimerFichier(p); } catch (e) { /* photo déjà absente */ }
      }
    });
  }

  /* ---------- Éditeur de fiche ---------- */

  function ouvrirEditeur(c) {
    enEdition = c || null;
    existantes = c ? [...(c.photos || [])] : [];
    aRetirer = [];
    nouvelles.forEach((n) => URL.revokeObjectURL(n.url));
    nouvelles = [];
    const f = $('#f-couteau');
    f.reset();
    $('#editeur-titre').textContent = c ? 'Modifier le couteau' : 'Ajouter un couteau';
    if (c) {
      f.elements.nom.value = c.nom || '';
      f.elements.prix.value = c.prix || '';
      f.elements.statut.value = c.statut || 'disponible';
      f.elements.longueur.value = c.longueur || '';
      f.elements.manche.value = c.manche || '';
      f.elements.lame.value = c.lame || '';
      f.elements.description.value = c.description || '';
      f.elements.lien.value = c.lienAchat || '';
    }
    dire($('#msg-editeur'), '');
    $('#enregistrer').disabled = false;
    afficherPhotos();
    $('#editeur').showModal();
  }

  function afficherPhotos() {
    const ul = $('#photos-liste');
    ul.replaceChildren();
    existantes.forEach((p, i) => {
      const rangee = el('div', { class: 'rangee' });
      if (i > 0) {
        const premier = el('button', { type: 'button', text: 'En premier' });
        premier.addEventListener('click', () => { existantes.splice(i, 1); existantes.unshift(p); afficherPhotos(); });
        rangee.append(premier);
      }
      const retirer = el('button', { type: 'button', text: 'Retirer' });
      retirer.addEventListener('click', () => { existantes.splice(i, 1); aRetirer.push(p); afficherPhotos(); });
      rangee.append(retirer);
      ul.append(el('li', null, el('img', { src: p, alt: `Photo ${i + 1}` }), rangee));
    });
    nouvelles.forEach((n, i) => {
      const retirer = el('button', { type: 'button', text: 'Retirer' });
      retirer.addEventListener('click', () => { URL.revokeObjectURL(n.url); nouvelles.splice(i, 1); afficherPhotos(); });
      ul.append(el('li', null, el('img', { src: n.url, alt: `Nouvelle photo ${i + 1}` }), el('div', { class: 'rangee' }, retirer)));
    });
  }

  function ajouterFichiers(liste) {
    const msg = $('#msg-editeur');
    for (const fichier of liste) {
      if (existantes.length + nouvelles.length >= MAX_PHOTOS) {
        dire(msg, `${MAX_PHOTOS} photos au maximum par couteau : retirez-en une pour en ajouter une autre.`, true);
        break;
      }
      if (!fichier.type.startsWith('image/')) continue;
      nouvelles.push({ file: fichier, url: URL.createObjectURL(fichier) });
    }
    $('#photos-fichiers').value = '';
    afficherPhotos();
  }

  async function enregistrerCouteau(e) {
    e.preventDefault();
    const f = e.target;
    const msg = $('#msg-editeur');
    const nom = f.elements.nom.value.trim();
    if (!nom) { dire(msg, 'Indiquez le nom du couteau.', true); return; }

    if (existantes.length + nouvelles.length < 1) { dire(msg, 'Ajoutez au moins une photo (jusqu\'à 3).', true); return; }

    const prixBrut = parseFloat(f.elements.prix.value.replace(',', '.'));
    const lien = f.elements.lien.value.trim();
    if (lien && !LIEN_OK.test(lien)) { dire(msg, 'Le lien de paiement doit commencer par https://', true); return; }

    $('#enregistrer').disabled = true;
    const id = enEdition ? enEdition.id : `${slug(nom)}-${Date.now().toString(36)}`;
    const photos = [...existantes];
    try {
      for (let i = 0; i < nouvelles.length; i++) {
        dire(msg, `Envoi de la photo ${i + 1} sur ${nouvelles.length}…`);
        const b64 = await preparerImage(nouvelles[i].file);
        const chemin = `images/couteaux/${id}-${Date.now().toString(36)}${i}.jpg`;
        await ecrire(chemin, b64, `Photo : ${nom}`);
        photos.push(chemin);
      }
      dire(msg, 'Enregistrement de la fiche…');
      const fiche = {
        id,
        nom,
        prix: prixBrut > 0 ? prixBrut : null,
        statut: f.elements.statut.value,
        longueur: f.elements.longueur.value.trim(),
        lame: f.elements.lame.value.trim(),
        manche: f.elements.manche.value.trim(),
        lienAchat: lien,
        description: f.elements.description.value.trim(),
        photos,
        date: (enEdition && enEdition.date) || new Date().toISOString().slice(0, 10),
      };
      await modifierJSON(FICHIER_COUTEAUX, { couteaux: [] }, (d) => {
        d.couteaux = d.couteaux || [];
        const idx = d.couteaux.findIndex((k) => k.id === id);
        if (idx >= 0) d.couteaux[idx] = fiche; else d.couteaux.unshift(fiche);
        return d;
      }, enEdition ? `Modification de « ${nom} »` : `Ajout de « ${nom} »`);
      for (const p of aRetirer) {
        try { await supprimerFichier(p); } catch (err) { /* photo déjà absente */ }
      }
      nouvelles.forEach((n) => URL.revokeObjectURL(n.url));
      nouvelles = [];
      $('#editeur').close();
      await rafraichir();
      majCompteurs();
      dire($('#statut-global'), 'Enregistré. Le site se met à jour dans environ une minute.');
    } catch (err) {
      dire(msg, err.message, true);
      $('#enregistrer').disabled = false;
    }
  }

  /* ---------- Textes du site ---------- */

  function remplirTextes() {
    const f = $('#f-textes');
    const m = site.mentions || {};
    f.elements.accroche.value = site.accroche || '';
    f.elements.intro.value = site.intro || '';
    f.elements.atelier.value = site.atelier || '';
    f.elements.email.value = site.email || '';
    f.elements.compteur.value = site.compteur || '';
    f.elements.m_editeur.value = m.editeur || '';
    f.elements.m_statut.value = m.statut || '';
    f.elements.m_adresse.value = m.adresse || '';
    f.elements.m_siret.value = m.siret || '';
    f.elements.m_telephone.value = m.telephone || '';
  }

  function enregistrerTextes(e) {
    e.preventDefault();
    const f = e.target.elements;
    const code = f.compteur.value.trim().toLowerCase();
    if (code && !/^[a-z0-9-]{2,40}$/.test(code)) {
      dire($('#statut-global'), 'Le code GoatCounter ne peut contenir que des lettres minuscules, des chiffres et des tirets.', true);
      return;
    }
    return action('Enregistrement des textes', async () => {
      site = await modifierJSON(FICHIER_SITE, {}, (d) => Object.assign(d, {
        accroche: f.accroche.value.trim(),
        intro: f.intro.value.trim(),
        atelier: f.atelier.value.trim(),
        email: f.email.value.trim(),
        compteur: code,
        mentions: {
          editeur: f.m_editeur.value.trim(),
          statut: f.m_statut.value.trim(),
          adresse: f.m_adresse.value.trim(),
          siret: f.m_siret.value.trim(),
          telephone: f.m_telephone.value.trim(),
        },
      }), 'Mise à jour des textes du site');
    });
  }

  /* ---------- Mise en route ---------- */

  function choisirOnglet(nom) {
    ['couteaux', 'atelier', 'textes'].forEach((n) => {
      $('#o-' + n).setAttribute('aria-selected', n === nom ? 'true' : 'false');
      $('#p-' + n).hidden = n !== nom;
    });
  }

  function demarrer() {
    $('#f-connexion').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target.elements;
      seConnecter({
        owner: f.owner.value.trim(),
        repo: f.repo.value.trim(),
        branch: f.branch.value.trim(),
        token: f.token.value.trim(),
      }, f.souvenir.checked);
    });

    $('#deco').addEventListener('click', () => { oublierConnexion(); window.location.reload(); });
    $('#o-couteaux').addEventListener('click', () => choisirOnglet('couteaux'));
    $('#o-atelier').addEventListener('click', () => choisirOnglet('atelier'));
    $('#o-textes').addEventListener('click', () => choisirOnglet('textes'));
    $('#atelier-fichiers').addEventListener('change', (e) => ajouterAtelier(Array.from(e.target.files)));
    $('#ajouter').addEventListener('click', () => ouvrirEditeur(null));
    $('#annuler').addEventListener('click', () => $('#editeur').close());
    $('#photos-fichiers').addEventListener('change', (e) => ajouterFichiers(Array.from(e.target.files)));
    $('#f-couteau').addEventListener('submit', enregistrerCouteau);
    $('#f-textes').addEventListener('submit', enregistrerTextes);

    const memo = lireConnexion();
    if (memo) {
      const f = $('#f-connexion').elements;
      f.owner.value = memo.owner;
      f.repo.value = memo.repo;
      f.branch.value = memo.branch;
      seConnecter(memo, localStorage.getItem(CLE_STOCKAGE) !== null);
    }
  }

  demarrer();
})();
