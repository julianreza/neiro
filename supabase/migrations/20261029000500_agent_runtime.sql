-- Which program runs each agent: the Hermes server (default) or a local CLI.
-- Safe to re-run: additive only.
alter table public.agents
  add column if not exists runtime text not null default 'hermes',
  add column if not exists effort text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agents_runtime_check'
  ) then
    alter table public.agents
      add constraint agents_runtime_check
      check (runtime in ('hermes', 'antigravity', 'ohmypi'));
  end if;
end $$;

comment on column public.agents.runtime is
  'hermes = Hermes server; antigravity = local agy CLI; ohmypi = local omp CLI.';
comment on column public.agents.effort is
  'Oh My Pi thinking level (off, minimal, low, medium, high, xhigh, max). Empty = CLI default.';

notify pgrst, 'reload schema';
