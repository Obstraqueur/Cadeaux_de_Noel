-- Une idée ne peut être modifiée ou supprimée que par la personne qui l'a écrite
-- (ou par quelqu'un qui tient la liste de la personne, pour les idées qu'elle a écrites pour elle-même).
-- Être organisateur ne donne plus ce droit sur les idées des autres.
-- À coller dans Supabase : SQL Editor → New query → Run.

create or replace function public._can_edit_idea(i ideas) returns boolean
language sql stable security definer set search_path = public as $$
  select i.author_id = public.my_member(i.family_id)
      or (public.can_edit_list(i.recipient_id) and not public.is_surprise(i.recipient_id, i.author_id))
$$;
