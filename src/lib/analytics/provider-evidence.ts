import type { PaidEvidence } from './billing';
import {
  invoiceSubscriptionId,
  type InvoiceSubscription,
} from '../stripe/verified-fields';
/** Inputs are verified server API results, never mobile request fields. */
export function googlePaidEvidence(order: {
 orderId?: string; purchaseToken?: string; state?: string;
 lineItems?: {subscriptionDetails?: {servicePeriodStartTime?: string}}[];
 total?: {units?: string; nanos?: number}; orderHistory?: {processedEvent?: {eventTime?: string}};
}, token: string, orderId: string): PaidEvidence | undefined {
 const amount=Number(order.total?.units ?? 0)+(order.total?.nanos ?? 0)/1e9;
 const paidAt=order.orderHistory?.processedEvent?.eventTime;
 if(order.purchaseToken!==token || order.orderId!==orderId || order.state!=='PROCESSED'
   || !paidAt || !Number.isFinite(Date.parse(paidAt)) || !Number.isFinite(amount) || amount<=0) return;
 const start=order.lineItems?.length===1?order.lineItems[0].subscriptionDetails?.servicePeriodStartTime:undefined;
 return {transactionId:orderId,paidAt,amount,verified:true,...(start && Number.isFinite(Date.parse(start))?{servicePeriodStart:start}:{})};
}
export function stripePaidEvidence(
  invoice: InvoiceSubscription & {
    id?: string;
    status?: string | null;
    amount_paid?: number;
    paid_out_of_band?: boolean;
    status_transitions?: { paid_at?: number | null };
    lines?: {
      has_more?: boolean;
      data: {
        type?: string;
        proration?: boolean;
        period?: { start?: number };
        parent?: {
          type?: string;
          subscription_item_details?: {
            subscription?: string;
            proration?: boolean;
          } | null;
        } | null;
      }[];
    };
  },
  subscription: string,
): PaidEvidence | undefined {
  const linked = invoiceSubscriptionId(invoice);
  const paid = invoice.status_transitions?.paid_at;

  if (
    linked !== subscription ||
    !invoice.id ||
    invoice.status !== 'paid' ||
    invoice.paid_out_of_band === true ||
    !Number.isFinite(invoice.amount_paid) ||
    !(invoice.amount_paid! > 0) ||
    !paid ||
    !Number.isFinite(paid)
  ) return;

  const line =
    invoice.lines?.has_more === false &&
    invoice.lines.data.length === 1
      ? invoice.lines.data[0]
      : undefined;

  const details =
    line?.parent?.type === 'subscription_item_details'
      ? line.parent.subscription_item_details
      : undefined;

  const recurring = details
    ? details.subscription === subscription &&
      details.proration === false
    : line?.type === 'subscription' &&
      line.proration === false;

  const start = recurring ? line?.period?.start : undefined;

  return {
    transactionId: invoice.id,
    paidAt: new Date(paid * 1000).toISOString(),
    amount: invoice.amount_paid!,
    verified: true,
    ...(start && Number.isFinite(start)
      ? { servicePeriodStart: new Date(start * 1000).toISOString() }
      : {}),
  };
}
