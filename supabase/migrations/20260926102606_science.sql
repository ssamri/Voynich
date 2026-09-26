-- Voynich Lab — moteur scientifique : corpus EVA, corpus de référence, journal d'expériences,
-- indices (cribs), images IIIF et annotations.

create table public.corpus_pages (
  folio text primary key,
  ord integer not null,
  quire text,
  panel text,
  illustration text,
  language text,
  hand text,
  header text
);

create table public.corpus_lines (
  id bigint generated always as identity primary key,
  folio text not null references public.corpus_pages (folio) on delete cascade,
  ord integer not null,
  locus text not null,
  locus_type text,
  transcriber text,
  raw text not null,
  text text not null
);
create index corpus_lines_folio_idx on public.corpus_lines (folio, ord);

create table public.ref_corpora (
  id bigint generated always as identity primary key,
  name text not null,
  language text,
  genre text,
  kind text not null check (kind in ('natural', 'cipher', 'generated')),
  source text,
  notes text,
  params jsonb,
  text text not null,
  tokens integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index ref_corpora_created_by_idx on public.ref_corpora (created_by);

create table public.experiments (
  id bigint generated always as identity primary key,
  kind text not null,
  title text not null,
  status text not null default 'done' check (status in ('planned', 'running', 'done', 'error')),
  verdict text check (verdict in ('pass', 'fail', 'inconclusive')),
  criteria jsonb,
  params jsonb not null default '{}',
  result jsonb,
  summary text,
  corpus_version text,
  seed bigint,
  room_id bigint references public.rooms (id) on delete set null,
  agent_id bigint references public.agents (id) on delete set null,
  author_user_id uuid references auth.users (id) on delete set null,
  author_label text,
  duration_ms integer,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index experiments_room_idx on public.experiments (room_id, id);
create index experiments_agent_idx on public.experiments (agent_id);
create index experiments_author_idx on public.experiments (author_user_id);
create index experiments_kind_idx on public.experiments (kind, id desc);

-- Un test pré-enregistré ne peut plus voir ses critères modifiés une fois créé.
create or replace function public.freeze_experiment_criteria()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.criteria is not null and new.criteria is distinct from old.criteria then
    raise exception 'Les critères d''un test pré-enregistré sont figés';
  end if;
  return new;
end $$;
create trigger experiments_freeze_criteria before update on public.experiments for each row execute function public.freeze_experiment_criteria();

alter table public.tool_calls
  add constraint tool_calls_experiment_fk foreign key (experiment_id) references public.experiments (id) on delete set null;
create index tool_calls_experiment_idx on public.tool_calls (experiment_id);

create table public.cribs (
  id bigint generated always as identity primary key,
  folio text,
  locus text,
  eva text not null,
  expected text not null,
  language text,
  category text,
  source text,
  confidence real not null default 0.3 check (confidence between 0 and 1),
  notes text,
  author_label text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index cribs_created_by_idx on public.cribs (created_by);

create table public.folio_images (
  folio text primary key,
  canvas_label text,
  image_service text,
  image_url text,
  width integer,
  height integer,
  ord integer
);

create table public.annotations (
  id bigint generated always as identity primary key,
  folio text not null,
  x real not null check (x between 0 and 1),
  y real not null check (y between 0 and 1),
  w real not null check (w between 0 and 1),
  h real not null check (h between 0 and 1),
  kind text not null default 'label',
  locus text,
  title text,
  note text,
  author_label text,
  author_user_id uuid references auth.users (id) on delete set null,
  author_agent_id bigint references public.agents (id) on delete set null,
  created_at timestamptz not null default now()
);
create index annotations_folio_idx on public.annotations (folio);
create index annotations_author_user_idx on public.annotations (author_user_id);
create index annotations_author_agent_idx on public.annotations (author_agent_id);

do $$
declare t text;
begin
  foreach t in array array['corpus_pages', 'corpus_lines', 'ref_corpora', 'experiments', 'cribs', 'folio_images', 'annotations']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "membres : lecture" on public.%I for select to authenticated using ((select public.is_member()))', t);
    execute format('create policy "membres : ajout" on public.%I for insert to authenticated with check ((select public.is_member()))', t);
    execute format('create policy "membres : modification" on public.%I for update to authenticated using ((select public.is_member())) with check ((select public.is_member()))', t);
    execute format('create policy "membres : suppression" on public.%I for delete to authenticated using ((select public.is_member()))', t);
  end loop;
end $$;

alter publication supabase_realtime add table public.experiments, public.annotations;
