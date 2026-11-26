-- Read-only operator report: cancellation reason paired with the store-verified outcome.
-- Milestone 3 brief 01 "save reason and outcome". The reason is saved by
-- save_subscription_cancellation_feedback; the outcome is saved by the verified Apple
-- notification handler (subscription_cancellation_evidence / _confirmations). This
-- query only joins them. Aggregates only: no user ids, no free-text details.
--
-- Outcomes:
--   cancelled      newest verified state after the reason: auto-renew off, or a verified cancellation confirmation
--   kept           newest verified state after the reason: auto-renew back on
--   ended          newest verified state after the reason: subscription expired or revoked
--   no_store_change  no verified store change since the reason was given (member backed out,
--                    or the store notification has not arrived yet)
--   offer_accepted Apple verified that the member took the retention offer after giving the reason
--                  (subscription_retention_offer_redemptions, migration 20261126160000), and no newer
--                  verified cancellation or end followed it. Stays empty while the offer is off.
with latest as (
  -- Newest verified state after the reason was given wins (Apple events are ordered by their
  -- signed event time when stored; a later renewal-enabled event beats an earlier cancellation).
  select f.reason, f.submitted_at,
    case when e.snapshot_verified_at >= f.submitted_at then e.source end as evidence_source,
    case when e.snapshot_verified_at >= f.submitted_at then e.snapshot_verified_at end as evidence_at,
    (select max(c.verified_at) from public.subscription_cancellation_confirmations c
      where c.subscription_id = f.subscription_id and c.user_id = f.user_id
        and c.verified_at >= f.submitted_at) as confirmed_at,
    (select min(r.recorded_at) from public.subscription_retention_offer_redemptions r
      where r.subscription_id = f.subscription_id and r.user_id = f.user_id
        and r.recorded_at >= f.submitted_at) as offer_at
  from public.subscription_cancellation_feedback f
  left join public.subscription_cancellation_evidence e
    on e.subscription_id = f.subscription_id and e.user_id = f.user_id
), outcome as (
  select reason,
    case
      when offer_at is not null
        and not coalesce(evidence_at > offer_at and evidence_source in ('apple_renewal_disabled', 'apple_terminal'), false)
        and not coalesce(confirmed_at > offer_at, false) then 'offer_accepted'
      when evidence_at is not null and (confirmed_at is null or evidence_at >= confirmed_at) then
        case evidence_source when 'apple_renewal_enabled' then 'kept'
                             when 'apple_terminal' then 'ended'
                             else 'cancelled' end
      when confirmed_at is not null then 'cancelled'
      else 'no_store_change'
    end as outcome
  from latest
)
select reason, outcome, count(*) as members
from outcome
group by reason, outcome
order by reason, outcome;
