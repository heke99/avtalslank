# Payment model extension point

No commercial model, price or payment provider has been selected. No checkout or charge endpoint is enabled.

- `al_billing_accounts.model`: unconfigured, subscription, per_document, hybrid.
- `price_version` is a future immutable rate-card reference, not a price invented by this implementation.
- `al_usage_events` stores immutable business facts with a unique organization/event key. Only verified completion may produce billable completion facts; never count retries as new documents.
- Future subscription schedules, included volume and overage rates must be separate from signer and document state.
- The `BillingProvider` interface is deliberately provider-neutral. The unconfigured implementation refuses checkout and portal requests.
- Refunds/credits must become explicit adjustment events; do not rewrite original usage facts.
- API and UI never determine payment success. A future chosen provider needs independently verified server-side events, replay protection and reconciliation.
- Before enabling: decide billing unit (envelope/document/signer), when usage is recognized, VAT/currency rules, cancellations, retention and treatment of already sent documents on account suspension.

This release stores the extension structure and shows that payments are not activated. It does not promise free/unlimited use or a subscription price.
