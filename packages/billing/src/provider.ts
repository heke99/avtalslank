/** Local business identities stay stable when a payment provider changes. */
export type PriceTerms={currency:'SEK';baseOre:number;documentOre:number;model:'subscription'|'per_document'|'hybrid';interval:'month'|'year'};
export type PriceVersion={id:string;revision:number;terms:PriceTerms};
export type ProviderPrice={connectionId:string;localPriceId:string;externalPriceId:string;syncedRevision:number};
export type CheckoutRequest={organizationId:string;price:PriceVersion;mapping:ProviderPrice;idempotencyKey:string;successUrl:string;cancelUrl:string};
export interface BillingProvider {
 readonly connectionId:string;
 syncPrice(price:PriceVersion,idempotencyKey:string):Promise<ProviderPrice>;
 createCheckout(request:CheckoutRequest):Promise<{externalSessionId:string;url:string}>;
 changeSubscription(input:{externalSubscriptionId:string;price:ProviderPrice;effective:'next_period';idempotencyKey:string}):Promise<void>;
 cancelSubscription(input:{externalSubscriptionId:string;atPeriodEnd:boolean;idempotencyKey:string}):Promise<void>;
}
export function assertCheckoutPrice(price:PriceVersion,mapping:ProviderPrice|undefined,connectionId:string,expectedRevision:number){
 if(price.revision!==expectedRevision)throw Error('PRICE_CHANGED');
 if(!mapping||mapping.connectionId!==connectionId||mapping.localPriceId!==price.id||mapping.syncedRevision!==price.revision)throw Error('PRICE_SYNC_REQUIRED');
 if(price.terms.model!=='subscription')throw Error('BILLING_MODEL_NOT_READY');
 if(!Number.isSafeInteger(price.terms.baseOre)||price.terms.baseOre<0)throw Error('INVALID_PRICE');
 return mapping;
}
export async function createCurrentCheckout(provider:BillingProvider,request:Omit<CheckoutRequest,'mapping'>,mapping:ProviderPrice|undefined,expectedRevision:number){
 const synced=assertCheckoutPrice(request.price,mapping,provider.connectionId,expectedRevision);
 return provider.createCheckout({...request,mapping:synced});
}
/** Old subscriptions retain their connection. Only new purchases follow the selected connection. */
export function subscriptionConnection(subscription:{connectionId:string},available:readonly BillingProvider[]):BillingProvider{
 const provider=available.find(p=>p.connectionId===subscription.connectionId);if(!provider)throw Error('SUBSCRIPTION_PROVIDER_UNAVAILABLE');return provider;
}
