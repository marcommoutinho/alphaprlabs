-- S3 review fix: one spelling per push endpoint.
--
-- The unique constraint on push_subscriptions.endpoint compares raw text. If
-- two spellings of the same URL (a #fragment, host case, :443, escaped
-- characters) could both be stored, two accounts could each hold a row for
-- the same phone and the shared-phone transfer would not happen. The app
-- stores only the canonical form (src/lib/push/device.ts canonicalEndpoint);
-- this check enforces the same form for every write, including a direct
-- authenticated call to save_push_subscription.

create function public.is_canonical_push_endpoint(p_endpoint text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_endpoint is not null
    and char_length(p_endpoint) <= 2048
    -- https, a lowercase push-service host with no port or userinfo, then
    -- URL characters only (no "#", whitespace or backslash).
    and p_endpoint ~ ('^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.apple\.com|'
      || 'push\.services\.mozilla\.com|notify\.windows\.com)/[A-Za-z0-9._~!$&''()*+,;=:@%/?-]*$')
    -- every "%" starts an escape with two uppercase hex digits ...
    and p_endpoint !~ '%([^0-9A-F]|.[^0-9A-F]|.?$)'
    -- ... that never encodes an unreserved character (A-Z a-z 0-9 - . _ ~)
    and p_endpoint !~ '%(2[DE]|3[0-9]|4[1-9A-F]|5[0-9AF]|6[1-9A-F]|7[0-9AE])'
    -- no dot segments and no empty query
    and p_endpoint !~ '/\.\.?(/|\?|$)'
    and p_endpoint !~ '\?$';
$$;

revoke all on function public.is_canonical_push_endpoint(text) from public, anon;
grant execute on function public.is_canonical_push_endpoint(text) to authenticated, service_role;

alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_canonical check (public.is_canonical_push_endpoint(endpoint));
