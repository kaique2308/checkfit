-- CheckFit: estrutura do banco no Supabase (PostgreSQL)
-- Cole este script em: Supabase > SQL Editor > New query > Run

create table if not exists public.workouts (
  id            uuid primary key,
  device_id     uuid not null,
  user_name     text,
  title         text not null,
  category      text not null,
  performed_at  date not null,
  duration_min  integer default 0,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted       boolean not null default false
);

create table if not exists public.exercises (
  id           uuid primary key,
  workout_id   uuid not null references public.workouts(id) on delete cascade,
  device_id    uuid not null,
  name         text not null,
  sets         integer not null default 0,
  reps         integer not null default 0,
  weight_kg    numeric(6,2) not null default 0,
  -- Resultados da Visão Computacional (2º bimestre)
  cv_reps      integer,
  cv_score     numeric(5,2),
  cv_feedback  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted      boolean not null default false
);

create index if not exists idx_workouts_device  on public.workouts(device_id);
create index if not exists idx_exercises_device on public.exercises(device_id);
create index if not exists idx_exercises_workout on public.exercises(workout_id);

-- RLS ligado com políticas abertas para a chave anon (projeto acadêmico, sem login).
-- Em produção, trocar por Supabase Auth e filtrar por auth.uid().
alter table public.workouts  enable row level security;
alter table public.exercises enable row level security;

drop policy if exists "anon_all_workouts"  on public.workouts;
drop policy if exists "anon_all_exercises" on public.exercises;

create policy "anon_all_workouts"  on public.workouts  for all to anon using (true) with check (true);
create policy "anon_all_exercises" on public.exercises for all to anon using (true) with check (true);

-- View útil para mostrar na apresentação
-- security_invoker: a view respeita o RLS das tabelas (tira o aviso "Security Definer view")
create or replace view public.v_resumo_treinos with (security_invoker = true) as
select w.user_name,
       w.title,
       w.performed_at,
       count(e.id)                               as exercicios,
       coalesce(sum(e.sets * e.reps * e.weight_kg), 0) as volume_kg
  from public.workouts w
  left join public.exercises e on e.workout_id = w.id and e.deleted = false
 where w.deleted = false
 group by w.id
 order by w.performed_at desc;

-- 2º bimestre: resultados da Visão Computacional (Pose Estimation) sincronizados do app
create or replace view public.v_analises_postura with (security_invoker = true) as
select w.user_name,
       w.performed_at       as data,
       w.title              as treino,
       e.name               as exercicio,
       e.reps               as reps_planejadas,
       e.cv_reps            as reps_contadas_camera,
       e.cv_score           as nota_postura,
       e.cv_feedback        as feedback
  from public.exercises e
  join public.workouts w on w.id = e.workout_id
 where e.deleted = false and w.deleted = false and e.cv_score is not null
 order by w.performed_at desc, e.updated_at desc;
