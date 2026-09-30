'use strict';
function fixture() {
  const start = Math.floor(Date.now() / 1000) - 60, end = start + 30 * 86400;
  const subscription = { id: 'sub_one', customer: 'cus_one', status: 'active', metadata: { uid: 'alice' },
    items: { data: [{ id: 'si_one', quantity: 1, current_period_start: start, current_period_end: end,
      price: { id: 'price_pro', currency: 'usd', unit_amount: 4900, recurring: { interval: 'month', interval_count: 1 } } }] } };
  const invoice = { id: 'in_one', customer: 'cus_one', subscription: 'sub_one', status: 'paid', paid: true, amount_remaining: 0,
    billing_reason: 'subscription_cycle', currency: 'usd', subscription_details: { metadata: { uid: 'alice' } },
    lines: { has_more: false, data: [{ type: 'subscription', subscription: 'sub_one', subscription_item: 'si_one',
      quantity: 1, proration: false, price: subscription.items.data[0].price, period: { start, end } }] } };
  const client = { subscriptions: { retrieve: async () => structuredClone(subscription) }, invoices: { retrieve: async () => structuredClone(invoice) } };
  return { subscription, invoice, client, event: { id: 'evt_one', type: 'invoice.paid', data: { object: invoice } } };
}

module.exports = { fixture };
