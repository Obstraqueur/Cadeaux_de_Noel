"""Crée une famille de démonstration pour essayer le site en local.

    python manage.py demo        → comptes « Marie », « Paul », « Léa », « Tom » (mot de passe : noel2026)
"""

from django.core.management.base import BaseCommand

from noel import secret_santa
from noel.models import Assignment, Draw, Family, Household, Idea, Member, Reservation, User, current_season

PASSWORD = "noel2026"


class Command(BaseCommand):
    help = "Crée une famille de démonstration (données fictives)."

    def handle(self, *args, **opts):
        fam, _ = Family.objects.get_or_create(name="Famille Démo")
        house = Household.objects.get_or_create(family=fam, name="Paul & Léa")[0]
        people = {}
        for name, h, admin in [("Marie", None, True), ("Paul", house, False), ("Léa", house, False), ("Tom", None, False)]:
            u = User.objects.filter(username=name).first() or User.objects.create_user(name, password=PASSWORD)
            people[name], _ = Member.objects.get_or_create(
                family=fam, user=u, defaults={"name": name, "household": h, "is_admin": admin})
        kid, _ = Member.objects.get_or_create(family=fam, name="Jules", defaults={"household": house})
        kid.managers.add(people["Léa"].user, people["Paul"].user)

        y = current_season()
        data = [
            ("Marie", "Marie", "Un carnet de croquis A4", "Papier épais, au moins 200 g", "", "≈ 25 €", True, y),
            ("Marie", "Marie", "Des gants en laine", "Taille S, couleur sombre", "", "", False, y),
            ("Marie", "Marie", "Le dernier roman de Joël Dicker", "", "https://www.fnac.com", "≈ 23 €", False, y),
            ("Marie", "Paul", "Un cours de céramique", "Elle en parle depuis l'été", "", "≈ 60 €", False, y),
            ("Paul", "Paul", "Une enceinte Bluetooth", "Étanche, pour la douche", "https://www.boulanger.com", "50 à 80 €", True, y),
            ("Paul", "Paul", "Des chaussettes rigolotes", "", "", "", False, y),
            ("Paul", "Paul", "Une lampe frontale", "", "", "≈ 30 €", False, y - 1),
            ("Léa", "Léa", "Un abonnement à une revue de cuisine", "", "", "≈ 40 €/an", False, y),
            ("Léa", "Léa", "Une plante grimpante", "Pas trop d'entretien !", "", "", False, y),
            ("Tom", "Tom", "Un jeu de société coopératif", "Pandemic ou Horrified", "", "≈ 35 €", True, y),
            ("Jules", "Léa", "Des Lego Technic", "6 ans et plus", "", "≈ 30 €", True, y),
            ("Jules", "Paul", "Un livre sur les dinosaures", "", "", "", False, y),
        ]
        ideas = {}
        for rec, auth, title, details, url, price, fav, year in data:
            rmember = kid if rec == "Jules" else people[rec]
            ideas[title], _ = Idea.objects.get_or_create(
                recipient=rmember, title=title,
                defaults=dict(author=people[auth], details=details, url=url, price=price, favorite=fav, year=year))
        for title, owner, status, parts in [
            ("Un carnet de croquis A4", "Tom", Reservation.RESERVED, []),
            ("Une enceinte Bluetooth", "Marie", Reservation.RESERVED, ["Tom"]),
            ("Une plante grimpante", "Marie", Reservation.BOUGHT, []),
        ]:
            res, _ = Reservation.objects.get_or_create(idea=ideas[title], defaults={"owner": people[owner], "status": status})
            res.participants.add(*[people[p] for p in parts])

        if not Draw.objects.filter(family=fam, year=y).exists():
            members = list(people.values())
            result = secret_santa.draw([m.pk for m in members], {m.pk: m.household_id for m in members}, rounds=2)
            d = Draw.objects.create(family=fam, title=f"Amis secrets {y}", budget="30 €", year=y, rounds=2,
                                   created_by=people["Marie"])
            Assignment.objects.bulk_create(
                [Assignment(draw=d, round=t, giver_id=g, receiver_id=r) for t, g, r in result.pairs])

        self.stdout.write(self.style.SUCCESS(
            f"Famille de démo prête. Connectez-vous avec Marie, Paul, Léa ou Tom (mot de passe : {PASSWORD})."))
