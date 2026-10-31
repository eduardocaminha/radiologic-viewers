begin;

select plan(20);

-- As fichas do teste são incompletas de propósito.
alter table public.submissions disable trigger submissions_guard_edit;

insert into auth.users (id, aud, role, email, created_at)
select ('66666666-6666-4666-8666-66666666660' || n)::uuid, 'authenticated', 'authenticated', 'fair' || n || '@example.test', now() - interval '1 hour'
from generate_series(1, 6) as n;
update auth.users set created_at = now() - interval '30 days' where id = '66666666-6666-4666-8666-666666666606';
insert into public.admins (user_id) values ('66666666-6666-4666-8666-666666666606');

insert into public.submissions (id, slug, status, source, name, tagline, lang, owner_id, approved_at)
values
  ('66666666-6666-4666-8666-666666666611', 'fair-old', 'approved', 'form', 'Fair old', 'Tagline', 'en', '66666666-6666-4666-8666-666666666601', now() - interval '80 days'),
  ('66666666-6666-4666-8666-666666666612', 'fair-new', 'approved', 'form', 'Fair new', 'Tagline', 'pt', null, now() - interval '70 days'),
  ('66666666-6666-4666-8666-666666666613', 'fair-org', 'approved', 'form', 'Fair organizer', 'Tagline', 'pt', null, now() - interval '75 days');

insert into public.votes (user_id, submission_id, created_at)
select ('66666666-6666-4666-8666-66666666660' || n)::uuid, s.id,
  (date_trunc('month', timezone('America/Sao_Paulo', now())) - interval '1 month' + interval '5 days') at time zone 'America/Sao_Paulo'
from generate_series(1, 2) as n
cross join (values
  ('66666666-6666-4666-8666-666666666611'::uuid),
  ('66666666-6666-4666-8666-666666666612'::uuid),
  ('66666666-6666-4666-8666-666666666613'::uuid)
) as s (id);
insert into public.votes (user_id, submission_id, created_at)
values ('66666666-6666-4666-8666-666666666603', '66666666-6666-4666-8666-666666666613',
  (date_trunc('month', timezone('America/Sao_Paulo', now())) - interval '1 month' + interval '5 days') at time zone 'America/Sao_Paulo');

select is(has_function_privilege('anon', 'public.voided_votes_by_month()', 'EXECUTE'), true, 'anon reads the public voided total');
select is(has_function_privilege('anon', 'public.pending_vote_void_notices()', 'EXECUTE'), false, 'anon cannot read the notice queue');
select is(has_function_privilege('authenticated', 'public.pending_vote_void_notices()', 'EXECUTE'), false, 'authenticated cannot read the notice queue');
select is(has_function_privilege('authenticated', 'public.clear_vote_void_notices(uuid[])', 'EXECUTE'), false, 'authenticated cannot clear the notice queue');
select is(has_table_privilege('anon', 'public.vote_void_notices', 'SELECT'), false, 'anon cannot select the notice table');

select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666601', false);
select throws_ok(
  $$select public.set_organizer_project('66666666-6666-4666-8666-666666666613', true)$$,
  'SUB20',
  'only admins can mark organizer projects',
  'set_organizer_project rejects non-admins'
);

select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666606', false);
select public.set_organizer_project('66666666-6666-4666-8666-666666666613', true);
select is((select organizer_project from public.submissions where id = '66666666-6666-4666-8666-666666666613'), true, 'admin marks the organizer project');
select is((select count(*) from public.submission_events where kind = 'organizer_project_changed'), 1::bigint, 'organizer mark is logged');
select public.set_organizer_project('66666666-6666-4666-8666-666666666613', true);
select is((select count(*) from public.submission_events where kind = 'organizer_project_changed'), 1::bigint, 'repeating the mark is a no-op');
select is((select organizer_project from public.get_submission('fair-org')), true, 'get_submission exposes the mark');

select public.write_monthly_highlights((date_trunc('month', timezone('America/Sao_Paulo', now())) - interval '1 month')::date);
select public.write_monthly_highlights((date_trunc('month', timezone('America/Sao_Paulo', now())) - interval '2 months')::date);
select is((select count(*) from public.monthly_highlights where month = (date_trunc('month', timezone('America/Sao_Paulo', now())) - interval '2 months')::date), 0::bigint, 'a month without votes has no highlights');
select is((select count(*) from public.monthly_highlights where submission_id = '66666666-6666-4666-8666-666666666613'), 0::bigint, 'organizer project stays out of the highlights despite the most votes');
select is((select submission_id from public.monthly_highlights where rank = 1 and month = (date_trunc('month', timezone('America/Sao_Paulo', now())) - interval '1 month')::date), '66666666-6666-4666-8666-666666666612'::uuid, 'ties go to the most recently approved project');

update public.votes set revoked_at = now()
where user_id = '66666666-6666-4666-8666-666666666602' and submission_id = '66666666-6666-4666-8666-666666666612';
select public.void_votes('66666666-6666-4666-8666-666666666602', 'contas em lote');
select is((select votes from public.vote_void_notices where submission_id = '66666666-6666-4666-8666-666666666611'), 1, 'void_votes queues a notice per project');
select is((select count(*) from public.vote_void_notices where submission_id = '66666666-6666-4666-8666-666666666612'), 0::bigint, 'an already revoked vote does not notify the author');
select is((select votes from public.voided_votes_by_month() limit 1), 2, 'public total ignores revoked votes');

select public.void_votes('66666666-6666-4666-8666-666666666601', 'contas em lote');
select is(
  (select votes from public.pending_vote_void_notices() where slug = 'fair-old'),
  2,
  'notices for the same project are grouped'
);
select is((select email from public.pending_vote_void_notices() where slug = 'fair-old'), 'fair1@example.test', 'notice carries the owner email');
select public.clear_vote_void_notices((select array_agg(id) from public.vote_void_notices));
select is((select count(*) from public.vote_void_notices), 0::bigint, 'clearing empties the queue');

insert into public.votes (user_id, submission_id, created_at)
select ('66666666-6666-4666-8666-66666666660' || n)::uuid, '66666666-6666-4666-8666-666666666613', now() - interval '10 minutes'
from generate_series(1, 5) as n
on conflict (user_id, submission_id) do update
  set created_at = excluded.created_at, voided_at = null, revoked_at = null;
select is((public.get_moderation_digest(current_date)->>'vote_alerts_count')::integer, 1, 'digest flags five votes from new accounts in 24 hours');

select * from finish();
rollback;
