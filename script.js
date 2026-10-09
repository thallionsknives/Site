'use strict';
/* Les couteaux de Thallions — script du site public.
   Les couteaux viennent de data/knives.json et les textes de data/site.json :
   on les modifie depuis la page privée, pas ici. */
(() => {
  const $ = (sel, racine = document) => racine.querySelector(sel);

  const CHEMIN_OK = /^images\/[A-Za-z0-9_\-./]+$/;
  const EMAIL_OK = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
  const LIEN_OK = /^https:\/\/[^\s"'<>]+$/;
  const STATUTS = { disponible: 'Disponible', reserve: 'Réservé', vendu: 'Vendu' };

  let site = {};
  let couteaux = [];
  let filtre = 'tous';

  /* ---------- Compteur de visites : GoatCounter, sans cookie ----------
     Le code du compteur est dans data/site.json (clé « compteur »). Sans code, rien n'est compté.
     Une visite est comptée une seule fois par session, et jamais depuis l'appareil du propriétaire
     (il est reconnu quand il s'est connecté à l'espace privé). */
  function compter(chemin, titre) {
    const code = site.compteur;
    if (typeof code !== 'string' || !/^[a-z0-9-]{2,40}$/.test(code)) return;
    try {
      if (localStorage.getItem('thallions-proprio')) return;
      const cle = 'gc:' + chemin;
      if (sessionStorage.getItem(cle)) return;
      sessionStorage.setItem(cle, '1');
    } catch (e) { /* stockage indisponible : on compte quand même */ }
    const u = `https://${code}.goatcounter.com/count?p=${encodeURIComponent(chemin)}&t=${encodeURIComponent(titre || chemin)}&rnd=${Math.random().toString(36).slice(2)}`;
    new Image().src = u;
  }

  /* ---------- Effets au défilement (sobres, coupés si « mouvement réduit ») ---------- */
  document.documentElement.classList.add('js');

  const apparition = 'IntersectionObserver' in window
    ? new IntersectionObserver((entrees) => {
        entrees.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('visible');
            apparition.unobserve(e.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' })
    : null;

  function surveiller(n) {
    if (apparition) apparition.observe(n); else n.classList.add('visible');
  }

  function effetsEntete() {
    const entete = $('#entete');
    const barre = $('.progres');
    let attente = false;
    const maj = () => {
      attente = false;
      const y = window.scrollY || 0;
      if (y > 48) entete.classList.add('defile'); else if (y < 16) entete.classList.remove('defile');
      const total = document.documentElement.scrollHeight - window.innerHeight;
      barre.style.transform = `scaleX(${total > 0 ? Math.min(1, y / total) : 0})`;
    };
    window.addEventListener('scroll', () => {
      if (!attente) { attente = true; requestAnimationFrame(maj); }
    }, { passive: true });
    window.addEventListener('resize', maj);
    maj();
  }

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

  function prixTexte(p) {
    if (typeof p !== 'number' || !(p > 0)) return 'Prix sur demande';
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(p);
  }

  function statutDe(c) {
    return STATUTS[c.statut] ? c.statut : 'disponible';
  }

  function sansPhoto() {
    const n = el('div', { class: 'sans-photo', 'aria-hidden': 'true' });
    n.innerHTML =
      '<svg viewBox="0 0 400 500" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#CDD3D6" stroke-width="5" stroke-linejoin="round">' +
      '<g transform="translate(200 250) rotate(-35) scale(.3) translate(-605 -74)">' +
      '<path d="M430 44 H1010 C1090 46 1150 80 1172 104 H430 Z"/>' +
      '<rect x="40" y="42" width="380" height="64" rx="32"/></g></svg>';
    return n;
  }

  function adresseContact(c) {
    const email = site.email;
    if (!EMAIL_OK.test(email || '')) return '#contact';
    const sujet = c ? `Couteau : ${c.nom}` : 'Demande de renseignements';
    const corps = c
      ? `Bonjour,\n\nLe couteau « ${c.nom} » m'intéresse. Pouvez-vous me donner les modalités de paiement et d'envoi ?\n\nMerci.`
      : 'Bonjour,\n\n';
    return `mailto:${email}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
  }

  function carte(c) {
    const photos = (c.photos || []).filter((p) => CHEMIN_OK.test(p));
    const st = statutDe(c);
    const vignette = el('figure', { class: 'vignette' });
    if (photos.length) {
      vignette.append(el('img', { src: photos[0], alt: '', loading: 'lazy', decoding: 'async' }));
      if (photos.length > 1 && st !== 'vendu') {
        vignette.append(el('img', { class: 'seconde', src: photos[1], alt: '', loading: 'lazy', decoding: 'async' }));
      }
    } else {
      vignette.append(sansPhoto());
    }
    const bouton = el(
      'button',
      { type: 'button', class: 'carte' + (st === 'vendu' ? ' carte-vendu' : '') },
      vignette,
      el('div', { class: 'legende' },
        el('span', { class: 'nom', text: c.nom || 'Sans nom' }),
        el('span', { class: 'prix', text: st === 'vendu' ? '' : prixTexte(c.prix) })),
      el('div', { class: 'statut statut-' + st, text: STATUTS[st] })
    );
    bouton.addEventListener('click', () => ouvrirFiche(c, bouton));
    return bouton;
  }

  function rendre() {
    const grille = $('#grille');
    grille.replaceChildren();
    const liste = couteaux.filter((c) => filtre === 'tous' || statutDe(c) === 'disponible');
    liste.forEach((c, i) => {
      const b = carte(c);
      b.classList.add('reveal');
      b.style.setProperty('--d', `${(i % 3) * 110}ms`);
      grille.append(b);
      surveiller(b);
    });
    $('#vide').hidden = liste.length > 0;
    const dispo = couteaux.filter((c) => statutDe(c) === 'disponible').length;
    $('#compte').textContent = couteaux.length
      ? `${dispo} disponible${dispo > 1 ? 's' : ''} sur ${couteaux.length}`
      : '';
  }

  function ouvrirFiche(c, declencheur) {
    const dlg = $('#fiche');
    const corps = $('#fiche-corps');
    corps.replaceChildren();

    const photos = (c.photos || []).filter((p) => CHEMIN_OK.test(p));
    const st = statutDe(c);

    const galerie = el('div', { class: 'galerie' });
    const grande = photos.length
      ? el('img', { class: 'grande', src: photos[0], alt: c.nom || '' })
      : sansPhoto();
    galerie.append(grande);
    if (photos.length > 1) {
      const minis = el('div', { class: 'minis' });
      photos.forEach((p, i) => {
        const b = el('button', {
          type: 'button', class: 'mini',
          'aria-label': `Photo ${i + 1} sur ${photos.length}`,
          'aria-pressed': i === 0 ? 'true' : 'false',
        }, el('img', { src: p, alt: '' }));
        b.addEventListener('click', () => {
          grande.src = p;
          minis.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        });
        minis.append(b);
      });
      galerie.append(minis);
    }

    const infos = el('div', { class: 'infos' },
      el('h2', { id: 'fiche-titre', text: c.nom || 'Sans nom' }),
      el('p', { class: 'prix-grand', text: st === 'vendu' ? '' : prixTexte(c.prix) }),
      el('div', { class: 'statut statut-' + st, text: STATUTS[st] })
    );

    const specs = [['Longueur', c.longueur], ['Lame', c.lame], ['Manche', c.manche]]
      .filter(([, v]) => typeof v === 'string' && v.trim());
    if (specs.length) {
      const dl = el('dl', { class: 'specs' });
      specs.forEach(([k, v]) => dl.append(el('dt', { text: k }), el('dd', { text: v })));
      infos.append(dl);
    }
    if (c.description) infos.append(el('p', { class: 'description', text: c.description }));

    if (st === 'vendu') {
      infos.append(el('p', { class: 'description', text: 'Ce couteau a trouvé preneur. Écrivez-moi si vous souhaitez un modèle comparable.' }));
      infos.append(el('a', { class: 'bouton', href: adresseContact(null), text: 'Écrire à l\'atelier' }));
    } else if (LIEN_OK.test(c.lienAchat || '')) {
      infos.append(el('a', { class: 'bouton', href: c.lienAchat, target: '_blank', rel: 'noopener noreferrer', text: 'Acheter ce couteau' }));
    } else {
      infos.append(el('a', { class: 'bouton', href: adresseContact(c), text: 'Demander ce couteau' }));
    }

    corps.append(galerie, infos);
    dlg._retour = declencheur;
    dlg.showModal();
    if (c.id) compter('/couteau/' + c.id, c.nom || c.id);
  }

  /* Galerie de l'atelier : liste « atelierPhotos » de data/site.json (autant de photos que l'on veut) */
  let photosAtelier = [];
  let indexZoom = 0;

  function afficherAtelier() {
    const zone = $('#atelier-galerie');
    photosAtelier = (Array.isArray(site.atelierPhotos) ? site.atelierPhotos : []).filter((p) => typeof p === 'string' && CHEMIN_OK.test(p));
    zone.replaceChildren();
    zone.hidden = photosAtelier.length === 0;
    photosAtelier.forEach((p, i) => {
      const b = el('button', { type: 'button', class: 'atelier-photo reveal', 'aria-label': `Agrandir la photo ${i + 1} de l'atelier` },
        el('img', { src: p, alt: `Photo ${i + 1} de l'atelier`, loading: 'lazy', decoding: 'async' }));
      b.addEventListener('click', () => ouvrirZoom(i, b));
      zone.append(b);
      surveiller(b);
    });
  }

  function montrerZoom() {
    const img = $('#zoom-img');
    img.src = photosAtelier[indexZoom];
    img.alt = `Photo ${indexZoom + 1} sur ${photosAtelier.length} de l'atelier`;
    const seule = photosAtelier.length < 2;
    $('#zoom-prec').hidden = seule;
    $('#zoom-suiv').hidden = seule;
  }

  function ouvrirZoom(i, declencheur) {
    const dlg = $('#zoom');
    indexZoom = i;
    dlg._retour = declencheur;
    montrerZoom();
    dlg.showModal();
  }

  function pasZoom(sens) {
    if (photosAtelier.length < 2) return;
    indexZoom = (indexZoom + sens + photosAtelier.length) % photosAtelier.length;
    montrerZoom();
  }

  /* Photo d'accueil : chemin réglable dans data/site.json (clé « imageAccueil »).
     Si le fichier est absent, le dessin de couteau reste affiché. */
  function afficherPhotoAccueil() {
    const chemin = site.imageAccueil || 'images/hero.jpg';
    if (!CHEMIN_OK.test(chemin)) return;
    const img = $('#hero-img');
    img.addEventListener('load', () => {
      $('.hero').classList.add('avec-photo');
      $('#hero-photo').hidden = false;
    }, { once: true });
    img.src = chemin;
  }

  function remplir(sel, valeur) {
    const n = $(sel);
    if (n && typeof valeur === 'string' && valeur.trim()) n.textContent = valeur;
  }

  function appliquerSite() {
    remplir('#accroche', site.accroche);
    remplir('#intro', site.intro);
    remplir('#atelier-texte', site.atelier);
    if (site.nom) document.title = site.nom;
    $('#contact-lien').setAttribute('href', adresseContact(null));

    const m = site.mentions || {};
    const lignes = [
      ['Nom ou raison sociale', m.editeur],
      ['Statut', m.statut],
      ['Adresse', m.adresse],
      ['SIRET', m.siret],
      ['Téléphone', m.telephone],
      ['E-mail', site.email],
    ].filter(([, v]) => typeof v === 'string' && v.trim());
    if (lignes.length >= 3) {
      $('#m-editeur').textContent = lignes.map(([k, v]) => `${k} : ${v}`).join('. ') + '.';
      if (m.editeur) $('#m-directeur').textContent = m.editeur + '.';
    }
  }

  async function charger(chemin) {
    const r = await fetch(chemin, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${chemin} : ${r.status}`);
    return r.json();
  }

  async function demarrer() {
    $('#annee').textContent = new Date().getFullYear();
    effetsEntete();
    document.querySelectorAll('.reveal').forEach(surveiller);

    document.querySelectorAll('.filtre').forEach((b) => {
      b.addEventListener('click', () => {
        filtre = b.dataset.filtre;
        document.querySelectorAll('.filtre').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
        rendre();
      });
    });

    // Fenêtre des mentions légales
    const mentions = $('#mentions');
    const ouvrirMentions = $('#ouvrir-mentions');
    ouvrirMentions.addEventListener('click', () => mentions.showModal());
    $('#mentions-fermer').addEventListener('click', () => mentions.close());
    mentions.addEventListener('click', (e) => { if (e.target === mentions) mentions.close(); });
    mentions.addEventListener('close', () => ouvrirMentions.focus());

    // Visionneuse de photos
    const zoom = $('#zoom');
    $('#zoom-fermer').addEventListener('click', () => zoom.close());
    $('#zoom-prec').addEventListener('click', () => pasZoom(-1));
    $('#zoom-suiv').addEventListener('click', () => pasZoom(1));
    zoom.addEventListener('click', (e) => { if (e.target === zoom) zoom.close(); });
    zoom.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') pasZoom(-1);
      if (e.key === 'ArrowRight') pasZoom(1);
    });
    zoom.addEventListener('close', () => { if (zoom._retour) zoom._retour.focus(); });

    const dlg = $('#fiche');
    $('#fiche-fermer').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => { if (dlg._retour) dlg._retour.focus(); });

    // Accès discret à la page privée : cinq clics rapides sur le ©.
    let clics = 0;
    let minuteur;
    $('#signature').addEventListener('click', () => {
      clics += 1;
      clearTimeout(minuteur);
      minuteur = setTimeout(() => { clics = 0; }, 3000);
      if (clics >= 5) window.location.href = 'atelier-prive.html';
    });

    try {
      site = await charger('data/site.json');
    } catch (e) { site = {}; }
    appliquerSite();
    afficherPhotoAccueil();
    afficherAtelier();
    compter('/visite', 'Visite du site');

    try {
      const data = await charger('data/knives.json');
      couteaux = Array.isArray(data.couteaux) ? data.couteaux : [];
      rendre();
    } catch (e) {
      $('#grille').replaceChildren(el('p', { class: 'erreur', text: 'La collection ne peut pas être affichée pour le moment. Réessayez dans quelques instants.' }));
    }
  }

  demarrer();
})();
