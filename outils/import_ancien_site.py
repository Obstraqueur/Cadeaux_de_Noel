#!/usr/bin/env python3
"""Convertit les bases de l'ancien site (Django/SQLite) en un fichier SQL pour Supabase.

    python outils/import_ancien_site.py Noel/Noel/Cadeaux/db.sqlite3 \
        Noel/base_sauvgarde/db_cadeaux_copie_2023_2024.sqlite3 \
        --famille "Famille Jean" --admin Edmond > import_famille_jean.sql

Puis : Supabase → SQL Editor → New query → coller le contenu du fichier → Run.

⚠️ Le fichier produit contient les prénoms et les idées de la famille : ne le publiez pas
(il est ignoré par git).

Ce qui est repris : une personne par « carte » (sans compte : chacun récupère son profil en
s'inscrivant avec le lien d'invitation), les foyers, les idées avec leur année, les « faits »
(→ réservation « acheté »), les tirages d'amis secrets regroupés par année.
Les mots de passe de l'ancien site ne peuvent pas être repris (format incompatible).
Plusieurs bases peuvent être données : les doublons sont ignorés.
"""

import argparse
import secrets
import sqlite3
import sys
import uuid
from collections import defaultdict

TITLE_MAX = 110


def lit(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def split_text(text):
    text = (text or "").replace("\r\n", "\n").strip()
    first = text.split("\n", 1)[0].strip()
    if len(first) <= TITLE_MAX and "\n" not in text:
        return first, ""
    if len(first) > TITLE_MAX:
        cut = first[:TITLE_MAX].rsplit(" ", 1)[0]
        return cut.rstrip(" ,.;:") + "…", text
    return first, text.split("\n", 1)[1].strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("bases", nargs="+", help="Une ou plusieurs anciennes bases sqlite (la plus récente d'abord)")
    ap.add_argument("--famille", required=True)
    ap.add_argument("--admin", nargs="*", default=[], help="Prénoms des organisateurs")
    ap.add_argument("--annee-defaut", type=int, default=2023, help="Année des idées sans année (défaut 2023)")
    ap.add_argument("--annee-tirages", type=int, default=2024, help="Année des tirages sans année (défaut 2024)")
    ap.add_argument("--auteur-proprietaire", action="store_true",
                    help="Considérer que chacun a écrit les idées de sa carte (il pourra les retrouver par la recherche)")
    a = ap.parse_args()

    fam = str(uuid.uuid4())
    invite = secrets.token_hex(9)
    members = {}            # nom en minuscules -> (uuid, nom)
    groups = defaultdict(set)
    ideas = {}              # (membre, titre, année) -> dict
    draws = {}              # année -> liste de boucles [(giver, receiver)]

    for path in a.bases:
        src = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        src.row_factory = sqlite3.Row
        tables = {r[0] for r in src.execute("select name from sqlite_master where type='table'")}
        if "ideecadeaux_bloc" not in tables:
            sys.exit(f"{path} n'est pas une base de l'ancien site.")
        cols = lambda t: {r[1] for r in src.execute(f'pragma table_info("{t}")')}
        bloc_cols = cols("ideecadeaux_bloc")
        bloc_name = {}
        for b in src.execute("select * from ideecadeaux_bloc"):
            name = b["titre"].strip()
            key = name.lower()
            members.setdefault(key, (str(uuid.uuid4()), name))
            bloc_name[b["id"]] = key
            if "groupenumber" in bloc_cols and b["groupenumber"]:
                groups[(path, b["groupenumber"])].add(key)
        has_year = "année" in cols("ideecadeaux_ideecadeau")
        has_fait = "fait" in cols("ideecadeaux_ideecadeau")
        for r in src.execute("select i.*, d.bloc_id from ideecadeaux_ideecadeau i join ideecadeaux_detail d on d.id = i.detail_id"):
            key = bloc_name.get(r["bloc_id"])
            if not key or not (r["idee_cadeau"] or "").strip():
                continue
            title, details = split_text(r["idee_cadeau"])
            year = (r["année"] if has_year and r["année"] else a.annee_defaut)
            k = (key, title, year)
            if k not in ideas:
                ideas[k] = {"fait": bool(has_fait and r["fait"]), "details": details}
            elif has_fait and r["fait"]:
                ideas[k]["fait"] = True
        if {"ideecadeaux_boucleamissecrets", "ideecadeaux_detailboucle"} <= tables:
            has_annee = "annee" in cols("ideecadeaux_boucleamissecrets")
            by_year = defaultdict(list)
            for b in src.execute("select * from ideecadeaux_boucleamissecrets order by id"):
                y = b["annee"] if has_annee and b["annee"] else a.annee_tirages
                pairs = [(d["titre_bloc"].strip().lower(), d["ami_secret"].strip().lower())
                         for d in src.execute("select * from ideecadeaux_detailboucle where boucle_amis_secrets_id = ?", (b["id"],))]
                by_year[y].append(pairs)
            for y, loops in by_year.items():
                draws.setdefault(y, loops)   # la première base donnée l'emporte
        src.close()

    # Foyers : on garde les groupements de la base la plus récente (la première)
    first = a.bases[0]
    houses = []
    housed = set()
    for (path, _), keys in sorted(groups.items(), key=lambda x: (x[0][0] != first, str(x[0][1]))):
        keys = keys - housed
        if len(keys) < 2:
            continue
        names = sorted(members[k][1] for k in keys)
        houses.append((str(uuid.uuid4()), names[0] if len(names) == 1 else ", ".join(names[:-1]) + " & " + names[-1], keys))
        housed |= keys
    house_of = {k: h[0] for h in houses for k in h[2]}
    admins = {x.lower() for x in a.admin}

    out = []
    w = out.append
    w("-- Import de l'ancien site — généré par outils/import_ancien_site.py")
    w("-- ⚠️ Contient des données personnelles : ne pas publier.")
    w("begin;")
    w(f"insert into families (id, name, invite_code) values ({lit(fam)}, {lit(a.famille)}, {lit(invite)});")
    for hid, hname, _ in houses:
        w(f"insert into households (id, family_id, name) values ({lit(hid)}, {lit(fam)}, {lit(hname)});")
    for key, (mid, name) in sorted(members.items(), key=lambda x: x[1][1]):
        w(f"insert into members (id, family_id, name, household_id, is_admin) values "
          f"({lit(mid)}, {lit(fam)}, {lit(name)}, {lit(house_of.get(key))}, {lit(key in admins)});")
    n_ideas = n_bought = 0
    for (key, title, year), info in ideas.items():
        mid = members[key][0]
        author = lit(mid) if a.auteur_proprietaire else "null"
        w(f"with i as (insert into ideas (family_id, recipient_id, author_id, title, details, year) values "
          f"({lit(fam)}, {lit(mid)}, {author}, {lit(title)}, {lit(info['details'])}, {year}) returning id) "
          + (f"insert into reservations (idea_id, status) select id, 'bought' from i;" if info["fait"] else "select 1 from i;"))
        n_ideas += 1
        n_bought += info["fait"]
    n_draws = 0
    for year, loops in sorted(draws.items()):
        did = str(uuid.uuid4())
        w(f"insert into draws (id, family_id, title, year, rounds) values ({lit(did)}, {lit(fam)}, {lit('Amis secrets ' + str(year))}, {year}, {len(loops)});")
        seen = set()
        for t, pairs in enumerate(loops, start=1):
            sg, sr = set(), set()
            for g, r in pairs:
                if g in members and r in members and g not in sg and r not in sr and (g, r) not in seen:
                    w(f"insert into assignments (draw_id, round, giver_id, receiver_id) values "
                      f"({lit(did)}, {t}, {lit(members[g][0])}, {lit(members[r][0])});")
                    sg.add(g); sr.add(r); seen.add((g, r))
        n_draws += 1
    w("commit;")
    w(f"-- Lien d'invitation : <adresse du site>#/invitation/{invite}")
    print("\n".join(out))
    print(f"{len(members)} personnes, {len(houses)} foyers, {n_ideas} idées ({n_bought} déjà offertes), "
          f"{n_draws} tirages. Lien d'invitation : #/invitation/{invite}", file=sys.stderr)


if __name__ == "__main__":
    main()
