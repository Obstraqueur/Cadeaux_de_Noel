"""Qui voit quoi. Toutes les règles qui protègent la surprise sont ici.

- La personne concernée ne voit PAS sa propre liste : le but est qu'elle oublie ce
  qu'elle a demandé pour être surprise. Elle peut seulement retrouver une de ses
  idées par la recherche (`search_own`) pour la corriger ou la supprimer.
  La recherche ne porte que sur les idées qu'elle a écrites (ou que ses
  « gestionnaires », par exemple ses parents, ont écrites pour elle) : jamais
  les suggestions surprises, jamais les réservations.
- Tous les autres membres de la famille voient toutes les idées et qui s'en occupe.
"""

from django.core.exceptions import PermissionDenied
from django.db.models import Q

from .models import Idea, Member, current_season


def viewer_for(family, user):
    """Le membre correspondant à l'utilisateur dans cette famille, sinon 403."""
    member = family.members.filter(user=user).first()
    if member is None:
        raise PermissionDenied("Vous ne faites pas partie de cette famille.")
    return member


def is_owner_view(recipient, user):
    """Vue « ma liste » : la personne regarde sa propre liste."""
    return recipient.user_id is not None and recipient.user_id == user.id


def _not_surprise_q(recipient):
    manager_ids = list(recipient.managers.values_list("pk", flat=True))
    return Q(author_id=recipient.pk) | Q(author__user_id__in=manager_ids)


def _base(recipient, include_archived=False):
    qs = Idea.objects.filter(recipient=recipient)
    if not include_archived:
        qs = qs.filter(archived=False)
    return (
        qs
        .select_related("author", "reservation", "reservation__owner")
        .prefetch_related("reservation__participants")
    )


def ideas_for_owner(recipient):
    season = current_season()
    qs = _base(recipient).filter(_not_surprise_q(recipient))
    current = qs.filter(year__gte=season)
    # Idées des années passées qui n'ont pas été offertes : « toujours d'actualité ? »
    older = qs.filter(year__lt=season, reservation__isnull=True)
    return current, older


def ideas_for_others(recipient):
    season = current_season()
    qs = _base(recipient, include_archived=True)
    # Une idée retirée par la personne mais déjà réservée reste visible pour les autres
    # (le cadeau est peut-être déjà acheté).
    qs = qs.filter(Q(archived=False) | Q(reservation__isnull=False))
    current = qs.filter(year__gte=season)
    older = qs.filter(year__lt=season, reservation__isnull=True)
    return current, older


def own_ideas(recipient):
    """Les idées de la personne qu'elle a le droit de retrouver par la recherche."""
    season = current_season()
    return _base(recipient).filter(_not_surprise_q(recipient)).filter(
        Q(year__gte=season) | Q(reservation__isnull=True)
    )


def own_count(recipient):
    return _base(recipient).filter(_not_surprise_q(recipient), year__gte=current_season()).count()


def search_own(recipient, query):
    query = (query or "").strip()
    if len(query) < 2:
        return Idea.objects.none()
    return own_ideas(recipient).filter(Q(title__icontains=query) | Q(details__icontains=query)).order_by(
        "-year", "-created_at"
    )[:20]


def can_see_reservations(recipient, user):
    return not is_owner_view(recipient, user)


def surprise_ids(recipient, ideas):
    """Ensemble des ids d'idées suggérées par d'autres (affichées avec un badge)."""
    manager_user_ids = set(recipient.managers.values_list("pk", flat=True))
    out = set()
    for idea in ideas:
        if idea.author_id == recipient.pk:
            continue
        if idea.author is not None and idea.author.user_id in manager_user_ids:
            continue
        out.add(idea.pk)
    return out


def members_overview(family, viewer):
    """Pour l'accueil : chaque membre avec le nombre d'idées encore libres."""
    season = current_season()
    members = list(family.members.select_related("household").order_by("name"))
    counts = {}
    for idea in Idea.objects.filter(recipient__family=family, archived=False, year__gte=season).values(
        "recipient_id", "reservation__id"
    ):
        total, free = counts.get(idea["recipient_id"], (0, 0))
        counts[idea["recipient_id"]] = (total + 1, free + (1 if idea["reservation__id"] is None else 0))
    for m in members:
        m.total_ideas, m.free_ideas = counts.get(m.pk, (0, 0))
    return members


def managed_members(family, user):
    return Member.objects.filter(family=family, managers=user).exclude(user=user)
