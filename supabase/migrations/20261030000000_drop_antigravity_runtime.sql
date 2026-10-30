-- Antigravity is no longer a runtime: agents run on Hermes or Oh My Pi.
-- An agent still set to antigravity goes back to Hermes. Safe to re-run.
update public.agents set runtime = 'hermes' where runtime = 'antigravity';

alter table public.agents drop constraint if exists agents_runtime_check;
alter table public.agents
  add constraint agents_runtime_check check (runtime in ('hermes', 'ohmypi'));

comment on column public.agents.runtime is
  'hermes = Hermes server; ohmypi = local omp CLI.';

notify pgrst, 'reload schema';
