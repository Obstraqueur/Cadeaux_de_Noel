# Analyse critique de l'ancien site « Idées cadeaux »

*Analyse faite à partir du code des dossiers `Cadeaux`, `Cadeaux_mulhouse` et `Anniv_sim`, et de la base `Cadeaux/db.sqlite3` (dernière modification : 26 novembre 2024).*

---

## 1. À quoi sert le site, qui l'utilise, pourquoi

**Le but.** C'est une liste au Père Noël partagée par une famille. Chacun écrit ce qui lui ferait plaisir, les autres viennent piocher des idées et cochent ce qu'ils ont acheté pour éviter les doublons. Un tirage d'« amis secrets » (Secret Santa) complète le tout.

**Les utilisateurs.** Une famille élargie d'une dizaine de personnes (Edmond, Antonin, Isabelle, Frederic, Laurine, Louis-Maël, Amaury, Siméon, Fabian…), réparties en **foyers** (le champ `groupenumber` : Isabelle et Frederic sont dans le même foyer, tout comme Laurine et Louis-Maël). Une deuxième famille (Mulhouse, 23 personnes) a eu droit à **une copie complète du site**, avec sa propre base. Une troisième copie (`Anniv_sim`) a été faite pour les anniversaires.

**Pourquoi on l'utilise.**
1. Savoir quoi offrir à quelqu'un sans lui demander directement.
2. Ne pas offrir deux fois la même chose.
3. Garder la surprise : la personne ne doit pas voir ce qu'on lui prépare.
4. Organiser le tirage au sort des amis secrets en respectant les couples et les foyers.

**L'usage réel.** La base contient 130 idées : 119 de 2023, dont 43 marquées « faites », et seulement 11 de 2024. Les dernières connexions datent de fin novembre 2024. Le site sert surtout **en novembre et décembre**, quelques fois par personne, et majoritairement **sur téléphone**. Il doit donc être simple, rapide à prendre en main au bout d'un an d'oubli, et pratique sur mobile.

> Remarque : tu parles d'idées 2025, mais la copie locale de la base n'en contient pas. Elles se trouvent sans doute dans la base du serveur (`51.20.125.129`). Le script de migration du nouveau site lit n'importe quelle base de l'ancien site, et il suffit de lui donner celle du serveur.

---

## 2. Les fonctionnalités existantes, une par une

| Fonctionnalité | Ce qu'elle fait | Verdict |
|---|---|---|
| **Inscription / connexion** par prénom | Chacun crée un compte, ce qui crée automatiquement sa « carte » | ✅ Indispensable. Un prénom suffit, c'est adapté à une famille. |
| **Cartes (« blocs »)** une par personne | Page d'accueil = grille de cartes | ✅ Bonne idée, mais la carte est liée au compte **par le texte du prénom** (`bloc.titre == user.username`) : renommer quelqu'un casse tout. |
| **Ma liste** | Sur sa propre carte, on ajoute des idées | ✅ Cœur du site. ⚠️ On ne **voit pas** ses propres idées, sauf en passant par la recherche. On ne peut donc pas relire ni corriger sa liste facilement. |
| **Idées ajoutées par les autres** | On peut ajouter une idée sur la carte de quelqu'un d'autre | ✅ Excellente idée (« il a dit qu'il n'avait plus de parfum »). Mais rien ne distingue une idée de la personne d'une suggestion d'un proche, et l'auteur n'est pas enregistré. |
| **« Fait »** | Marque une idée comme offerte, elle passe dans « Cadeaux faits » | ✅ Indispensable contre les doublons. ⚠️ On ne sait pas **qui** l'a prise. Pas d'état « je compte le prendre » distinct de « c'est acheté ». Le bouton pour annuler s'appelle « Supprimer », ce qui prête à confusion. |
| **Séparation par année** | Listes « 2023 » et « 2024 » distinctes | ⚠️ Années **écrites en dur** dans le code (`année = 2024`). En 2025, il a fallu modifier le code. Aucune gestion des idées d'il y a 3 ans. |
| **Recherche + autocomplétion** | Chercher dans ses idées | ❌ Peu utile pour une dizaine d'idées. Surtout, **l'autocomplétion cherche dans toute la base**, y compris les idées que les autres ont ajoutées pour toi : **elle dévoile les surprises**. |
| **Suppression avec confirmation** | Fenêtre « Êtes-vous sûr ? » | ✅ Bien. N'importe qui peut cependant supprimer n'importe quelle idée, même celles des autres. |
| **Amis secrets** | Tirage au sort excluant son propre foyer et évitant de retomber sur une personne déjà tirée par son foyer lors d'un tirage précédent | ✅ Très bonne fonctionnalité, avec des règles pertinentes. ⚠️ L'algorithme prend toujours « le premier candidat », fait 10 essais puis échoue **sans message**, et stocke les personnes par **prénom** (texte). Les tirages « essaie 1/2/3 » montrent qu'on a dû le relancer plusieurs fois. |
| **Mot de passe oublié** | Formulaire « nom + nouveau mot de passe » | ❌ **Faille majeure** : n'importe qui peut changer le mot de passe de n'importe qui sans aucune vérification. |
| **Neige, Père Noël volant** | Animations décoratives | 🙂 Sympa pour l'ambiance. Le Père Noël n'apparaît qu'au bout de 3 minutes, donc presque personne ne le voit. |
| **Version Mulhouse / Anniversaires** | Copies complètes du projet | ⚠️ Trois copies du même code divergent : chaque correction doit être faite 3 fois. Il vaut mieux **un seul site avec plusieurs familles**. |

---

## 3. Problèmes techniques et de sécurité

Par ordre d'importance :

1. **Mot de passe réinitialisable par n'importe qui** (voir plus haut).
2. **Pages et actions non protégées.** Seule la page d'accueil exige d'être connecté. On peut ouvrir une carte, marquer « fait », supprimer une idée ou **supprimer un tirage d'amis secrets** sans être connecté, et parfois par une simple URL.
3. **Fuite des surprises** par l'autocomplétion et la recherche sur sa propre carte.
4. **`DEBUG = True` et clé secrète écrite dans le code** en production : en cas d'erreur, le site affiche tout son code et sa configuration aux visiteurs.
5. **Liens par prénom (texte)** au lieu de vraies relations : un homonyme ou un renommage casse les cartes et les tirages.
6. **Années écrites en dur.**
7. **Code dupliqué.** Fonctions définies deux fois (`custom_login`), imports répétés, modèle `Article` inutilisé, modèle `Detail` intermédiaire sans utilité (son texte est toujours vide).
8. **Fichiers statiques et `nohup.out`** de 1 à 2 Mo dans le dossier, images de fond de 2 à 4,5 Mo (lentes à charger sur mobile).

---

## 4. Ce qui manque et qu'on pourrait ajouter

Classé par **valeur réelle pour la famille**.

### Indispensable (fait dans la nouvelle version)
- **Voir et modifier sa propre liste** (titre, précisions, lien, prix indicatif, priorité « j'en rêve »).
- **Réservation nominative** : « Je m'en occupe » → « C'est acheté ». Les autres voient qui s'en charge, **jamais la personne concernée**.
- **Cadeau à plusieurs** : rejoindre la réservation de quelqu'un pour participer à un gros cadeau.
- **Suggestions surprises** clairement identifiées, invisibles pour la personne concernée.
- **Années automatiques.** Les idées non offertes des années passées sont proposées sous « Toujours d'actualité ? » : un clic pour les garder, un clic pour les retirer.
- **Plusieurs familles sur un seul site**, avec un lien d'invitation par famille (Mulhouse rejoint le même site).
- **Foyers** gérés proprement et réutilisés par le tirage.
- **Profils gérés** : les enfants ou grands-parents sans compte (Fabian ne s'est jamais connecté) ont une liste tenue par un parent.
- **Tirage d'amis secrets fiable** : algorithme qui trouve toujours une solution s'il en existe une, respecte les foyers, évite les tirages de l'année précédente, et affiche un message clair sinon. Chacun ne voit que **sa** personne.
- **Mot de passe oublié sécurisé** : un administrateur de la famille génère un lien de réinitialisation à usage unique.
- **Mobile d'abord**, interactions sans rechargement de page.

### Utile (ajouté)
- **Lien vers le produit** et **fourchette de prix**.
- Tableau **« Mes réservations »** : tout ce que je dois acheter, sur une seule page, avec ce qui est acheté ou non.
- **Compte à rebours** jusqu'à Noël.

### Plus tard (pas fait, à discuter)
- Mode **anniversaire** (la copie `Anniv_sim`) : il suffirait d'ajouter une date d'anniversaire au profil et des « occasions » en plus de Noël.
- Notifications par e-mail (« Isabelle a ajouté 3 idées »). Elles demandent un serveur d'e-mails.
- Aperçu automatique des liens (image du produit).
- Liste « cadeaux reçus / merci » après Noël.

### Détails moins importants (abandonnés)
- Recherche et autocomplétion : inutiles avec 10 à 20 idées par personne. Un filtre suffit.
- Champ « détails » de la carte (toujours vide).
- Père Noël volant toutes les 3 minutes, remplacé par une neige discrète que chacun peut couper.

---

## 5. Choix pour la nouvelle version

- **Django 5.2 (version maintenue jusqu'en 2028)**, que tu connais déjà, avec une architecture propre : une seule application, de vraies relations entre les tables et des règles de visibilité centralisées et testées.
- **HTMX** pour la fluidité : réserver, ajouter ou supprimer se fait sans rechargement, sans framework JavaScript lourd ni étape de compilation.
- **CSS écrit à la main**, avec variables et thème clair/sombre automatique, sans dépendance.
- **SQLite** reste parfaitement adapté (quelques dizaines d'utilisateurs).
- **Configuration par variables d'environnement**, `DEBUG` désactivé en production, fichiers statiques servis par WhiteNoise, **Dockerfile** fourni.
- **Commande de migration** `import_ancien_site` qui reprend les comptes (avec leurs mots de passe actuels), les foyers, les idées, les « faits » et les tirages.
