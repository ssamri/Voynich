-- Voynich Lab — salle de travail en équipe (humains + agents), exécutions, campagnes,
-- bibliothèque (plein texte + vecteurs), mémoire partagée, stockage des fichiers, temps réel.

-- ───────────── Bibliothèque ─────────────
create table public.documents (
  id bigint generated always as identity primary key,
  title text not null,
  filename text,
  mime text,
  kind text not null check (kind in ('text', 'pdf', 'image')),
  size bigint not null default 0,
  tags text[] not null default '{}',
  source text,
  notes text,
  content text not null default '',
  storage_path text,              -- objet dans le bucket « library »
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index documents_created_by_idx on public.documents (created_by);

create table public.document_chunks (
  id bigint generated always as identity primary key,
  document_id bigint not null references public.documents (id) on delete cascade,
  idx integer not null,
  start_offset integer not null,
  content text not null,
  tsv tsvector generated always as (to_tsvector('simple', content)) stored,
  embedding extensions.vector(1536)
);
create index document_chunks_doc_idx on public.document_chunks (document_id);
create index document_chunks_tsv_idx on public.document_chunks using gin (tsv);

-- ───────────── Salles de travail ─────────────
create table public.rooms (
  id bigint generated always as identity primary key,
  title text not null,
  objective text not null,
  mode text not null default 'conversation' check (mode in ('conversation', 'roundtable', 'orchestrated', 'cycle')),
  lead_agent_id bigint references public.agents (id) on delete set null,
  rounds_per_run integer not null default 2 check (rounds_per_run between 1 and 20),
  context_doc_ids bigint[] not null default '{}',
  status text not null default 'idle' check (status in ('idle', 'running', 'paused', 'stopped')),
  summary text,
  token_budget integer,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rooms_lead_agent_idx on public.rooms (lead_agent_id);
create index rooms_created_by_idx on public.rooms (created_by);
create trigger rooms_updated_at before update on public.rooms for each row execute function public.set_updated_at();

-- Participants : agents (ordre de parole) et humains.
create table public.room_members (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms (id) on delete cascade,
  agent_id bigint references public.agents (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  check ((agent_id is null) <> (user_id is null)),
  unique (room_id, agent_id),
  unique (room_id, user_id)
);
create index room_members_agent_idx on public.room_members (agent_id);
create index room_members_user_idx on public.room_members (user_id);

create table public.messages (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms (id) on delete cascade,
  kind text not null check (kind in ('user', 'agent', 'system')),
  author_id uuid references auth.users (id) on delete set null,
  agent_id bigint references public.agents (id) on delete set null,
  agent_name text,
  content text not null default '',
  thinking text,
  reply_to bigint references public.messages (id) on delete set null,
  consulted_by bigint references public.messages (id) on delete set null,
  mentions bigint[] not null default '{}',
  pinned boolean not null default false,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  duration_ms integer,
  error text,
  created_at timestamptz not null default now()
);
create index messages_room_idx on public.messages (room_id, id);
create index messages_author_idx on public.messages (author_id);
create index messages_agent_idx on public.messages (agent_id);
create index messages_reply_idx on public.messages (reply_to);
create index messages_consulted_idx on public.messages (consulted_by);

create table public.message_attachments (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.messages (id) on delete cascade,
  document_id bigint references public.documents (id) on delete set null,
  storage_path text not null,       -- objet dans le bucket « attachments »
  filename text not null,
  mime text,
  size bigint not null default 0,
  created_at timestamptz not null default now()
);
create index message_attachments_message_idx on public.message_attachments (message_id);
create index message_attachments_document_idx on public.message_attachments (document_id);

create table public.tool_calls (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.messages (id) on delete cascade,
  room_id bigint not null references public.rooms (id) on delete cascade,
  agent_id bigint references public.agents (id) on delete set null,
  name text not null,
  input jsonb,
  output text,
  is_error boolean not null default false,
  experiment_id bigint,
  created_at timestamptz not null default now()
);
create index tool_calls_message_idx on public.tool_calls (message_id);
create index tool_calls_room_idx on public.tool_calls (room_id);
create index tool_calls_agent_idx on public.tool_calls (agent_id);

-- Exécutions (pilotage lancer / pause / arrêt, budget de tokens).
create table public.runs (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms (id) on delete cascade,
  mode text not null,
  rounds integer not null default 1,
  status text not null default 'running' check (status in ('queued', 'running', 'paused', 'stopped', 'done', 'budget', 'error')),
  token_budget integer,
  tokens_used integer not null default 0,
  started_by uuid references auth.users (id) on delete set null,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index runs_room_idx on public.runs (room_id, id);
create index runs_started_by_idx on public.runs (started_by);

-- Campagnes nocturnes.
create table public.campaigns (
  id bigint generated always as identity primary key,
  room_id bigint not null unique references public.rooms (id) on delete cascade,
  enabled boolean not null default true,
  hour smallint not null default 2 check (hour between 0 and 23),
  timezone text not null default 'Europe/Paris',
  rounds integer not null default 3,
  token_budget integer not null default 300000,
  report_agent_id bigint references public.agents (id) on delete set null,
  last_run_at timestamptz,
  last_status text,
  created_at timestamptz not null default now()
);
create index campaigns_report_agent_idx on public.campaigns (report_agent_id);

-- ───────────── Mémoire partagée ─────────────
create table public.memories (
  id bigint generated always as identity primary key,
  type text not null check (type in ('hypothesis', 'finding', 'fact', 'dead_end', 'glossary', 'question', 'plan')),
  title text not null,
  content text not null,
  tags text[] not null default '{}',
  confidence real not null default 0.5 check (confidence between 0 and 1),
  status text not null default 'active' check (status in ('active', 'confirmed', 'refuted', 'archived')),
  pinned boolean not null default false,
  evidence text,
  author_agent_id bigint references public.agents (id) on delete set null,
  author_user_id uuid references auth.users (id) on delete set null,
  author_label text,
  room_id bigint references public.rooms (id) on delete set null,
  source_message_id bigint references public.messages (id) on delete set null,
  tsv tsvector generated always as (to_tsvector('simple', title || ' ' || content)) stored,
  embedding extensions.vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_tsv_idx on public.memories using gin (tsv);
create index memories_type_status_idx on public.memories (type, status);
create index memories_author_agent_idx on public.memories (author_agent_id);
create index memories_author_user_idx on public.memories (author_user_id);
create index memories_room_idx on public.memories (room_id);
create index memories_source_message_idx on public.memories (source_message_id);
create trigger memories_updated_at before update on public.memories for each row execute function public.set_updated_at();

create table public.memory_events (
  id bigint generated always as identity primary key,
  memory_id bigint not null references public.memories (id) on delete cascade,
  actor_label text,
  changes jsonb not null,
  created_at timestamptz not null default now()
);
create index memory_events_memory_idx on public.memory_events (memory_id);

-- Historique automatique des changements de statut, confiance ou contenu.
create or replace function public.log_memory_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status or new.confidence is distinct from old.confidence or new.content is distinct from old.content then
    insert into public.memory_events (memory_id, actor_label, changes)
    values (
      new.id,
      coalesce((select display_name from public.profiles where id = auth.uid()), new.author_label),
      jsonb_strip_nulls(jsonb_build_object(
        'status', case when new.status is distinct from old.status then jsonb_build_array(old.status, new.status) end,
        'confidence', case when new.confidence is distinct from old.confidence then jsonb_build_array(old.confidence, new.confidence) end,
        'content', case when new.content is distinct from old.content then true end
      ))
    );
  end if;
  return new;
end $$;
revoke execute on function public.log_memory_change() from public, anon, authenticated;
create trigger memories_log_change after update on public.memories for each row execute function public.log_memory_change();

-- ───────────── Sécurité (RLS) : tout membre validé de l'équipe lit et écrit ─────────────
do $$
declare t text;
begin
  foreach t in array array['documents', 'document_chunks', 'rooms', 'room_members', 'messages', 'message_attachments',
                           'tool_calls', 'runs', 'campaigns', 'memories', 'memory_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "membres : lecture" on public.%I for select to authenticated using ((select public.is_member()))', t);
    execute format('create policy "membres : ajout" on public.%I for insert to authenticated with check ((select public.is_member()))', t);
    execute format('create policy "membres : modification" on public.%I for update to authenticated using ((select public.is_member())) with check ((select public.is_member()))', t);
    execute format('create policy "membres : suppression" on public.%I for delete to authenticated using ((select public.is_member()))', t);
  end loop;
end $$;

-- ───────────── Stockage des fichiers (buckets privés, accès par URL signées) ─────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 52428800), ('library', 'library', false, 52428800)
on conflict (id) do nothing;

create policy "membres : lecture des fichiers" on storage.objects for select to authenticated
  using (bucket_id in ('attachments', 'library') and (select public.is_member()));
create policy "membres : dépôt de fichiers" on storage.objects for insert to authenticated
  with check (bucket_id in ('attachments', 'library') and (select public.is_member()));
create policy "membres : modification des fichiers" on storage.objects for update to authenticated
  using (bucket_id in ('attachments', 'library') and (select public.is_member()));
create policy "membres : suppression des fichiers" on storage.objects for delete to authenticated
  using (bucket_id in ('attachments', 'library') and (select public.is_member()));

-- ───────────── Temps réel ─────────────
alter publication supabase_realtime add table public.messages, public.tool_calls, public.runs, public.rooms, public.memories, public.message_attachments;
