"""Remplit le calendrier de l'Avent à partir d'un dossier d'images.

    python manage.py charger_avent chemin/vers/avent_images --famille "Famille Jean" --debut 2026-11-30

Les fichiers doivent s'appeler day0.png, day0_modal.png, day1.png, day1_modal.png…
(« _modal » = l'image à l'intérieur de la case). dayN tombe le jour --debut + N.
"""

from datetime import date
from pathlib import Path

from django.core.files import File
from django.core.management.base import BaseCommand, CommandError

from noel.models import Family, current_season
from noel.views import handle_advent_bulk


class Command(BaseCommand):
    help = "Charge les images du calendrier de l'Avent depuis un dossier."

    def add_arguments(self, parser):
        parser.add_argument("dossier")
        parser.add_argument("--famille", required=True)
        parser.add_argument("--debut", help="Date de la case 0 (AAAA-MM-JJ). Par défaut le 30 novembre.")

    def handle(self, *args, **opts):
        folder = Path(opts["dossier"])
        if not folder.is_dir():
            raise CommandError(f"Dossier introuvable : {folder}")
        family = Family.objects.filter(name=opts["famille"]).first()
        if family is None:
            raise CommandError(f"Famille introuvable : {opts['famille']}")
        start = date.fromisoformat(opts["debut"]) if opts["debut"] else date(current_season(), 11, 30)
        files = []
        for path in sorted(folder.iterdir()):
            if path.is_file():
                f = File(path.open("rb"), name=path.name)
                files.append(f)
        done, ignored = handle_advent_bulk(family, start, files)
        for f in files:
            f.close()
        self.stdout.write(self.style.SUCCESS(f"{done} images rangées dans le calendrier de {family}."))
        if ignored:
            self.stdout.write(f"Ignorés (nom non reconnu) : {', '.join(ignored)}")
