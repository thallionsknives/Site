# Les couteaux de Thallions : guide de mise en ligne

Ce site est 100 % statique (HTML, CSS, JavaScript). Il n'a pas de serveur : GitHub l'héberge gratuitement avec GitHub Pages.

## 1. Mettre le site en ligne

1. Connectez-vous sur github.com avec le compte `thallionsknives`.
2. Cliquez sur **New repository**. Nom du dépôt : `site`. Choisissez **Public** (nécessaire pour GitHub Pages gratuit). Cochez **Add a README file**, puis **Create repository**.
3. Dans le dépôt, cliquez sur **Add file > Upload files**. Glissez-y **tout le contenu** du dossier du site (les fichiers et les dossiers `data` et `images`). Cliquez sur **Commit changes**.
4. Allez dans **Settings > Pages**. Sous **Branch**, choisissez `main` et le dossier `/ (root)`, puis **Save**.
5. Après une à deux minutes, le site est en ligne à l'adresse : `https://thallionsknives.github.io/site/`

Un nom de domaine personnalisé (par exemple lescouteauxdethallions.fr) se branche plus tard dans **Settings > Pages > Custom domain**.

## 2. Ajouter des photos et des couteaux sans toucher au code

Votre espace privé est à l'adresse : `https://thallionsknives.github.io/site/atelier-prive.html`
Sur le site public, **cliquez 5 fois de suite sur le « © » tout en bas** : vous y arrivez.

### Créer votre jeton d'accès (une seule fois)

Le jeton est la clé qui prouve que c'est bien vous. Sans lui, personne ne peut rien modifier, même en connaissant l'adresse de la page privée.

1. Sur GitHub : votre photo de profil > **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**.
2. Nom : `espace prive`. Expiration : 1 an. **Repository access** : *Only select repositories*, puis le dépôt `site`.
3. **Permissions > Repository permissions > Contents : Read and write**. Rien d'autre.
4. Cliquez sur **Generate token** et copiez-le. Il n'est affiché qu'une fois.

### Se connecter

Dans l'espace privé, saisissez le compte (`thallionsknives`), le dépôt (`site`), la branche (`main`) et collez le jeton. Cochez « Rester connecté » seulement sur votre propre appareil.

Ensuite : **Ajouter un couteau**, remplissez la fiche, glissez les photos, **Enregistrer**. Le site se met à jour au bout d'une minute environ. Vous pouvez aussi modifier les textes du site et les mentions légales dans l'onglet « Textes du site ».

Les 3 couteaux « Exemple » sont là pour voir le rendu. Supprimez-les depuis l'espace privé quand vous avez ajouté les vôtres.

## 3. Sécurité

- Le site public ne contient aucun mot de passe ni aucune clé. Personne ne peut le modifier sans votre jeton.
- Le jeton ne quitte jamais votre navigateur, sauf vers GitHub. Ne l'envoyez à personne et ne le collez dans aucun fichier du site.
- Si vous perdez un appareil ou pensez que le jeton a fuité : GitHub > Settings > Developer settings > révoquez le jeton, puis recréez-en un.
- Activez la double authentification sur votre compte GitHub (Settings > Password and authentication).
- La page privée est masquée, pas secrète : sa sécurité repose sur le jeton, pas sur le fait que l'adresse soit cachée.
- Chaque modification crée une version dans GitHub : vous pouvez toujours revenir en arrière.

## 4. Vendre en ligne plus tard

Quand vous voudrez encaisser :

1. Créez un compte **Stripe** et, pour chaque couteau, un **Payment Link** (lien de paiement). Stripe vous envoie un e-mail à chaque achat.
2. Dans l'espace privé, ouvrez la fiche du couteau et collez le lien dans « Lien de paiement ». Le bouton « Demander ce couteau » devient « Acheter ce couteau ».
3. Les couteaux étant des pièces uniques, marquez-le « Vendu » dès qu'il est acheté (bouton dans la liste).

Avant de vendre : complétez les mentions légales (onglet « Textes du site ») et renseignez-vous sur les obligations d'un vendeur en ligne (statut, droit de rétractation de 14 jours, conditions générales de vente). Je ne suis pas juriste : en cas de doute, voyez un professionnel ou votre CCI.

## 5. Modifier le design

- `style.css` : couleurs et polices en haut du fichier (variables `--acier`, `--laiton`, etc.)
- `index.html` : structure et textes fixes de la page
- `script.js` : comportement de la collection et des fiches
- `data/site.json` et `data/knives.json` : le contenu (modifié par l'espace privé, évitez de les éditer à la main)

## 6. Photo de la page d'accueil

La photo à côté du titre est lue dans `images/hero.jpg` (elle est déjà incluse). Pour la changer, remplacez ce fichier par une autre photo de même nom (de préférence en paysage, rapport 3:2), via Add file > Upload files dans le dossier `images` de GitHub.
Si votre nouveau fichier porte un autre nom ou un autre format (par exemple `images/finition.png`), écrivez ce chemin dans `data/site.json`, à la ligne `"imageAccueil"`.
