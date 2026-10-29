"""Tirage au sort des amis secrets, en une ou plusieurs boucles.

Avec 2 ou 3 boucles, chacun offre à 2 ou 3 personnes différentes (et reçoit de 2 ou 3 personnes).

Règles obligatoires :
  1. on ne se tire pas soi-même ;
  2. on ne tire personne de son propre foyer ;
  3. pas de doublon : on ne tire jamais deux fois la même personne d'une boucle à l'autre.

Règles respectées si possible (on n'assouplit que le minimum, en commençant par
la moins importante, et seulement s'il n'existe aucune solution qui les respecte) :
  4. on ne retombe pas sur une personne qu'on a soi-même tirée l'an dernier ;
  5. deux personnes d'un même foyer n'offrent pas à la même personne ;
  6. pas d'échange réciproque (A → B et B → A) ;
  7. on ne tombe pas sur une personne tirée l'an dernier par quelqu'un de son foyer
     (règle de l'ancien site, la plus difficile à tenir avec un grand foyer).

L'algorithme (retour sur trace avec ordre aléatoire, relancé plusieurs fois) trouve
une solution dès qu'il en existe une en pratique.
"""

import random
from dataclasses import dataclass, field


class DrawImpossible(Exception):
    pass


@dataclass
class DrawResult:
    pairs: list  # [(round, giver_id, receiver_id)], round commence à 1
    relaxed: list = field(default_factory=list)  # règles qu'il a fallu assouplir


RULE_RECIPROCAL = "échanges réciproques"
RULE_HOUSEHOLD_SHARE = "deux personnes d’un même foyer pour le même ami secret"
RULE_LAST_YEAR = "personnes tirées l’an dernier"
RULE_LAST_YEAR_HOUSE = "personnes tirées l’an dernier par son foyer"


def _solve_round(people, allowed, avoid_reciprocal, rng, budget=50_000):
    order = sorted(people, key=lambda p: (len(allowed[p]), rng.random()))
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


def draw(participants, households, previous=None, rounds=1, seed=None, tries=60, previous_household=None):
    """
    participants       : liste d'ids de membres
    households         : dict id -> id de foyer (ou None)
    previous           : paires (giver, receiver) tirées l'an dernier par la personne elle-même
    previous_household : paires à éviter parce qu'un membre du foyer les a tirées l'an dernier
    rounds             : nombre de boucles (amis secrets par personne)
    """
    people = list(dict.fromkeys(participants))
    rounds = max(1, int(rounds))
    if len(people) < 2:
        raise DrawImpossible("Il faut au moins deux participants.")
    previous = previous or set()
    previous_household = (previous_household or set()) | previous
    rng = random.Random(seed)
    house = {p: households.get(p) for p in people}
    mates = {p: [q for q in people if q != p and house[p] is not None and house[q] == house[p]] for p in people}

    for p in people:
        if len(people) - 1 - len(mates[p]) < rounds:
            raise DrawImpossible(
                f"Impossible de faire {rounds} boucle{'s' if rounds > 1 else ''} : certains participants "
                "n'ont pas assez de personnes hors de leur foyer. Réduisez le nombre de boucles "
                "ou ajoutez des participants."
            )

    # (réciprocité, foyer-même-ami, an dernier perso, an dernier foyer) : du plus strict au plus souple
    levels = [
        (True, True, True, True),
        (True, True, True, False),
        (False, True, True, False),
        (True, False, True, False),
        (False, False, True, False),
        (True, True, False, False),
        (False, True, False, False),
        (False, False, False, False),
    ]
    for avoid_recip, avoid_share, avoid_prev, avoid_prev_house in levels:
        if len(people) == 2:
            avoid_recip = False
        banned_prev = previous_household if avoid_prev_house else (previous if avoid_prev else set())
        for _ in range(tries):
            used, pairs, ok = set(), [], True
            for t in range(1, rounds + 1):
                allowed = {
                    g: [
                        r for r in people
                        if r != g
                        and r not in mates[g]
                        and (g, r) not in used
                        and (g, r) not in banned_prev
                        and not (avoid_recip and (r, g) in used)
                        and not (avoid_share and any((m, r) in used for m in mates[g]))
                    ]
                    for g in people
                }
                if any(not v for v in allowed.values()):
                    ok = False
                    break
                sol = _solve_round(people, allowed, avoid_recip, rng)
                if sol is None:
                    ok = False
                    break
                for g in people:
                    used.add((g, sol[g]))
                    pairs.append((t, g, sol[g]))
            if ok:
                relaxed = []
                if not avoid_prev and previous:
                    relaxed.append(RULE_LAST_YEAR)
                if not avoid_share and any(mates.values()):
                    relaxed.append(RULE_HOUSEHOLD_SHARE)
                if not avoid_recip and len(people) > 2:
                    relaxed.append(RULE_RECIPROCAL)
                if not avoid_prev_house and previous_household - previous:
                    relaxed.append(RULE_LAST_YEAR_HOUSE)
                return DrawResult(pairs=pairs, relaxed=relaxed)

    raise DrawImpossible(
        "Aucun tirage possible avec ces participants et ces foyers. "
        "Ajoutez des participants d'autres foyers ou réduisez le nombre de boucles."
    )
