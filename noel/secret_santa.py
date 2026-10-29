"""Tirage au sort des amis secrets.

Règles :
  1. on ne se tire pas soi-même ;
  2. on ne tire personne de son propre foyer ;
  3. si possible, on évite de retomber sur la même personne que l'an dernier ;
  4. si possible, on évite les paires réciproques (A → B et B → A).

Les règles 1 et 2 sont obligatoires. Les règles 3 et 4 sont relâchées une par une
seulement s'il n'existe aucune solution qui les respecte. L'algorithme
(retour sur trace avec ordre aléatoire) trouve toujours une solution s'il en existe une.
"""

import random
from dataclasses import dataclass, field


class DrawImpossible(Exception):
    pass


@dataclass
class DrawResult:
    pairs: list  # [(giver_id, receiver_id)]
    relaxed: list = field(default_factory=list)  # règles qu'il a fallu assouplir


def _solve(people, allowed, avoid_reciprocal, rng, budget=200_000):
    order = sorted(people, key=lambda p: len(allowed[p]))  # les plus contraints d'abord
    taken, result = set(), {}
    steps = [0]

    def backtrack(i):
        steps[0] += 1
        if steps[0] > budget:
            return False
        if i == len(order):
            return True
        giver = order[i]
        candidates = [r for r in allowed[giver] if r not in taken]
        rng.shuffle(candidates)
        for r in candidates:
            if avoid_reciprocal and result.get(r) == giver:
                continue
            taken.add(r)
            result[giver] = r
            if backtrack(i + 1):
                return True
            taken.discard(r)
            del result[giver]
        return False

    return result if backtrack(0) else None


def draw(participants, households, previous=None, seed=None):
    """
    participants : liste d'ids de membres
    households   : dict id -> id de foyer (ou None)
    previous     : ensemble de paires (giver, receiver) à éviter si possible
    """
    people = list(dict.fromkeys(participants))
    if len(people) < 2:
        raise DrawImpossible("Il faut au moins deux participants.")
    previous = previous or set()
    rng = random.Random(seed)

    def allowed_map(avoid_previous):
        out = {}
        for g in people:
            out[g] = [
                r
                for r in people
                if r != g
                and not (households.get(g) is not None and households.get(g) == households.get(r))
                and not (avoid_previous and (g, r) in previous)
            ]
        return out

    attempts = [
        (True, True, []),
        (True, False, ["paires réciproques"]),
        (False, True, ["tirage de l’an dernier"]),
        (False, False, ["tirage de l’an dernier", "paires réciproques"]),
    ]
    if len(people) == 2:
        attempts = [(True, False, []), (False, False, ["tirage de l’an dernier"])]

    for avoid_prev, avoid_recip, relaxed in attempts:
        allowed = allowed_map(avoid_prev)
        if any(not v for v in allowed.values()):
            continue
        sol = _solve(people, allowed, avoid_recip, rng)
        if sol:
            return DrawResult(pairs=[(g, sol[g]) for g in people], relaxed=relaxed)

    raise DrawImpossible(
        "Aucun tirage possible : un foyer regroupe trop de participants. "
        "Ajoutez des participants d'autres foyers ou modifiez les foyers."
    )
