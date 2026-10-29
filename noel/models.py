"""Modèle de données.

    Famille ─┬─ Foyer (couple, frères et sœurs… : on ne se tire pas entre soi)
             ├─ Membre (une personne ; avec ou sans compte, éventuellement gérée par un parent)
             │    └─ Idée (sur la liste d'un membre, écrite par lui ou suggérée par un proche)
             │         └─ Réservation (qui s'en occupe, avec d'éventuels participants)
             ├─ Tirage d'amis secrets (1 à 3 boucles) ── Attribution (qui offre à qui)
             └─ Calendrier de l'Avent (une case par jour)

Les règles de visibilité (surprise préservée) sont regroupées dans `noel/visibility.py`.
"""

import secrets

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.urls import reverse
from django.utils import timezone
from django.utils.text import slugify


def current_season():
    """L'année de Noël en cours."""
    return timezone.localdate().year


def new_invite_code():
    return secrets.token_urlsafe(9)


class User(AbstractUser):
    """Compte de connexion. On se connecte avec son prénom (insensible à la casse)."""

    class Meta:
        verbose_name = "compte"


class Family(models.Model):
    name = models.CharField("nom", max_length=80)
    slug = models.SlugField(unique=True, max_length=90)
    invite_code = models.CharField("code d'invitation", max_length=32, unique=True, default=new_invite_code)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "famille"
        ordering = ["name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name) or "famille"
            slug, i = base, 2
            while Family.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug, i = f"{base}-{i}", i + 1
            self.slug = slug
        super().save(*args, **kwargs)

    def get_absolute_url(self):
        return reverse("family", args=[self.slug])


class Household(models.Model):
    family = models.ForeignKey(Family, on_delete=models.CASCADE, related_name="households")
    name = models.CharField("nom", max_length=80)

    class Meta:
        verbose_name = "foyer"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Member(models.Model):
    family = models.ForeignKey(Family, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="memberships"
    )
    name = models.CharField("prénom", max_length=60)
    household = models.ForeignKey(
        Household, on_delete=models.SET_NULL, null=True, blank=True, related_name="members", verbose_name="foyer"
    )
    is_admin = models.BooleanField("organisateur", default=False)
    managers = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="managed_members",
        verbose_name="géré par",
        help_text="Pour un enfant ou une personne sans compte : qui peut tenir sa liste.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "membre"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["family", "user"], condition=models.Q(user__isnull=False), name="un_membre_par_compte"
            )
        ]

    def __str__(self):
        return self.name

    def get_absolute_url(self):
        return reverse("member", args=[self.family.slug, self.pk])

    @property
    def initials(self):
        parts = [p for p in self.name.replace("-", " ").split() if p]
        return "".join(p[0] for p in parts[:2]).upper() or "?"

    @property
    def hue(self):
        """Teinte stable dérivée du prénom, pour l'avatar."""
        return sum(ord(c) * (i + 1) for i, c in enumerate(self.name)) % 360

    def is_self(self, user):
        return user.is_authenticated and self.user_id == user.id

    def can_edit_list(self, user):
        if not user.is_authenticated:
            return False
        if self.user_id == user.id:
            return True
        return self.managers.filter(pk=user.pk).exists()


class Idea(models.Model):
    recipient = models.ForeignKey(Member, on_delete=models.CASCADE, related_name="ideas", verbose_name="pour")
    author = models.ForeignKey(
        Member, on_delete=models.SET_NULL, null=True, blank=True, related_name="authored_ideas", verbose_name="proposée par"
    )
    title = models.CharField("idée", max_length=200)
    details = models.TextField("précisions", blank=True)
    url = models.URLField("lien", max_length=500, blank=True)
    price = models.CharField("prix indicatif", max_length=40, blank=True)
    preview_image = models.URLField("image du produit", max_length=800, blank=True,
                                    help_text="Trouvée automatiquement à partir du lien.")
    favorite = models.BooleanField("j'en rêve", default=False)
    year = models.PositiveIntegerField("année", default=current_season)
    archived = models.BooleanField("retirée", default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "idée"
        ordering = ["-favorite", "-year", "-created_at"]

    def __str__(self):
        return self.title

    @property
    def is_surprise(self):
        """Suggestion d'un proche : invisible pour la personne concernée.

        Une idée sans auteur connu (reprise de l'ancien site) est traitée comme une
        surprise : l'ancien site ne permettait pas de savoir qui l'avait écrite.
        """
        if self.author_id is None:
            return True
        if self.author_id == self.recipient_id:
            return False
        author_user = self.author.user_id
        return not (author_user and self.recipient.managers.filter(pk=author_user).exists())

    @property
    def reservation_or_none(self):
        try:
            return self.reservation
        except Reservation.DoesNotExist:
            return None


class Reservation(models.Model):
    RESERVED, BOUGHT = "reserved", "bought"
    STATUS = [(RESERVED, "Je m'en occupe"), (BOUGHT, "Acheté")]

    idea = models.OneToOneField(Idea, on_delete=models.CASCADE, related_name="reservation")
    owner = models.ForeignKey(
        Member, on_delete=models.SET_NULL, null=True, blank=True, related_name="reservations", verbose_name="par"
    )
    participants = models.ManyToManyField(Member, blank=True, related_name="contributions")
    status = models.CharField(max_length=10, choices=STATUS, default=RESERVED)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "réservation"

    def __str__(self):
        return f"{self.idea} → {self.owner or 'quelqu’un'}"

    @property
    def is_bought(self):
        return self.status == self.BOUGHT

    def involves(self, member):
        return member is not None and (
            self.owner_id == member.pk or self.participants.filter(pk=member.pk).exists()
        )


class Draw(models.Model):
    family = models.ForeignKey(Family, on_delete=models.CASCADE, related_name="draws")
    title = models.CharField("nom du tirage", max_length=100)
    year = models.PositiveIntegerField("année", default=current_season)
    budget = models.CharField("budget conseillé", max_length=40, blank=True)
    rounds = models.PositiveSmallIntegerField(
        "amis secrets par personne", default=1,
        help_text="Nombre de boucles : chacun offre à autant de personnes différentes.",
    )
    created_by = models.ForeignKey(Member, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "tirage d'amis secrets"
        verbose_name_plural = "tirages d'amis secrets"
        ordering = ["-year", "-created_at"]

    def __str__(self):
        return f"{self.title} ({self.year})"


class Assignment(models.Model):
    draw = models.ForeignKey(Draw, on_delete=models.CASCADE, related_name="assignments")
    round = models.PositiveSmallIntegerField("boucle", default=1)
    giver = models.ForeignKey(Member, on_delete=models.CASCADE, related_name="gives_to")
    receiver = models.ForeignKey(Member, on_delete=models.CASCADE, related_name="receives_from")

    class Meta:
        verbose_name = "attribution"
        ordering = ["round"]
        constraints = [
            models.UniqueConstraint(fields=["draw", "round", "giver"], name="un_cadeau_par_personne_et_boucle"),
            models.UniqueConstraint(fields=["draw", "round", "receiver"], name="un_ami_secret_par_personne_et_boucle"),
            models.UniqueConstraint(fields=["draw", "giver", "receiver"], name="pas_deux_fois_la_meme_personne"),
        ]

    def __str__(self):
        return f"{self.giver} → {self.receiver}"


def advent_upload_to(instance, filename):
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "png").lower()
    return f"avent/{instance.family_id}/{instance.date:%Y-%m-%d}-{secrets.token_hex(4)}.{ext}"


class AdventDay(models.Model):
    """Une case du calendrier de l'Avent : une image « porte » et une image (ou un texte) à l'intérieur.

    Une case ne s'ouvre qu'à partir de son jour : les images sont servies par une vue
    qui vérifie la date (impossible de tricher en devinant l'adresse).
    """

    family = models.ForeignKey(Family, on_delete=models.CASCADE, related_name="advent_days")
    date = models.DateField("jour")
    title = models.CharField("titre", max_length=120, blank=True)
    cover = models.FileField("image de la porte", upload_to=advent_upload_to, blank=True)
    inside = models.FileField("image à l'intérieur", upload_to=advent_upload_to, blank=True)
    text = models.TextField("texte à l'intérieur", blank=True)

    class Meta:
        verbose_name = "case du calendrier de l'Avent"
        verbose_name_plural = "calendrier de l'Avent"
        ordering = ["date"]
        constraints = [models.UniqueConstraint(fields=["family", "date"], name="une_case_par_jour")]

    def __str__(self):
        return f"{self.date:%d/%m/%Y} {self.title}".strip()

    def is_open(self, today=None):
        return self.date <= (today or timezone.localdate())
