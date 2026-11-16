import type { BillingModel } from "../../domain/src/index.ts";
export interface BillingConfiguration {
  model: BillingModel;
  currency: "SEK";
  provider: string | null;
  priceVersion: string | null;
}
export interface UsageEvent {
  organizationId: string;
  eventKey: string;
  kind: "envelope_completed" | "document_completed" | "recipient_signed";
  quantity: number;
  occurredAt: string;
  envelopeId: string;
}
export interface BillingProvider {
  readonly name: string;
  createCheckout(input: {
    organizationId: string;
    priceVersion: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  createPortal(organizationId: string): Promise<{ url: string }>;
}
export class UnconfiguredBillingProvider implements BillingProvider {
  readonly name = "unconfigured";
  async createCheckout(): Promise<never> {
    throw new Error("BILLING_PROVIDER_NOT_CONFIGURED");
  }
  async createPortal(): Promise<never> {
    throw new Error("BILLING_PROVIDER_NOT_CONFIGURED");
  }
}
export function usageKey(
  kind: UsageEvent["kind"],
  envelopeId: string,
  resourceId: string,
  generation: number,
): string {
  if (
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    ![envelopeId, resourceId].every((v) => /^[a-zA-Z0-9-]{1,80}$/.test(v))
  )
    throw new Error("INVALID_USAGE_REFERENCE");
  return `${kind}:${envelopeId}:${resourceId}:v${generation}`;
}
export function canStartCheckout(config: BillingConfiguration): boolean {
  return (
    config.model !== "unconfigured" &&
    config.provider !== null &&
    config.priceVersion !== null
  );
}
