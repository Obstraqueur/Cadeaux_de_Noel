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

## 1 bis. Ce que la version 2025 a ajouté

*D'après le dossier `Noel/Noel/Cadeaux` (fichiers modifiés jusqu'au 8 décembre 2025) et sa base du 1er décembre 2025.*

- **Calendrier de l'Avent** : 25 images « porte » (le numéro du jour) et 25 images « intérieur » (une méditation sur le psaume 23), du 30 novembre au 24 décembre. Sur l'accueil, seule la case du jour s'affiche, et des flèches permettent de revenir aux jours passés.
  - ✅ Très belle idée, qui donne une raison de revenir sur le site chaque jour de décembre.
  - ⚠️ **On peut voir les jours à venir** en changeant la date dans l'adresse `/avent/get/?date=…` : rien ne vérifie la date côté serveur.
  - ⚠️ **Erreur dans les données** : le 1er décembre affiche le jour 3, et les 2 et 3 décembre n'existent pas (23 cases au lieu de 25).
  - ⚠️ Les images ne s'ajoutent qu'en ligne de commande sur le serveur.
- **Tirages rangés par année** (colonne `annee`) : 2 boucles en 2025, 2 en 2024. Le tirage évite qu'un membre d'un foyer retombe sur une personne tirée par son foyer cette année ou l'an dernier, avec jusqu'à 100 essais. ⚠️ Avec un foyer de 3 personnes (Edmond, Laurine, Louis-Maël) qui ont tiré à eux 3 les 6 autres personnes en 2025, **cette règle devient impossible à tenir en 2026** : l'ancien code aurait échoué sans message.
- **Nouveaux profils** : « Augustin », une carte sans compte (dans le foyer d'Edmond, Laurine et Louis-Maël), et « Maison Anne », un compte pour une maison.
- **Idées** : la base contient 175 idées (2023 et 2024), et **aucune idée 2025** au 1er décembre 2025, bien que le code range les nouvelles idées en 2025. Les idées 2023 déjà offertes ont été supprimées (43 auparavant, 2 aujourd'hui).
- L'année est toujours écrite en dur (`année = 2025`, une liste par année dans les modèles de page).

**Dans la nouvelle version** :
- Le calendrier est repris avec une grille de portes. Une case ne s'ouvre **qu'à partir de son jour, vérifié par le serveur**. Les cases déjà ouvertes sont cochées, et on navigue entre les jours avec des flèches.
- L'organisateur **envoie toutes les images d'un coup depuis le site** : chaque fichier `dayN` est rangé automatiquement à la bonne date. Une case peut aussi contenir un texte.
- Les tirages par année et leurs boucles sont repris tels quels. La règle « foyer, an dernier » est gardée, mais assouplie en dernier recours avec un message clair.

## 2. Les fonctionnalités existantes, une par une

| Fonctionnalité | Ce qu'elle fait | Verdict |
|---|---|---|
| **Inscription / connexion** par prénom | Chacun crée un compte, ce qui crée automatiquement sa « carte » | ✅ Indispensable. Un prénom suffit, c'est adapté à une famille. |
| **Cartes (« blocs »)** une par personne | Page d'accueil = grille de cartes | ✅ Bonne idée, mais la carte est liée au compte **par le texte du prénom** (`bloc.titre == user.username`) : renommer quelqu'un casse tout. |
| **Ma liste** | Sur sa propre carte, on ajoute des idées | ✅ Cœur du site. On ne **voit pas** ses propres idées, **et c'est voulu** : on les oublie pour être surpris. La recherche permet d'en retrouver une pour la corriger. ⚠️ Rien n'indique combien d'idées on a déjà mises. |
| **Idées ajoutées par les autres** | On peut ajouter une idée sur la carte de quelqu'un d'autre | ✅ Excellente idée (« il a dit qu'il n'avait plus de parfum »). Mais rien ne distingue une idée de la personne d'une suggestion d'un proche, et l'auteur n'est pas enregistré. |
| **« Fait »** | Marque une idée comme offerte, elle passe dans « Cadeaux faits » | ✅ Indispensable contre les doublons. ⚠️ On ne sait pas **qui** l'a prise. Pas d'état « je compte le prendre » distinct de « c'est acheté ». Le bouton pour annuler s'appelle « Supprimer », ce qui prête à confusion. |
| **Séparation par année** | Listes « 2023 » et « 2024 » distinctes | ⚠️ Années **écrites en dur** dans le code (`année = 2024`). En 2025, il a fallu modifier le code. Aucune gestion des idées d'il y a 3 ans. |
| **Recherche + autocomplétion** | Chercher dans ses idées | ✅ Indispensable puisque sa liste est cachée. ❌ Mais **l'autocomplétion cherche dans toute la base**, y compris les idées que les autres ont ajoutées pour toi : **elle dévoile les surprises**. |
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
- **Sa propre liste reste cachée**, comme avant, pour qu'on l'oublie. On voit seulement combien d'idées on a mises, et une **recherche** retrouve une idée pour la modifier ou la supprimer. Cette recherche ne porte que sur ses propres idées : jamais les suggestions des autres, jamais les réservations.
- Des idées plus riches : précisions, lien, prix indicatif, cœur « j'en rêve ».
- Si on supprime une idée que quelqu'un a déjà réservée, elle reste dans sa page « À acheter » avec la mention « Retirée de sa liste ».
- **Réservation nominative** : « Je m'en occupe » → « C'est acheté ». Les autres voient qui s'en charge, **jamais la personne concernée**.
- **Cadeau à plusieurs** : rejoindre la réservation de quelqu'un pour participer à un gros cadeau.
- **Suggestions d'un tiers** : une idée ajoutée sur la liste de quelqu'un d'autre porte l'étiquette « Suggestion d'un tiers (prénom) » et reste invisible pour la personne concernée.
- **Années automatiques.** Les idées non offertes des années passées restent visibles pour les autres dans « Idées des années précédentes ». La personne peut retrouver les siennes par la recherche et les « garder pour cette année » en un clic.
- **Plusieurs familles sur un seul site**, avec un lien d'invitation par famille (Mulhouse rejoint le même site).
- **Foyers** gérés proprement et réutilisés par le tirage.
- **Profils gérés** : les enfants ou grands-parents sans compte (Fabian ne s'est jamais connecté) ont une liste tenue par un parent.
- **Tirage d'amis secrets fiable** : algorithme qui trouve toujours une solution s'il en existe une, respecte les foyers, évite les tirages de l'année précédente, et affiche un message clair sinon. Chacun ne voit que **sa** personne.
- **Mot de passe oublié sécurisé** : seul un organisateur de la famille peut donner un mot de passe provisoire, que la personne change ensuite dans « Mon compte ».
- **Mobile d'abord**, interactions sans rechargement de page.

### Utile (ajouté)
- **Aperçu automatique des liens** : l'image du produit s'affiche sur l'étiquette.
- **Calendrier de l'Avent** (repris de 2025, voir plus haut).
- **Lien vers le produit** et **fourchette de prix**.
- Tableau **« Mes réservations »** : tout ce que je dois acheter, sur une seule page, avec ce qui est acheté ou non.
- **Compte à rebours** jusqu'à Noël.

### Plus tard (pas fait, à discuter)
- Mode **anniversaire** (la copie `Anniv_sim`) : il suffirait d'ajouter une date d'anniversaire au profil et des « occasions » en plus de Noël.
- Notifications par e-mail (« Isabelle a ajouté 3 idées »). Elles demandent un serveur d'e-mails.
- Liste « cadeaux reçus / merci » après Noël.

### Détails moins importants (abandonnés)
- Autocomplétion sur toute la base (remplacée par une recherche limitée à ses propres idées).
- Champ « détails » de la carte (toujours vide).
- Père Noël volant toutes les 3 minutes, remplacé par une neige discrète que chacun peut couper.

---

## 5. Choix pour la nouvelle version

Le site doit être publié **uniquement via GitHub**, sans serveur à entretenir. GitHub Pages n'héberge que des pages fixes, il faut donc un service pour les données :

- **GitHub Pages** pour le site : une seule page HTML, du JavaScript sans étape de compilation, et la même direction artistique (étiquettes cadeaux, vert sapin, rouge houx, neige).
- **Supabase** (gratuit) pour les comptes, les données et les images du calendrier. La sécurité est dans la base elle-même :
  - les **règles de lecture** (RLS) empêchent la personne concernée de lire les réservations et les suggestions qui la concernent ;
  - **toutes les modifications** passent par des fonctions serveur qui vérifient les droits ;
  - le **tirage des amis secrets** est fait sur le serveur, donc personne, pas même l'organisateur, ne voit les résultats des autres.
- **Connexion par prénom** comme avant, sans e-mail. Les mots de passe de l'ancien site ne peuvent pas être repris : chacun en choisit un nouveau en récupérant son profil via le lien d'invitation.
- **Reprise des données** par un script qui produit un fichier SQL à coller dans Supabase. Ce fichier n'est jamais publié, puisque le dépôt est public.
- La version Django, complète elle aussi, reste disponible dans la branche `version-django` au cas où vous voudriez un jour héberger le site sur un serveur.
