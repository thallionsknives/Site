'use strict';
/* Espace privé : ajoute, modifie et supprime des couteaux en écrivant dans le dépôt GitHub.
   Le jeton d'accès reste dans ce navigateur et n'est envoyé qu'à api.github.com. */
(() => {
  const $ = (sel, racine = document) => racine.querySelector(sel);

  const FICHIER_COUTEAUX = 'data/knives.json';
  const FICHIER_SITE = 'data/site.json';
  const CLE_STOCKAGE = 'thallions-connexion';
  const MAX_PHOTOS = 10;
  const LIEN_OK = /^https:\/\/[^\s"'<>]+$/;
  const LIBELLES = { disponible: 'Disponible', reserve: 'Réservé', vendu: 'Vendu' };

  let cfg = null;
  let couteaux = [];
  let site = {};
  let enEdition = null;
  let existantes = [];
  let aRetirer = [];
  let nouvelles = [];

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
    $('#f-connexion').token.value = '';
    $('#connexion').hidden = true;
    $('#espace').hidden = false;
    $('#deco').hidden = false;
    remplirTextes();
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

      ul.append(el('li', null,
        vignette,
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
        dire(msg, `Maximum ${MAX_PHOTOS} photos par couteau.`, true);
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
    f.elements.m_editeur.value = m.editeur || '';
    f.elements.m_statut.value = m.statut || '';
    f.elements.m_adresse.value = m.adresse || '';
    f.elements.m_siret.value = m.siret || '';
    f.elements.m_telephone.value = m.telephone || '';
  }

  function enregistrerTextes(e) {
    e.preventDefault();
    const f = e.target.elements;
    return action('Enregistrement des textes', async () => {
      site = await modifierJSON(FICHIER_SITE, {}, (d) => Object.assign(d, {
        accroche: f.accroche.value.trim(),
        intro: f.intro.value.trim(),
        atelier: f.atelier.value.trim(),
        email: f.email.value.trim(),
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
    const couteauxActif = nom === 'couteaux';
    $('#o-couteaux').setAttribute('aria-selected', couteauxActif ? 'true' : 'false');
    $('#o-textes').setAttribute('aria-selected', couteauxActif ? 'false' : 'true');
    $('#p-couteaux').hidden = !couteauxActif;
    $('#p-textes').hidden = couteauxActif;
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
    $('#o-textes').addEventListener('click', () => choisirOnglet('textes'));
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
