# 🎁 Cadeaux de Noël

La liste au Père Noël de toute la famille. Chacun écrit ce qui lui ferait plaisir, les autres réservent ce qu'ils offrent, et **la personne concernée ne voit jamais ce qu'on lui prépare**.

Ce projet remplace les anciens sites `Cadeaux`, `Cadeaux_mulhouse` et `Anniv_sim`. L'analyse de l'ancien site et les raisons des choix faits ici sont dans **[docs/ANALYSE.md](docs/ANALYSE.md)**.

## Ce que fait le site

- **Ma liste** : ajouter, modifier ou supprimer ses idées, avec des précisions, un lien, un prix indicatif et un cœur « j'en rêve ».
- **Les listes des autres** : réserver (« Je m'en occupe »), marquer comme acheté, **participer à plusieurs** à un gros cadeau, ou **suggérer une idée surprise** que la personne ne verra pas.
- **À acheter** : tout ce dont je m'occupe, avec une case à cocher une fois l'achat fait.
- **Années automatiques** : les idées non offertes des années passées reviennent sous « Toujours d'actualité ? ».
- **Amis secrets** : tirage au sort qui respecte les foyers, évite la personne de l'an dernier et les échanges réciproques. Chacun ne voit que sa propre personne.
- **Plusieurs familles** sur un seul site, chacune avec son lien d'invitation.
- **Profils sans compte** (enfants, grands-parents) dont un parent tient la liste.
- **Gestion** pour les organisateurs : invitations, foyers, membres, lien « mot de passe oublié ».
- Pensé pour le téléphone, avec un thème clair ou sombre automatique et une neige qu'on peut couper.

## Technique

Django 5.2, HTMX (actions sans rechargement de page), CSS écrit à la main, SQLite et WhiteNoise. Aucune étape de compilation, aucune dépendance JavaScript externe, polices hébergées sur le site.

```
config/          réglages Django (lus depuis les variables d'environnement)
noel/
  models.py      Famille, Foyer, Membre, Idée, Réservation, Tirage, Attribution
  visibility.py  qui voit quoi : toutes les règles qui protègent la surprise
  secret_santa.py  algorithme du tirage au sort
  views.py, urls.py, forms.py
  templates/, static/
  management/commands/
    import_ancien_site.py   reprise des anciennes bases
    demo.py                 famille fictive pour essayer
  tests.py       25 tests
deploy/          service systemd et configuration nginx
```

## Essayer en local

```bash
python -m venv .venv && source .venv/bin/activate      # Windows : .venv\Scripts\activate
pip install -r requirements.txt
export DJANGO_DEBUG=1                                  # Windows : set DJANGO_DEBUG=1
python manage.py migrate
python manage.py demo          # comptes Marie / Paul / Léa / Tom, mot de passe « noel2026 »
python manage.py runserver
```

Ouvrez http://127.0.0.1:8000. Les tests se lancent avec `python manage.py test noel`.

## Reprendre les données de l'ancien site

La commande lit une base de l'ancien site, sans la modifier, et la range dans une famille. **Les comptes gardent leur mot de passe actuel.** Elle peut être relancée sans créer de doublons.

```bash
# 1. Récupérer la base À JOUR depuis le serveur actuel (celle de l'ordinateur s'arrête en 2024)
scp ubuntu@51.20.125.129:~/Cadeaux/db.sqlite3 ancien_cadeaux.sqlite3
scp ubuntu@51.20.125.129:~/Cadeaux_mulhouse/db_mulhouse.sqlite3 ancien_mulhouse.sqlite3

# 2. Importer chaque famille
python manage.py import_ancien_site ancien_cadeaux.sqlite3  --famille "Famille Jean" --admin Edmond
python manage.py import_ancien_site ancien_mulhouse.sqlite3 --famille "Mulhouse"     --admin Edmond
```

Options utiles :

| Option | Effet |
|---|---|
| `--admin Edmond Isabelle` | Prénoms des organisateurs (gestion, tirages). |
| `--annee-defaut 2023` | Année des idées si l'ancienne base n'en enregistre pas (le cas de Mulhouse). |
| `--annee-tirages 2025` | Année à donner aux anciens tirages, pour que le prochain tirage évite les mêmes personnes. |
| `--sans-tirages` | Ne pas reprendre les tirages (les anciens « essaie 1/2/3 », par exemple). |
| `--auteur-proprietaire` | Voir ci-dessous. |

**À propos des anciennes idées.** L'ancien site n'enregistrait pas qui avait écrit une idée. Par prudence, les idées reprises restent **invisibles pour la personne concernée**, comme avant. Les autres les voient toujours. Avec `--auteur-proprietaire`, chacun revoit ses anciennes idées et peut les garder pour cette année, mais il verra aussi les suggestions qu'on avait ajoutées pour lui.

Un prénom présent dans les deux bases (Edmond, par exemple) devient **un seul compte membre des deux familles**.

## Mettre en ligne

### Option A : sur le serveur actuel, sans Docker

```bash
git clone https://github.com/Obstraqueur/Cadeaux_de_Noel.git && cd Cadeaux_de_Noel
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env && nano .env           # clé secrète, adresse du site, GUNICORN_BIND=127.0.0.1:8000
set -a && . ./.env && set +a
mkdir -p data
.venv/bin/python manage.py migrate
.venv/bin/python manage.py collectstatic --noinput
.venv/bin/python manage.py import_ancien_site ../Cadeaux/db.sqlite3 --famille "Famille Jean" --admin Edmond
sudo cp deploy/cadeaux.service /etc/systemd/system/ && sudo systemctl enable --now cadeaux
sudo cp deploy/nginx.conf /etc/nginx/sites-available/cadeaux   # adapter le nom de domaine
sudo ln -s /etc/nginx/sites-available/cadeaux /etc/nginx/sites-enabled/ && sudo systemctl reload nginx
sudo certbot --nginx -d cadeaux.exemple.fr                     # HTTPS gratuit
```

Pour arrêter l'ancien site : `pkill -f "gunicorn.*Cadeaux"` (il tournait avec `nohup`).
Pour mettre à jour : `git pull && .venv/bin/python manage.py migrate && .venv/bin/python manage.py collectstatic --noinput && sudo systemctl restart cadeaux`.

> Sans nom de domaine ni HTTPS (accès par `http://IP:8000`), mettez `DJANGO_SECURE_COOKIES=0` dans `.env`, sinon la connexion échoue. Le HTTPS reste fortement conseillé : il protège les mots de passe.

### Option B : avec Docker

```bash
cp .env.example .env && nano .env
docker compose up -d --build
docker compose exec web python manage.py import_ancien_site /app/data/ancien.sqlite3 --famille "Famille Jean" --admin Edmond
```

(Copiez d'abord l'ancienne base dans le dossier `data/`.)

### Sauvegarde

Toutes les données tiennent dans un seul fichier : `data/cadeaux.sqlite3`. Copiez-le de temps en temps, par exemple avec `sqlite3 data/cadeaux.sqlite3 ".backup sauvegarde.sqlite3"`.

## Premier lancement sans ancienne base

1. `python manage.py createsuperuser` (ou inscrivez-vous puis créez une famille depuis la page d'accueil).
2. Connectez-vous et créez votre famille : vous en êtes l'organisateur.
3. Dans **Gérer la famille**, copiez le lien d'invitation et envoyez-le sur le groupe familial.

## Captures (données fictives)

| Accueil | Réservation | Thème sombre |
|---|---|---|
| ![](docs/captures/02-accueil-mobile.png) | ![](docs/captures/04-apres-reservation.png) | ![](docs/captures/12-jules-sombre.png) |

![Liste sur ordinateur](docs/captures/10-liste-desktop.png)
