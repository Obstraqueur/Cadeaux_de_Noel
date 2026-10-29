import sqlite3
import tempfile
from pathlib import Path

from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse

from . import secret_santa
from .models import Assignment, Draw, Family, Household, Idea, Member, Reservation, User, current_season


class Base(TestCase):
    def setUp(self):
        self.family = Family.objects.create(name="Famille Test")
        self.house = Household.objects.create(family=self.family, name="Isabelle & Frédéric")
        self.alice = self._member("Alice")
        self.bob = self._member("Bob")
        self.isa = self._member("Isabelle", household=self.house)
        self.fred = self._member("Frederic", household=self.house)
        self.alice.is_admin = True
        self.alice.save()

    def _member(self, name, **kw):
        user = User.objects.create_user(username=name, password="motdepasse")
        return Member.objects.create(family=self.family, user=user, name=name, **kw)

    def login(self, member):
        self.client.force_login(member.user)

    def url(self, name, *args):
        return reverse(name, args=[self.family.slug, *args])


class VisibilityTests(Base):
    def test_owner_list_is_hidden_but_searchable(self):
        own = Idea.objects.create(recipient=self.bob, author=self.bob, title="Un pull vert")
        Idea.objects.create(recipient=self.bob, author=self.alice, title="Un pull SURPRISE")
        Reservation.objects.create(idea=own, owner=self.alice)

        self.login(self.bob)
        html = self.client.get(self.url("member", self.bob.pk)).content.decode()
        self.assertNotIn("Un pull vert", html)          # sa liste est cachée
        self.assertIn("1 idée", html)                    # mais il sait combien il en a
        self.assertNotIn("SURPRISE", html)

        found = self.client.get(self.url("my_search"), {"q": "pull"}).content.decode()
        self.assertIn("Un pull vert", found)              # retrouvable par la recherche
        self.assertNotIn("SURPRISE", found)               # jamais les suggestions des autres
        self.assertNotIn("Réservé", found)                # ni les réservations
        self.assertNotIn("Alice", found)
        self.assertNotIn("Un pull vert", self.client.get(self.url("my_search"), {"q": "p"}).content.decode())

    def test_owner_add_does_not_show_idea(self):
        self.login(self.bob)
        r = self.client.post(self.url("idea_add", self.bob.pk), {"title": "Un bonnet"}, HTTP_HX_REQUEST="true")
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("Un bonnet", r.content.decode())
        self.assertIn("count-changed", r["HX-Trigger"])

    def test_owner_deleting_reserved_idea_keeps_it_for_reserver(self):
        idea = Idea.objects.create(recipient=self.bob, author=self.bob, title="Casque")
        Reservation.objects.create(idea=idea, owner=self.alice, status=Reservation.BOUGHT)
        self.login(self.bob)
        self.client.post(self.url("idea_delete", idea.pk), HTTP_HX_REQUEST="true")
        idea.refresh_from_db()
        self.assertTrue(idea.archived)
        self.assertNotIn('class="tag', self.client.get(self.url("my_search"), {"q": "Casque"}).content.decode())
        self.login(self.alice)
        r = self.client.get(self.url("reservations"))
        self.assertContains(r, "Casque")
        self.assertContains(r, "Retirée de sa liste")

    def test_third_party_label(self):
        Idea.objects.create(recipient=self.bob, author=self.isa, title="Une écharpe")
        self.login(self.alice)
        self.assertContains(self.client.get(self.url("member", self.bob.pk)), "Suggestion d'un tiers (Isabelle)")

    def test_others_see_everything_with_status(self):
        own = Idea.objects.create(recipient=self.bob, author=self.bob, title="Un pull vert")
        Idea.objects.create(recipient=self.bob, author=self.isa, title="Une montre")
        Reservation.objects.create(idea=own, owner=self.isa)
        self.login(self.alice)
        html = self.client.get(self.url("member", self.bob.pk)).content.decode()
        self.assertIn("Une montre", html)
        self.assertIn("Réservé", html)
        self.assertIn("Isabelle", html)

    def test_imported_idea_without_author_is_hidden_from_owner(self):
        Idea.objects.create(recipient=self.bob, author=None, title="Ancienne-idee", year=current_season())
        self.login(self.bob)
        self.assertNotContains(self.client.get(self.url("member", self.bob.pk)), "Ancienne-idee")

    def test_manager_ideas_are_visible_to_child(self):
        child_user = User.objects.create_user("Fabian", password="x" * 8)
        child = Member.objects.create(family=self.family, user=child_user, name="Fabian")
        child.managers.add(self.isa.user)
        Idea.objects.create(recipient=child, author=self.isa, title="Lego avion")
        self.client.force_login(child_user)
        self.assertContains(self.client.get(self.url("my_search"), {"q": "lego"}), "Lego avion")

    def test_non_member_is_refused(self):
        stranger = User.objects.create_user("Intrus", password="x" * 8)
        self.client.force_login(stranger)
        self.assertEqual(self.client.get(self.url("family")).status_code, 403)

    def test_anonymous_redirected_to_login(self):
        r = self.client.get(self.url("family"))
        self.assertEqual(r.status_code, 302)
        self.assertIn(reverse("login"), r["Location"])

    def test_older_unbought_ideas_offered_again(self):
        Idea.objects.create(recipient=self.bob, author=self.bob, title="Vieux souhait", year=current_season() - 2)
        bought = Idea.objects.create(recipient=self.bob, author=self.bob, title="Déjà offert", year=current_season() - 1)
        Reservation.objects.create(idea=bought, status=Reservation.BOUGHT)
        self.login(self.bob)
        r = self.client.get(self.url("my_search"), {"q": "souhait"})
        self.assertContains(r, "Vieux souhait")
        self.assertContains(r, "Garder pour")
        self.assertNotContains(self.client.get(self.url("my_search"), {"q": "offert"}), "Déjà offert")
        old = Idea.objects.get(title="Vieux souhait")
        self.client.post(self.url("idea_keep", old.pk), {"action": "keep"}, HTTP_HX_REQUEST="true")
        old.refresh_from_db()
        self.assertEqual(old.year, current_season())


class ReservationTests(Base):
    def setUp(self):
        super().setUp()
        self.idea = Idea.objects.create(recipient=self.bob, author=self.bob, title="Casque audio")

    def post(self, action, member):
        self.login(member)
        return self.client.post(self.url("reservation", self.idea.pk, action), HTTP_HX_REQUEST="true")

    def test_full_flow(self):
        self.assertEqual(self.post("reserve", self.alice).status_code, 200)
        self.assertEqual(self.idea.reservation.owner, self.alice)
        # quelqu'un d'autre ne peut pas « voler » la réservation
        self.post("reserve", self.isa)
        self.idea.refresh_from_db()
        self.assertEqual(self.idea.reservation.owner, self.alice)
        # participation à plusieurs
        self.post("join", self.isa)
        self.assertTrue(self.idea.reservation.participants.filter(pk=self.isa.pk).exists())
        self.post("bought", self.alice)
        self.idea.reservation.refresh_from_db()
        self.assertTrue(self.idea.reservation.is_bought)
        # l'organisatrice annule : la participante devient responsable
        self.post("release", self.alice)
        self.idea.refresh_from_db()
        self.assertEqual(self.idea.reservation.owner, self.isa)

    def test_recipient_cannot_reserve(self):
        self.assertEqual(self.post("reserve", self.bob).status_code, 403)

    def test_cannot_release_someone_elses(self):
        self.post("reserve", self.isa)
        self.assertEqual(self.post("release", self.fred).status_code, 403)

    def test_reservations_page(self):
        self.post("reserve", self.alice)
        r = self.client.get(self.url("reservations"))
        self.assertContains(r, "Casque audio")


class IdeaCrudTests(Base):
    def test_add_and_edit_and_delete(self):
        self.login(self.bob)
        r = self.client.post(self.url("idea_add", self.bob.pk), {"title": "Des gants", "url": "exemple.fr/gants"},
                             HTTP_HX_REQUEST="true")
        self.assertEqual(r.status_code, 200)
        idea = Idea.objects.get(title="Des gants")
        self.assertEqual(idea.url, "https://exemple.fr/gants")
        self.assertFalse(idea.is_surprise)
        r = self.client.post(self.url("idea_edit", idea.pk), {"title": "Des gants chauds"}, HTTP_HX_REQUEST="true")
        self.assertContains(r, "Des gants chauds")
        self.client.post(self.url("idea_delete", idea.pk), HTTP_HX_REQUEST="true")
        self.assertFalse(Idea.objects.filter(pk=idea.pk).exists())

    def test_cannot_delete_others_suggestion(self):
        idea = Idea.objects.create(recipient=self.bob, author=self.isa, title="Surprise")
        self.login(self.fred)
        self.assertEqual(self.client.post(self.url("idea_delete", idea.pk)).status_code, 403)
        self.login(self.bob)  # même la personne concernée ne peut pas la supprimer
        self.assertEqual(self.client.post(self.url("idea_delete", idea.pk)).status_code, 403)

    def test_suggestion_is_surprise(self):
        self.login(self.alice)
        self.client.post(self.url("idea_add", self.bob.pk), {"title": "Parfum"}, HTTP_HX_REQUEST="true")
        self.assertTrue(Idea.objects.get(title="Parfum").is_surprise)


class SecretSantaTests(TestCase):
    def test_respects_households_and_is_a_permutation(self):
        people = list(range(1, 10))
        houses = {1: "a", 2: "a", 3: "b", 4: "b", 5: "c", 6: None, 7: None, 8: "d", 9: "d"}
        for seed in range(200):
            res = secret_santa.draw(people, houses, seed=seed)
            givers = [g for g, _ in res.pairs]
            receivers = [r for _, r in res.pairs]
            self.assertEqual(sorted(givers), people)
            self.assertEqual(sorted(receivers), people)
            for g, r in res.pairs:
                self.assertNotEqual(g, r)
                if houses[g] is not None:
                    self.assertNotEqual(houses[g], houses[r])

    def test_avoids_last_year(self):
        people = [1, 2, 3, 4, 5]
        previous = {(1, 2), (2, 3), (3, 4), (4, 5), (5, 1)}
        for seed in range(50):
            res = secret_santa.draw(people, {}, previous, seed=seed)
            self.assertFalse(set(res.pairs) & previous)
            self.assertEqual(res.relaxed, [])

    def test_impossible(self):
        with self.assertRaises(secret_santa.DrawImpossible):
            secret_santa.draw([1, 2, 3], {1: "x", 2: "x", 3: "y"})


class DrawViewTests(Base):
    def test_admin_draws_and_each_sees_only_own(self):
        self.login(self.alice)
        r = self.client.post(self.url("draws"), {
            "title": "Amis secrets", "budget": "30 €",
            "participants": [m.pk for m in (self.alice, self.bob, self.isa, self.fred)],
        })
        self.assertEqual(r.status_code, 302)
        draw = Draw.objects.get()
        self.assertEqual(draw.assignments.count(), 4)
        mine = Assignment.objects.get(draw=draw, giver=self.bob)
        self.login(self.bob)
        html = self.client.get(self.url("draws")).content.decode()
        self.assertIn(mine.receiver.name, html)
        self.assertEqual(html.count("Vous offrez à"), 1)

    def test_non_admin_cannot_draw(self):
        self.login(self.bob)
        r = self.client.post(self.url("draws"), {"title": "x", "participants": [self.bob.pk, self.alice.pk]})
        self.assertEqual(r.status_code, 403)


class AccountTests(Base):
    def test_case_insensitive_login(self):
        self.assertTrue(self.client.login(username="alice", password="motdepasse"))

    def test_signup_with_invite_and_claim_profile(self):
        kid = Member.objects.create(family=self.family, name="Fabian")
        r = self.client.post(reverse("signup", args=[self.family.invite_code]), {
            "username": "Fabian", "password1": "sapin2026!", "password2": "sapin2026!", "claim": kid.pk,
        })
        self.assertEqual(r.status_code, 302)
        kid.refresh_from_db()
        self.assertEqual(kid.user.username, "Fabian")

    def test_bad_invite_404(self):
        self.assertEqual(self.client.get(reverse("signup", args=["nope"])).status_code, 404)

    def test_admin_reset_link(self):
        self.login(self.alice)
        r = self.client.post(self.url("manage"), {"action": "reset_link", "id": self.bob.pk})
        self.assertContains(r, "/reinitialiser/")

    def test_non_admin_cannot_manage(self):
        self.login(self.bob)
        self.assertEqual(self.client.get(self.url("manage")).status_code, 403)


class ImportTests(TestCase):
    def test_import_old_database(self):
        tmp = Path(tempfile.mkdtemp()) / "old.sqlite3"
        c = sqlite3.connect(tmp)
        c.executescript("""
            create table ideecadeaux_customuser (id integer primary key, username text, password text,
                is_staff bool, is_superuser bool, is_active bool, last_login text);
            create table ideecadeaux_bloc (id integer primary key, titre text, groupenumber int);
            create table ideecadeaux_detail (id integer primary key, bloc_id int, details text);
            create table ideecadeaux_ideecadeau (id integer primary key, detail_id int, idee_cadeau text, fait bool, "année" int);
            create table ideecadeaux_boucleamissecrets (id integer primary key, utilisateur_id int, titre_boucle text);
            create table ideecadeaux_detailboucle (id integer primary key, titre_bloc text, ami_secret text, boucle_amis_secrets_id int);
            insert into ideecadeaux_customuser values (1,'Edmond','pbkdf2_sha256$1$x$y',0,0,1,'2024-11-26 13:07:41');
            insert into ideecadeaux_customuser values (2,'Isabelle','pbkdf2_sha256$1$x$y',0,0,1,null);
            insert into ideecadeaux_bloc values (1,'Edmond',4),(2,'Isabelle',1),(3,'Frederic',1);
            insert into ideecadeaux_detail values (1,1,''),(2,2,''),(3,3,'');
            insert into ideecadeaux_ideecadeau values (1,1,'Corde escalade',1,2023),(2,2,'Un livre',0,2024),
                (3,3,'Un texte très long ' || hex(randomblob(80)),0,2024);
            insert into ideecadeaux_boucleamissecrets values (1,1,'essai');
            insert into ideecadeaux_detailboucle values (1,'Edmond','Isabelle',1),(2,'Isabelle','Edmond',1);
        """)
        c.commit(); c.close()
        for _ in range(2):  # relançable sans doublon
            call_command("import_ancien_site", str(tmp), famille="Famille", admin=["Edmond"], verbosity=0)
        fam = Family.objects.get(name="Famille")
        self.assertEqual(fam.members.count(), 3)
        self.assertEqual(Idea.objects.count(), 3)
        self.assertEqual(Reservation.objects.filter(status=Reservation.BOUGHT).count(), 1)
        self.assertTrue(fam.members.get(name="Edmond").is_admin)
        self.assertEqual(Household.objects.get().members.count(), 2)
        self.assertEqual(Assignment.objects.count(), 2)
        self.assertEqual(User.objects.get(username="Edmond").password, "pbkdf2_sha256$1$x$y")
        self.assertIsNone(fam.members.get(name="Frederic").user)
        self.assertLessEqual(len(Idea.objects.get(recipient__name="Frederic").title), 112)
