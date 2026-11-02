-- « Première connexion » : chacun choisit son prénom dans la liste et choisit son mot de passe,
-- sans lien d'invitation. Seuls les profils qui n'ont pas encore de compte sont proposés.
-- À coller dans Supabase : SQL Editor → New query → Run.

create or replace function public.first_login_profiles() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', m.id, 'name', m.name, 'family', f.name) order by f.name, m.name), '[]'::json)
    from members m join families f on f.id = m.family_id
   where m.user_id is null
$$;

create or replace function public.claim_profile(p_member uuid, p_password text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare code text; mname text;
begin
  select f.invite_code, m.name into code, mname
    from members m join families f on f.id = m.family_id
   where m.id = p_member and m.user_id is null;
  if code is null then raise exception 'Ce profil a déjà un compte. Connectez-vous avec votre prénom.'; end if;
  return public.create_account(code, mname, p_password, p_member);
end $$;

revoke execute on function public.first_login_profiles(), public.claim_profile(uuid, text) from public;
grant execute on function public.first_login_profiles(), public.claim_profile(uuid, text) to anon, authenticated;
