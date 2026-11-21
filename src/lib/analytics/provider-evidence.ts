import type { PaidEvidence } from './billing';
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
export function stripePaidEvidence(invoice: {
 id?: string; subscription?: string | {id:string} | null; status?: string | null;
 lines?: {data: {type?: string; proration?: boolean; period?: {start?: number}}[]; has_more?: boolean};
 amount_paid?: number; paid_out_of_band?: boolean; status_transitions?: {paid_at?: number | null};
}, subscription: string): PaidEvidence | undefined {
 const linked=typeof invoice.subscription==='string'?invoice.subscription:invoice.subscription?.id;
 const paid=invoice.status_transitions?.paid_at;
 if(linked!==subscription || !invoice.id || invoice.status!=='paid' || invoice.paid_out_of_band===true
   || !Number.isFinite(invoice.amount_paid) || !(invoice.amount_paid!>0) || !paid || !Number.isFinite(paid)) return;
 const line=invoice.lines?.has_more===false && invoice.lines.data.length===1 ? invoice.lines.data[0] : undefined;
 const start=line?.type==='subscription' && line.proration===false ? line.period?.start : undefined;
 return {transactionId:invoice.id,paidAt:new Date(paid*1000).toISOString(),amount:invoice.amount_paid!,verified:true,
 ...(start && Number.isFinite(start)?{servicePeriodStart:new Date(start*1000).toISOString()}:{})};
}
