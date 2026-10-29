from .models import Family


def navigation(request):
    """Famille courante (d'après l'URL) et membre connecté, pour l'en-tête et la barre du bas."""
    ctx = {}
    match = getattr(request, "resolver_match", None)
    user = getattr(request, "user", None)
    if not (user and user.is_authenticated):
        return ctx
    slug = match.kwargs.get("slug") if match else None
    families = list(Family.objects.filter(members__user=user).distinct())
    current = next((f for f in families if f.slug == slug), None)
    if current is None and len(families) == 1:
        current = families[0]
    ctx["nav_families"] = families
    ctx["nav_family"] = current
    if current:
        ctx["nav_me"] = current.members.filter(user=user).first()
    ctx["nav_section"] = match.url_name if match else ""
    return ctx
