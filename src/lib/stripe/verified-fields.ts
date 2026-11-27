type SubscriptionPeriod = {
  current_period_end?: number;
  items?: {
    data: { current_period_end?: number }[];
    has_more?: boolean;
  };
};

export function subscriptionPeriodEnd(
  subscription: SubscriptionPeriod,
): string {
  const items = subscription.items;
  const periods = items?.data.map(item => item.current_period_end) ?? [];

  const valid = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    Number.isFinite(new Date(value * 1000).getTime());

  if (items?.has_more) {
    throw new Error('Subscription period incomplete');
  }

  const end = periods.length && periods.every(valid)
    ? Math.min(...periods)
    : subscription.current_period_end;

  if (!valid(end)) {
    throw new Error('Subscription period unavailable');
  }

  return new Date(end * 1000).toISOString();
}

type Reference = string | { id: string } | null;

export type InvoiceSubscription = {
  subscription?: Reference;
  parent?: {
    type?: string;
    subscription_details?: {
      subscription?: Reference;
    } | null;
  } | null;
};

export function invoiceSubscriptionId(
  invoice: InvoiceSubscription,
): string | undefined {
  const value = invoice.parent?.type === 'subscription_details'
    ? invoice.parent.subscription_details?.subscription
    : invoice.subscription;

  const id = typeof value === 'string' ? value : value?.id;

  return typeof id === 'string' && id.startsWith('sub_')
    ? id
    : undefined;
}
