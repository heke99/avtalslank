create or replace function al_private.protect_case_prices() returns trigger language plpgsql set search_path='' as $$begin
 if ((old.price_quote is not null or old.finalized_at is not null) and new.price_quote is distinct from old.price_quote) or new.search_sender is distinct from old.search_sender then raise exception 'IMMUTABLE_PRICE_QUOTE';end if;return new;
end $$;
