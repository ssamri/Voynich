-- Voynich Lab — durcissement : les fonctions d'autorisation quittent le schéma exposé par l'API (public)
-- pour un schéma privé ; les politiques RLS continuent de les utiliser (référence par identifiant interne).

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter function public.is_member() set schema private;
alter function public.is_admin() set schema private;

-- Les fonctions qui les appelaient par leur nom sont redéfinies.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role and not private.is_admin() then
    raise exception 'Seul un administrateur peut changer un rôle';
  end if;
  return new;
end $$;

create or replace function public.set_provider_api_key(p_provider_id bigint, p_api_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_secret uuid;
begin
  if not private.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;
  select api_key_secret_id into v_secret from public.providers where id = p_provider_id;
  if not found then
    raise exception 'Fournisseur % introuvable', p_provider_id;
  end if;
  if v_secret is null then
    v_secret := vault.create_secret(p_api_key, 'provider_' || p_provider_id, 'Clé API Voynich Lab');
  else
    perform vault.update_secret(v_secret, p_api_key);
  end if;
  update public.providers
     set api_key_secret_id = v_secret,
         api_key_hint = case when length(p_api_key) > 8 then left(p_api_key, 4) || '…' || right(p_api_key, 4) else '••••' end
   where id = p_provider_id;
end $$;

-- Fonction d'événement créée par Supabase (activation automatique du RLS) : jamais appelable via l'API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
