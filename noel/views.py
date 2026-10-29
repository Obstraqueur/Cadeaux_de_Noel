import json

from django.contrib import messages
from django.contrib.auth import login, update_session_auth_hash
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import PasswordChangeForm
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from django.views.decorators.http import require_POST

from . import secret_santa, visibility
from .forms import (
    AccountForm,
    DrawForm,
    FamilyForm,
    HouseholdForm,
    IdeaForm,
    JoinForm,
    MemberForm,
    NewProfileForm,
    SignupForm,
)
from .models import Assignment, Draw, Family, Household, Idea, Member, Reservation, current_season


# --------------------------------------------------------------------------- utilitaires

def is_htmx(request):
    return request.headers.get("HX-Request") == "true"


def toast(response, text, kind="ok", **events):
    payload = {"toast": {"text": text, "kind": kind}}
    payload.update(events)
    response["HX-Trigger"] = json.dumps(payload)
    return response


def family_and_viewer(request, slug):
    family = get_object_or_404(Family, slug=slug)
    viewer = visibility.viewer_for(family, request.user)
    return family, viewer


def require_admin(viewer):
    if not viewer.is_admin:
        raise PermissionDenied("Réservé aux organisateurs de la famille.")


def days_until_christmas():
    today = timezone.localdate()
    xmas = today.replace(month=12, day=25)
    if today > xmas:
        xmas = xmas.replace(year=today.year + 1)
    return (xmas - today).days


def can_edit_idea(idea, viewer, user):
    if viewer.is_admin:
        return True
    if idea.author_id == viewer.pk:
        return True
    # La personne concernée (ou ses parents) peut modifier les idées de sa liste qui ne sont pas des surprises.
    return idea.recipient.can_edit_list(user) and not idea.is_surprise


def idea_context(idea, viewer, user):
    recipient = idea.recipient
    owner_view = visibility.is_owner_view(recipient, user)
    res = idea.reservation_or_none if not owner_view else None
    return {
        "idea": idea,
        "family": recipient.family,
        "viewer": viewer,
        "owner_view": owner_view,
        "res": res,
        "mine": bool(res and res.owner_id == viewer.pk),
        "participating": bool(res and res.participants.filter(pk=viewer.pk).exists()),
        "can_edit": can_edit_idea(idea, viewer, user),
        "surprise": (not owner_view) and idea.is_surprise,
        "season": current_season(),
    }


def render_idea(request, idea, viewer, message=None):
    resp = render(request, "noel/partials/idea.html", idea_context(idea, viewer, request.user))
    return toast(resp, message) if message else resp


# --------------------------------------------------------------------------- accueil & comptes

@login_required
def home(request):
    families = Family.objects.filter(members__user=request.user).distinct()
    if families.count() == 1 and not request.GET.get("toutes"):
        return redirect(families.first())
    return render(request, "noel/home.html", {
        "families": families,
        "join_form": JoinForm(),
        "family_form": FamilyForm(),
    })


@login_required
@require_POST
def join(request):
    form = JoinForm(request.POST)
    if form.is_valid():
        code = form.cleaned_data["code"].strip().split("/")[-1] or form.cleaned_data["code"].strip()
        family = Family.objects.filter(invite_code=code).first()
        if family:
            member, created = Member.objects.get_or_create(
                family=family, user=request.user, defaults={"name": request.user.username}
            )
            messages.success(request, f"Bienvenue dans {family.name} !")
            return redirect(family)
    messages.error(request, "Ce code d'invitation n'existe pas.")
    return redirect("home")


@login_required
@require_POST
def create_family(request):
    form = FamilyForm(request.POST)
    if form.is_valid():
        with transaction.atomic():
            family = Family.objects.create(name=form.cleaned_data["name"])
            Member.objects.create(family=family, user=request.user, name=request.user.username, is_admin=True)
        messages.success(request, "Famille créée. Partagez le lien d'invitation depuis « Gestion ».")
        return redirect(family)
    messages.error(request, "Donnez un nom à la famille.")
    return redirect("home")


def signup(request, code):
    family = get_object_or_404(Family, invite_code=code)
    if request.user.is_authenticated:
        Member.objects.get_or_create(family=family, user=request.user, defaults={"name": request.user.username})
        return redirect(family)
    form = SignupForm(request.POST or None, family=family)
    if request.method == "POST" and form.is_valid():
        with transaction.atomic():
            user = form.save()
            claimed = form.cleaned_data.get("claim")
            if claimed and claimed.user_id is None:
                claimed.user = user
                claimed.save(update_fields=["user"])
            else:
                Member.objects.create(family=family, user=user, name=user.username)
        login(request, user, backend="noel.auth.CaseInsensitiveModelBackend")
        messages.success(request, "Compte créé ! Commencez par remplir votre liste.")
        return redirect(family)
    return render(request, "registration/signup.html", {"form": form, "family": family})


@login_required
def account(request):
    memberships = list(request.user.memberships.all())
    info = AccountForm(
        request.POST if "save_info" in request.POST else None,
        initial={"name": memberships[0].name if memberships else request.user.username, "email": request.user.email},
    )
    pwd = PasswordChangeForm(request.user, request.POST if "save_pwd" in request.POST else None)
    for f in pwd.fields.values():
        f.widget.attrs["class"] = "input"
    pwd.fields["old_password"].label = "Mot de passe actuel"
    pwd.fields["new_password1"].label = "Nouveau mot de passe"
    pwd.fields["new_password1"].help_text = ""
    pwd.fields["new_password2"].label = "Confirmation"
    if request.method == "POST":
        if "save_info" in request.POST and info.is_valid():
            request.user.email = info.cleaned_data["email"]
            request.user.save(update_fields=["email"])
            request.user.memberships.update(name=info.cleaned_data["name"])
            messages.success(request, "Profil mis à jour.")
            return redirect("account")
        if "save_pwd" in request.POST and pwd.is_valid():
            user = pwd.save()
            update_session_auth_hash(request, user)
            messages.success(request, "Mot de passe modifié.")
            return redirect("account")
    return render(request, "noel/account.html", {"info": info, "pwd": pwd})


# --------------------------------------------------------------------------- famille

@login_required
def family(request, slug):
    family, viewer = family_and_viewer(request, slug)
    members = visibility.members_overview(family, viewer)
    me = next((m for m in members if m.pk == viewer.pk), viewer)
    managed = [m for m in members if m.pk in set(visibility.managed_members(family, request.user).values_list("pk", flat=True))]
    others = [m for m in members if m.pk != viewer.pk]

    season = current_season()
    my_assignments = (
        Assignment.objects.filter(draw__family=family, draw__year=season)
        .filter(Q(giver=viewer) | Q(giver__in=managed))
        .select_related("draw", "giver", "receiver")
        .order_by("draw__created_at", "giver__name", "round")
    )
    santa_groups = {}
    for a in my_assignments:
        g = santa_groups.setdefault((a.draw_id, a.giver_id), {"draw": a.draw, "giver": a.giver, "receivers": []})
        g["receivers"].append(a.receiver)
    my_res = Reservation.objects.filter(
        Q(owner=viewer) | Q(participants=viewer), idea__recipient__family=family, idea__year__gte=season
    ).distinct()
    my_ideas_count = Idea.objects.filter(recipient=viewer, author=viewer, archived=False, year__gte=season).count()

    return render(request, "noel/family.html", {
        "family": family,
        "viewer": viewer,
        "me": me,
        "managed": managed,
        "others": others,
        "santa_groups": list(santa_groups.values()),
        "res_total": my_res.count(),
        "res_todo": my_res.exclude(status=Reservation.BOUGHT).count(),
        "my_ideas_count": my_ideas_count,
        "days": days_until_christmas(),
        "season": season,
    })


@login_required
def member(request, slug, member_id):
    family, viewer = family_and_viewer(request, slug)
    recipient = get_object_or_404(Member.objects.select_related("household"), pk=member_id, family=family)
    owner_view = visibility.is_owner_view(recipient, request.user)
    can_add_own = recipient.can_edit_list(request.user)

    if owner_view:
        current, older = visibility.ideas_for_owner(recipient)
    else:
        current, older = visibility.ideas_for_others(recipient)

    def ctx_list(qs):
        return [idea_context(i, viewer, request.user) for i in qs]

    current_items = ctx_list(current)
    available = [c for c in current_items if not c["res"]]
    taken = [c for c in current_items if c["res"]]

    santa_for = None
    if not owner_view:
        santa_for = Assignment.objects.filter(
            draw__family=family, draw__year=current_season(), giver=viewer, receiver=recipient
        ).select_related("draw").first()

    return render(request, "noel/member.html", {
        "family": family,
        "viewer": viewer,
        "recipient": recipient,
        "owner_view": owner_view,
        "can_add_own": can_add_own,
        "items": current_items if owner_view else available,
        "taken": [] if owner_view else taken,
        "older": [] if owner_view else ctx_list(older),
        "own_count": visibility.own_count(recipient) if owner_view else 0,
        "review": list(older) if owner_view else [],
        "form": IdeaForm(),
        "season": current_season(),
        "santa_for": santa_for,
    })


@login_required
@require_POST
def idea_add(request, slug, member_id):
    family, viewer = family_and_viewer(request, slug)
    recipient = get_object_or_404(Member, pk=member_id, family=family)
    form = IdeaForm(request.POST)
    if not form.is_valid():
        resp = render(request, "noel/partials/idea_form.html", {
            "form": form, "family": family, "recipient": recipient,
            "owner_view": visibility.is_owner_view(recipient, request.user),
        })
        resp["HX-Retarget"] = "#idea-form"
        resp["HX-Reswap"] = "outerHTML"
        return resp
    idea = form.save(commit=False)
    idea.recipient = recipient
    # Une idée écrite par un gestionnaire (parent) n'est pas une surprise : voir Idea.is_surprise.
    idea.author = viewer
    idea.save()
    if is_htmx(request) and visibility.is_owner_view(recipient, request.user):
        # Sa propre liste reste cachée : on confirme sans afficher l'idée.
        resp = toast(HttpResponse(""), f"« {idea.title[:50]} » est dans votre liste. Vous pouvez l'oublier 🎁",
                     **{"count-changed": True, "idea-added": True})
        resp["HX-Reswap"] = "none"
        return resp
    if is_htmx(request):
        msg = "Idée ajoutée" if recipient.pk == viewer.pk else (
            f"Suggestion ajoutée — {recipient.name} ne la verra pas" if idea.is_surprise else "Idée ajoutée"
        )
        resp = render_idea(request, idea, viewer, msg)
        resp["HX-Trigger-After-Swap"] = "idea-added"
        return resp
    return redirect(recipient)


@login_required
def idea_edit(request, slug, idea_id):
    family, viewer = family_and_viewer(request, slug)
    idea = get_object_or_404(Idea.objects.select_related("recipient", "author"), pk=idea_id, recipient__family=family)
    if not can_edit_idea(idea, viewer, request.user):
        raise PermissionDenied
    # « Toujours d'actualité ? » → Modifier : l'idée est corrigée puis rangée dans la liste de l'année.
    renew = bool(request.GET.get("renew") or request.POST.get("renew"))
    if request.method == "POST":
        if "cancel" in request.POST:
            if renew:
                return render(request, "noel/partials/review_item.html", {"idea": idea, "family": family})
            return render_idea(request, idea, viewer)
        form = IdeaForm(request.POST, instance=idea)
        if form.is_valid():
            idea = form.save(commit=False)
            if renew:
                idea.year = current_season()
            idea.save()
            if is_htmx(request):
                if renew:
                    return toast(HttpResponse(""), f"Modifiée et rangée dans votre liste {idea.year}",
                                 **{"count-changed": True})
                return render_idea(request, idea, viewer, "Idée modifiée")
            return redirect(idea.recipient)
    else:
        form = IdeaForm(instance=idea)
    return render(request, "noel/partials/idea_edit.html", {
        "form": form, "idea": idea, "family": family, "renew": renew, "season": current_season(),
    })


@login_required
@require_POST
def idea_delete(request, slug, idea_id):
    family, viewer = family_and_viewer(request, slug)
    idea = get_object_or_404(Idea, pk=idea_id, recipient__family=family)
    if not can_edit_idea(idea, viewer, request.user):
        raise PermissionDenied
    recipient = idea.recipient
    res = idea.reservation_or_none
    if res is not None and not res.involves(viewer):
        # Quelqu'un s'en occupe déjà (peut-être déjà acheté) : on la retire de la liste
        # sans la faire disparaître pour lui. La personne ne l'apprend pas : même message.
        idea.archived = True
        idea.save(update_fields=["archived", "updated_at"])
    else:
        idea.delete()
    if is_htmx(request):
        return toast(HttpResponse(""), "Idée supprimée", **{"count-changed": True})
    return redirect(recipient)


@login_required
@require_POST
def idea_keep(request, slug, idea_id):
    """« Toujours d'actualité » : une idée d'une année passée revient dans la liste de cette année."""
    family, viewer = family_and_viewer(request, slug)
    idea = get_object_or_404(Idea, pk=idea_id, recipient__family=family)
    if not (idea.recipient.can_edit_list(request.user) or viewer.is_admin or idea.author_id == viewer.pk):
        raise PermissionDenied
    action = request.POST.get("action")
    if action == "keep":
        idea.year = current_season()
        idea.save(update_fields=["year", "updated_at"])
        msg = f"Rangée dans votre liste {idea.year}"
        if is_htmx(request) and request.POST.get("from") == "review":
            return toast(HttpResponse(""), msg, **{"count-changed": True})
        if is_htmx(request):
            idea = Idea.objects.select_related("recipient", "author").get(pk=idea.pk)
            resp = render_idea(request, idea, viewer)
            return toast(resp, msg, **{"count-changed": True})
    else:
        idea.archived = True
        idea.save(update_fields=["archived", "updated_at"])
        msg = "Idée retirée"
    if is_htmx(request):
        return toast(HttpResponse(""), msg)
    return redirect(idea.recipient)


@login_required
@require_POST
def reservation_action(request, slug, idea_id, action):
    family, viewer = family_and_viewer(request, slug)
    with transaction.atomic():
        idea = get_object_or_404(Idea.objects.select_for_update().select_related("recipient"), pk=idea_id,
                                 recipient__family=family)
        if visibility.is_owner_view(idea.recipient, request.user):
            raise PermissionDenied("On ne réserve pas ses propres cadeaux 😉")
        res = idea.reservation_or_none
        msg = None
        if action == "reserve":
            if res is None:
                Reservation.objects.create(idea=idea, owner=viewer)
                msg = "C'est noté, vous vous en occupez"
            else:
                msg = f"Déjà pris par {res.owner or 'quelqu’un'}"
        elif res is None:
            msg = "Cette idée n'est plus réservée"
        elif action == "release":
            if res.owner_id == viewer.pk or viewer.is_admin or res.owner_id is None:
                next_owner = res.participants.first()
                if next_owner:
                    res.owner = next_owner
                    res.participants.remove(next_owner)
                    res.save()
                else:
                    res.delete()
                msg = "Réservation annulée"
            else:
                raise PermissionDenied
        elif action == "bought":
            if not (res.involves(viewer) or viewer.is_admin):
                raise PermissionDenied
            res.status = Reservation.RESERVED if res.is_bought else Reservation.BOUGHT
            res.save(update_fields=["status", "updated_at"])
            msg = "Marqué comme acheté 🎁" if res.is_bought else "Remis à « je m'en occupe »"
        elif action == "join":
            if res.owner_id != viewer.pk:
                res.participants.add(viewer)
                msg = "Vous participez à ce cadeau"
        elif action == "leave":
            res.participants.remove(viewer)
            msg = "Vous ne participez plus"
        idea = Idea.objects.select_related("recipient", "author").get(pk=idea.pk)

    if is_htmx(request):
        if request.POST.get("context") == "reservations":
            ctx = idea_context(idea, viewer, request.user)
            return toast(render(request, "noel/partials/reservation_row.html", ctx), msg or "OK")
        return render_idea(request, idea, viewer, msg)
    if msg:
        messages.info(request, msg)
    return redirect(request.POST.get("next") or idea.recipient.get_absolute_url())


@login_required
def my_reservations(request, slug):
    family, viewer = family_and_viewer(request, slug)
    ideas = (
        Idea.objects.filter(recipient__family=family, year__gte=current_season())
        .filter(Q(reservation__owner=viewer) | Q(reservation__participants=viewer))
        .select_related("recipient", "author", "reservation", "reservation__owner")
        .prefetch_related("reservation__participants")
        .distinct()
        .order_by("recipient__name", "title")
    )
    rows = [idea_context(i, viewer, request.user) for i in ideas]
    todo = [r for r in rows if not r["res"].is_bought]
    done = [r for r in rows if r["res"].is_bought]
    return render(request, "noel/reservations.html", {
        "family": family, "viewer": viewer, "todo": todo, "done": done,
    })


# --------------------------------------------------------------------------- amis secrets

@login_required
def draws(request, slug):
    family, viewer = family_and_viewer(request, slug)
    form = DrawForm(request.POST or None, family=family,
                    initial={"title": f"Amis secrets {current_season()}", "rounds": 3,
                             "participants": family.members.all()})
    if request.method == "POST":
        require_admin(viewer)
        if form.is_valid():
            participants = list(form.cleaned_data["participants"])
            households = {m.pk: m.household_id for m in participants}
            last = Draw.objects.filter(family=family, year=current_season() - 1)
            previous = set(Assignment.objects.filter(draw__in=last).values_list("giver_id", "receiver_id"))
            try:
                result = secret_santa.draw([m.pk for m in participants], households, previous,
                                            rounds=form.cleaned_data["rounds"])
            except secret_santa.DrawImpossible as e:
                form.add_error(None, str(e))
            else:
                with transaction.atomic():
                    d = form.save(commit=False)
                    d.family, d.created_by, d.year = family, viewer, current_season()
                    d.save()
                    Assignment.objects.bulk_create(
                        [Assignment(draw=d, round=t, giver_id=g, receiver_id=r) for t, g, r in result.pairs]
                    )
                text = "Tirage effectué ! Chacun découvre son ami secret sur l'accueil."
                if result.relaxed:
                    text += " (Il a fallu assouplir : " + ", ".join(result.relaxed) + ".)"
                messages.success(request, text)
                return redirect("draws", slug=family.slug)

    managed_ids = list(visibility.managed_members(family, request.user).values_list("pk", flat=True))
    all_draws = (
        Draw.objects.filter(family=family)
        .annotate(n=Count("assignments"))
        .prefetch_related(
            Prefetch(
                "assignments",
                queryset=Assignment.objects.filter(Q(giver=viewer) | Q(giver_id__in=managed_ids)).select_related(
                    "giver", "receiver"
                ),
                to_attr="mine",
            )
        )
    )
    for d in all_draws:
        groups = {}
        for a in d.mine:
            groups.setdefault(a.giver_id, {"giver": a.giver, "receivers": []})["receivers"].append(a.receiver)
        d.mine_groups = list(groups.values())
    return render(request, "noel/draws.html", {
        "family": family, "viewer": viewer, "form": form, "draws": all_draws, "season": current_season(),
    })


@login_required
@require_POST
def draw_delete(request, slug, draw_id):
    family, viewer = family_and_viewer(request, slug)
    require_admin(viewer)
    get_object_or_404(Draw, pk=draw_id, family=family).delete()
    messages.success(request, "Tirage supprimé.")
    return redirect("draws", slug=family.slug)


# --------------------------------------------------------------------------- gestion (organisateurs)

@login_required
def manage(request, slug):
    family, viewer = family_and_viewer(request, slug)
    require_admin(viewer)
    reset_link = None

    if request.method == "POST":
        action = request.POST.get("action")
        if action == "add_household":
            f = HouseholdForm(request.POST)
            if f.is_valid():
                Household.objects.create(family=family, name=f.cleaned_data["name"])
                messages.success(request, "Foyer ajouté.")
        elif action == "delete_household":
            Household.objects.filter(family=family, pk=request.POST.get("id")).delete()
            messages.success(request, "Foyer supprimé.")
        elif action == "add_profile":
            f = NewProfileForm(request.POST, family=family)
            if f.is_valid():
                m = Member.objects.create(family=family, name=f.cleaned_data["name"],
                                          household=f.cleaned_data["household"])
                m.managers.add(request.user)
                messages.success(request, f"Profil « {m.name} » créé. Vous pouvez tenir sa liste.")
        elif action == "update_member":
            m = get_object_or_404(Member, family=family, pk=request.POST.get("id"))
            f = MemberForm(request.POST, instance=m, family=family, prefix=f"m{m.pk}")
            if f.is_valid():
                f.save()
                messages.success(request, f"{m.name} mis à jour.")
            else:
                messages.error(request, "Impossible d'enregistrer : " + "; ".join(
                    e for errs in f.errors.values() for e in errs))
        elif action == "remove_member":
            m = get_object_or_404(Member, family=family, pk=request.POST.get("id"))
            if m.pk == viewer.pk:
                messages.error(request, "Vous ne pouvez pas vous retirer vous-même.")
            else:
                m.delete()
                messages.success(request, "Membre retiré de la famille.")
        elif action == "reset_link":
            m = get_object_or_404(Member, family=family, pk=request.POST.get("id"), user__isnull=False)
            uid = urlsafe_base64_encode(force_bytes(m.user.pk))
            token = default_token_generator.make_token(m.user)
            reset_link = (m, request.build_absolute_uri(reverse("password_reset_confirm", args=[uid, token])))
        elif action == "new_invite":
            from .models import new_invite_code
            family.invite_code = new_invite_code()
            family.save(update_fields=["invite_code"])
            messages.success(request, "Nouveau lien d'invitation créé. L'ancien ne fonctionne plus.")
        elif action == "rename_family":
            f = FamilyForm(request.POST)
            if f.is_valid():
                family.name = f.cleaned_data["name"]
                family.save(update_fields=["name"])
                messages.success(request, "Nom de la famille mis à jour.")
        if reset_link is None:
            return redirect("manage", slug=family.slug)

    members = family.members.select_related("household", "user").prefetch_related("managers").order_by("name")
    rows = [(m, MemberForm(instance=m, family=family, prefix=f"m{m.pk}")) for m in members]
    return render(request, "noel/manage.html", {
        "family": family,
        "viewer": viewer,
        "rows": rows,
        "households": family.households.annotate(n=Count("members")),
        "household_form": HouseholdForm(),
        "profile_form": NewProfileForm(family=family),
        "family_form": FamilyForm(initial={"name": family.name}),
        "invite_url": request.build_absolute_uri(reverse("signup", args=[family.invite_code])),
        "reset_link": reset_link,
    })


@login_required
def my_search(request, slug):
    """Retrouver une de ses propres idées (la liste reste cachée le reste du temps)."""
    family, viewer = family_and_viewer(request, slug)
    q = request.GET.get("q", "")
    results = [idea_context(i, viewer, request.user) for i in visibility.search_own(viewer, q)]
    return render(request, "noel/partials/search_results.html", {
        "family": family, "results": results, "q": q.strip(), "season": current_season(),
    })


@login_required
def my_count(request, slug):
    family, viewer = family_and_viewer(request, slug)
    return render(request, "noel/partials/my_count.html", {
        "family": family, "count": visibility.own_count(viewer), "season": current_season(),
    })
