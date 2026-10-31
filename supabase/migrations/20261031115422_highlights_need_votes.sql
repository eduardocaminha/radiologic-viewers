-- Destaque exige voto: num mês sem votos, nenhum projeto entra.
create or replace function public.write_monthly_highlights(p_month date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month_start timestamptz;
  v_next_month_start timestamptz;
begin
  v_month_start := p_month::timestamp at time zone 'America/Sao_Paulo';
  v_next_month_start := (p_month + interval '1 month')::timestamp at time zone 'America/Sao_Paulo';

  with counted as (
    select
      s.id as submission_id,
      s.name,
      s.slug,
      s.approved_at,
      count(v.user_id)::integer as votes
    from public.submissions as s
    left join public.votes as v on v.submission_id = s.id
      and v.created_at >= v_month_start
      and v.created_at < v_next_month_start
      and v.revoked_at is null
      and v.voided_at is null
    where s.status = 'approved'
      and not s.organizer_project
      and s.approved_at < v_next_month_start
      and s.name is not null
      and s.slug is not null
    group by s.id, s.name, s.slug, s.approved_at
  ), ranked as (
    select
      counted.*,
      pg_catalog.row_number() over (
        order by counted.votes desc, counted.approved_at desc nulls last, counted.submission_id
      ) as rank
    from counted
    where counted.votes > 0
  )
  insert into public.monthly_highlights (month, rank, submission_id, name, slug, votes)
  select p_month, ranked.rank, ranked.submission_id, ranked.name, ranked.slug, ranked.votes
  from ranked
  where ranked.rank <= 3;
end;
$$;
