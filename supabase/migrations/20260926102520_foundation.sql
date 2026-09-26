-- Voynich Lab — fondations : extensions, profils et rôles, fournisseurs IA (clés dans Vault), agents, réglages, audit.

create extension if not exists vector with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ───────────── Utilitaires ─────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ───────────── Profils (membres humains de l'équipe) ─────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  role text not null default 'pending' check (role in ('admin', 'member', 'pending')),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'member'));
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

revoke execute on function public.is_member() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_member() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- Création automatique du profil ; le tout premier compte devient administrateur, les suivants attendent validation.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), ''),
    case when exists (select 1 from public.profiles) then 'pending' else 'admin' end
  );
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Un membre ne peut pas modifier son propre rôle (seul un administrateur le peut).
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Seul un administrateur peut changer un rôle';
  end if;
  return new;
end $$;
revoke execute on function public.guard_profile_role() from public, anon, authenticated;
create trigger profiles_guard_role before update on public.profiles for each row execute function public.guard_profile_role();

alter table public.profiles enable row level security;
create policy "profils visibles par les membres" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_member()));
create policy "chacun modifie son profil" on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));
create policy "admin supprime les profils" on public.profiles for delete to authenticated using ((select public.is_admin()));

-- ───────────── Réglages (moteur de recherche, IIIF, corpus…) ─────────────
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create trigger settings_updated_at before update on public.settings for each row execute function public.set_updated_at();
alter table public.settings enable row level security;
create policy "membres lisent les réglages" on public.settings for select to authenticated using ((select public.is_member()));
create policy "admin écrit les réglages (ajout)" on public.settings for insert to authenticated with check ((select public.is_admin()));
create policy "admin écrit les réglages (modification)" on public.settings for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin écrit les réglages (suppression)" on public.settings for delete to authenticated using ((select public.is_admin()));

-- ───────────── Fournisseurs IA ─────────────
create table public.providers (
  id bigint generated always as identity primary key,
  name text not null,
  kind text not null check (kind in ('anthropic', 'openai', 'openai_compatible')),
  base_url text,
  api_key_secret_id uuid,          -- référence vers vault.secrets (la clé n'est jamais stockée ici)
  api_key_hint text,
  default_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger providers_updated_at before update on public.providers for each row execute function public.set_updated_at();
alter table public.providers enable row level security;
create policy "membres lisent les fournisseurs" on public.providers for select to authenticated using ((select public.is_member()));
create policy "admin gère les fournisseurs (ajout)" on public.providers for insert to authenticated with check ((select public.is_admin()));
create policy "admin gère les fournisseurs (modification)" on public.providers for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin gère les fournisseurs (suppression)" on public.providers for delete to authenticated using ((select public.is_admin()));

-- Enregistre / remplace la clé API d'un fournisseur dans Supabase Vault (administrateur uniquement).
create or replace function public.set_provider_api_key(p_provider_id bigint, p_api_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_secret uuid;
begin
  if not public.is_admin() then
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
revoke execute on function public.set_provider_api_key(bigint, text) from public, anon;
grant execute on function public.set_provider_api_key(bigint, text) to authenticated;

-- Lecture de la clé : réservée au serveur d'agents (clé service_role), jamais au navigateur.
create or replace function public.get_provider_api_key(p_provider_id bigint)
returns text language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret
    from public.providers p
    join vault.decrypted_secrets s on s.id = p.api_key_secret_id
   where p.id = p_provider_id;
$$;
revoke execute on function public.get_provider_api_key(bigint) from public, anon, authenticated;
grant execute on function public.get_provider_api_key(bigint) to service_role;

-- ───────────── Agents ─────────────
create table public.agents (
  id bigint generated always as identity primary key,
  name text not null,
  provider_id bigint references public.providers (id) on delete set null,
  model text not null,
  role_title text not null default '',
  system_prompt text not null default '',
  temperature real,
  max_tokens integer not null default 16000,
  effort text check (effort in ('low', 'medium', 'high', 'xhigh', 'max')),
  color text not null default '#5b8def',
  tools text[] not null default array['library', 'memory', 'corpus', 'substitution', 'collaboration', 'science', 'images'],
  web_search boolean not null default true,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agents_provider_idx on public.agents (provider_id);
create trigger agents_updated_at before update on public.agents for each row execute function public.set_updated_at();
alter table public.agents enable row level security;
create policy "membres lisent les agents" on public.agents for select to authenticated using ((select public.is_member()));
create policy "admin gère les agents (ajout)" on public.agents for insert to authenticated with check ((select public.is_admin()));
create policy "admin gère les agents (modification)" on public.agents for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin gère les agents (suppression)" on public.agents for delete to authenticated using ((select public.is_admin()));

-- ───────────── Journal d'audit ─────────────
create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_user_idx on public.audit_log (user_id);
alter table public.audit_log enable row level security;
create policy "admin lit l'audit" on public.audit_log for select to authenticated using ((select public.is_admin()));
create policy "membres écrivent l'audit" on public.audit_log for insert to authenticated
  with check ((select public.is_member()) and user_id = (select auth.uid()));
