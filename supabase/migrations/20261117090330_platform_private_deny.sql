create policy deny_client_access on al_private.platform_admins as restrictive for all to anon,authenticated using(false) with check(false);
create policy deny_client_access on al_private.platform_audit as restrictive for all to anon,authenticated using(false) with check(false);
create policy deny_client_access on al_private.api_entitlements as restrictive for all to anon,authenticated using(false) with check(false);
create policy deny_client_access on al_private.payment_receipts as restrictive for all to anon,authenticated using(false) with check(false);
