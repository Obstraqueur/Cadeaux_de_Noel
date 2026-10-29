"""Reprise des données de l'ancien site (Cadeaux, Cadeaux_mulhouse, Anniv_sim).

Exemples :
    python manage.py import_ancien_site /chemin/db.sqlite3 --famille "Famille Jean" --admin Edmond
    python manage.py import_ancien_site /chemin/db_mulhouse.sqlite3 --famille "Mulhouse" --admin Edmond

Ce qui est repris :
  - les comptes, avec leur mot de passe actuel (personne n'a à en changer) ;
    un prénom déjà présent (autre famille importée) réutilise le même compte ;
  - une personne par « carte » (bloc), reliée à son compte ;
  - les foyers (numéro de groupe de l'ancien site) ;
  - les idées, avec leur année ; « fait » devient une réservation « acheté » ;
  - les tirages d'amis secrets.

La commande peut être relancée sans créer de doublons.
"""

import sqlite3
from collections import defaultdict

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from datetime import timezone as dt_tz

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from noel.models import Assignment, Draw, Family, Household, Idea, Member, Reservation

TITLE_MAX = 110


def split_text(text):
    text = (text or "").replace("\r\n", "\n").strip()
    first = text.split("\n", 1)[0].strip()
    if len(first) <= TITLE_MAX and "\n" not in text:
        return first, ""
    if len(first) > TITLE_MAX:
        cut = first[:TITLE_MAX].rsplit(" ", 1)[0]
        return cut.rstrip(" ,.;:") + "…", text
    return first, text.split("\n", 1)[1].strip()


class Command(BaseCommand):
    help = "Importe une base de l'ancien site d'idées cadeaux dans une famille."

    def add_arguments(self, parser):
        parser.add_argument("db", help="Chemin vers l'ancienne base sqlite")
        parser.add_argument("--famille", required=True, help="Nom de la famille à créer ou compléter")
        parser.add_argument("--admin", nargs="*", default=[], help="Prénoms des organisateurs")
        parser.add_argument("--annee-defaut", type=int, default=2023,
                            help="Année des idées quand l'ancienne base n'en a pas (défaut 2023)")
        parser.add_argument("--annee-tirages", type=int, default=2024,
                            help="Année attribuée aux anciens tirages d'amis secrets (défaut 2024)")
        parser.add_argument("--sans-tirages", action="store_true", help="Ne pas importer les tirages")
        parser.add_argument(
            "--auteur-proprietaire", action="store_true",
            help="Considérer que chaque idée a été écrite par la personne elle-même : elle reverra ses "
                 "anciennes idées (mais aussi les suggestions que d'autres avaient ajoutées pour elle). "
                 "Par défaut, les anciennes idées restent invisibles pour la personne concernée, comme avant.",
        )

    def handle(self, *args, **opts):
        try:
            src = sqlite3.connect(f"file:{opts['db']}?mode=ro", uri=True)
        except sqlite3.Error as e:
            raise CommandError(f"Impossible d'ouvrir {opts['db']} : {e}")
        src.row_factory = sqlite3.Row
        tables = {r[0] for r in src.execute("select name from sqlite_master where type='table'")}
        if "ideecadeaux_bloc" not in tables:
            raise CommandError("Ce fichier n'est pas une base de l'ancien site (table ideecadeaux_bloc absente).")

        def cols(table):
            return {r[1] for r in src.execute(f'pragma table_info("{table}")')}

        with transaction.atomic():
            stats = self._import(src, tables, cols, opts)
        src.close()
        self.stdout.write(self.style.SUCCESS(
            "Import terminé : " + ", ".join(f"{v} {k}" for k, v in stats.items())
        ))

    def _import(self, src, tables, cols, opts):
        User = get_user_model()
        stats = defaultdict(int)
        family, created = Family.objects.get_or_create(name=opts["famille"])
        if created:
            stats["famille créée"] += 1

        # ---- comptes
        users_by_name = {}
        for row in src.execute("select * from ideecadeaux_customuser"):
            username = row["username"].strip()
            user = User.objects.filter(username__iexact=username).first()
            if user is None:
                user = User(username=username, password=row["password"],
                            is_staff=bool(row["is_staff"]), is_superuser=bool(row["is_superuser"]),
                            is_active=bool(row["is_active"]))
                if row["last_login"]:
                    dt = parse_datetime(str(row["last_login"]))
                    if dt and timezone.is_naive(dt):
                        dt = timezone.make_aware(dt, dt_tz.utc)  # l'ancien site stockait en UTC
                    user.last_login = dt
                user.save()
                stats["comptes"] += 1
            users_by_name[username.lower()] = user

        # ---- personnes (une par carte)
        bloc_cols = cols("ideecadeaux_bloc")
        members_by_bloc, members_by_name, groups = {}, {}, defaultdict(list)
        for row in src.execute("select * from ideecadeaux_bloc"):
            name = row["titre"].strip()
            user = users_by_name.get(name.lower())
            member = Member.objects.filter(family=family, name__iexact=name).first()
            if member is None and user is not None:
                member = Member.objects.filter(family=family, user=user).first()
            if member is None:
                member = Member.objects.create(family=family, name=name, user=user)
                stats["personnes"] += 1
            elif member.user_id is None and user is not None:
                member.user = user
                member.save(update_fields=["user"])
            members_by_bloc[row["id"]] = member
            members_by_name[name.lower()] = member
            if "groupenumber" in bloc_cols and row["groupenumber"]:
                groups[row["groupenumber"]].append(member)

        # ---- foyers
        for _, ms in sorted(groups.items()):
            if len(ms) < 2 or any(m.household_id for m in ms):
                continue
            h = Household.objects.create(family=family, name=" & ".join(sorted(m.name for m in ms)))
            Member.objects.filter(pk__in=[m.pk for m in ms]).update(household=h)
            stats["foyers"] += 1

        # ---- organisateurs
        admins = {a.lower() for a in opts["admin"]}
        for m in family.members.select_related("user"):
            if m.name.lower() in admins or (m.user and m.user.is_superuser):
                if not m.is_admin:
                    m.is_admin = True
                    m.save(update_fields=["is_admin"])

        # ---- idées
        idea_cols = cols("ideecadeaux_ideecadeau")
        has_year = "année" in idea_cols
        rows = src.execute(
            "select i.*, d.bloc_id as bloc_id from ideecadeaux_ideecadeau i "
            "join ideecadeaux_detail d on d.id = i.detail_id"
        )
        for row in rows:
            recipient = members_by_bloc.get(row["bloc_id"])
            if recipient is None or not (row["idee_cadeau"] or "").strip():
                continue
            title, details = split_text(row["idee_cadeau"])
            year = row["année"] if has_year and row["année"] else opts["annee_defaut"]
            if Idea.objects.filter(recipient=recipient, title=title, year=year).exists():
                continue
            idea = Idea.objects.create(recipient=recipient, author=recipient if opts["auteur_proprietaire"] else None, title=title, details=details, year=year)
            stats["idées"] += 1
            if "fait" in idea_cols and row["fait"]:
                Reservation.objects.create(idea=idea, owner=None, status=Reservation.BOUGHT)
                stats["déjà offertes"] += 1

        # ---- tirages
        if not opts["sans_tirages"] and {"ideecadeaux_boucleamissecrets", "ideecadeaux_detailboucle"} <= tables:
            for b in src.execute("select * from ideecadeaux_boucleamissecrets"):
                title = (b["titre_boucle"] or "Amis secrets").strip()
                draw, created = Draw.objects.get_or_create(family=family, title=title, year=opts["annee_tirages"])
                if not created:
                    continue
                stats["tirages"] += 1
                seen_g, seen_r = set(), set()
                for d in src.execute("select * from ideecadeaux_detailboucle where boucle_amis_secrets_id = ?", (b["id"],)):
                    g = members_by_name.get((d["titre_bloc"] or "").strip().lower())
                    r = members_by_name.get((d["ami_secret"] or "").strip().lower())
                    if g and r and g.pk not in seen_g and r.pk not in seen_r:
                        Assignment.objects.create(draw=draw, giver=g, receiver=r)
                        seen_g.add(g.pk); seen_r.add(r.pk)
        return dict(stats)
