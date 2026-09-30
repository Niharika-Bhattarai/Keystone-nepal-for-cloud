'use strict';

// Stripe: one subscription, Keystone AI Pro at $49/month with 3 photoreal
// houses a month.
//
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO (the
// monthly price id), APP_URL (where Checkout returns, e.g. https://keystone-ai.example).
//
// The webhook is the only thing that changes a subscription or grants the
// monthly credits; the browser redirect after Checkout is only a courtesy.
// Receipts, subscription state and credit effects commit in one store transaction.

const { getStore } = require('./store');
const { PLAN } = require('./entitlements');
const credits = require('./creditRecords');

let client = null;
function stripe() {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw Object.assign(new Error('Stripe is not configured'), { code: 'BILLING_NOT_CONFIGURED' });
  const Stripe = require('stripe');
  return (client = new Stripe(key, { apiVersion: '2025-08-27.basil', timeout: 10000, maxNetworkRetries: 1 }));
}

const appUrl = () => String(process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');

async function createCheckout(user) {
  const price = process.env.STRIPE_PRICE_PRO;
  if (!price) throw Object.assign(new Error('STRIPE_PRICE_PRO is not set'), { code: 'BILLING_NOT_CONFIGURED' });
  const params = {
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    client_reference_id: user.uid,
    success_url: `${appUrl()}/account?tab=billing&checkout=success`,
    cancel_url: `${appUrl()}/pricing?checkout=cancelled`,
    allow_promotion_codes: true,
    subscription_data: { metadata: { uid: user.uid } },
    metadata: { uid: user.uid },
  };
  if (user.stripeCustomerId) params.customer = user.stripeCustomerId;
  else if (user.email) params.customer_email = user.email;
  const s = await stripe().checkout.sessions.create(params);
  return s.url;
}

async function createPortal(user) {
  if (!user.stripeCustomerId) throw Object.assign(new Error('No billing account yet'), { code: 'NO_BILLING_ACCOUNT' });
  const s = await stripe().billingPortal.sessions.create({ customer: user.stripeCustomerId, return_url: `${appUrl()}/account?tab=billing` });
  return s.url;
}

const idOf = value => typeof value === 'string' ? value : value?.id;
const invoiceSubscription = invoice => idOf(invoice.parent?.subscription_details?.subscription || invoice.subscription);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
function approvedItem(sub) {
  const items = sub.items?.data || [];
  if (items.length !== 1 || sub.items?.has_more) return null;
  const item = items[0], price = item.price;
  return item.quantity === 1 && price?.id === process.env.STRIPE_PRICE_PRO && price.currency === 'usd' &&
    price.unit_amount === PLAN.priceUsd * 100 && price.recurring?.interval === 'month' &&
    price.recurring.interval_count === 1 ? item : null;
}
function periodOf(sub, item) {
  const start = item?.current_period_start ?? sub.current_period_start;
  const end = item?.current_period_end ?? sub.current_period_end;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) return null;
  return { id: `${sub.id}:${start}:${end}`, start, end, source: 'stripe' };
}
function invoiceGrant(invoice, sub, item, period) {
  if (!item || !period || !['active', 'trialing'].includes(sub.status)) return null;
  if (invoice.status !== 'paid' || invoice.paid === false || invoice.amount_remaining !== 0 || invoice.currency !== 'usd' ||
    !['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason) ||
    invoiceSubscription(invoice) !== sub.id || idOf(invoice.customer) !== idOf(sub.customer)) return null;
  // One approved recurring line only. Prorations, one-off purchases and ambiguous
  // or truncated invoices do not manufacture a fresh monthly allowance.
  const lines = invoice.lines?.data || [];
  if (invoice.lines?.has_more || lines.length !== 1) return null;
  const line = lines[0], details = line.parent?.subscription_item_details;
  const price = idOf(line.pricing?.price_details?.price || line.price);
  const lineSub = idOf(details?.subscription || line.subscription);
  const lineItem = idOf(details?.subscription_item || line.subscription_item);
  if (price !== item.price.id || line.quantity !== 1 || (details?.proration ?? line.proration) !== false ||
    lineSub !== sub.id || lineItem !== item.id || line.period?.start !== period.start || line.period?.end !== period.end) return null;
  if (period.end * 1000 <= Date.now() || period.start * 1000 > Date.now()) return null;
  return credits.request({ kind: 'reset_monthly', amount: PLAN.photorealPerMonth, period }, 'plan_grant', invoice.id);
}

// Called only for a signature-verified event. Provider retrieval is outside the
// database transaction. A local billing revision fences concurrent reconciliations:
// on conflict, reread the account AND Stripe before trying again. Event timestamps
// are never used as an ordering guarantee.
async function handleEvent(event, store = getStore()) {
  if (!validId(event?.id) || !event.data?.object) throw new Error('Invalid Stripe event');
  const supported = ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid'];
  if (!supported.includes(event.type)) return `ignored ${event.type}`;
  if (!process.env.STRIPE_PRICE_PRO) throw Object.assign(new Error('Approved price is not configured'), { code: 'BILLING_NOT_CONFIGURED' });
  let object = event.data.object, invoice = null, subId;
  if (event.type === 'invoice.paid') {
    invoice = await stripe().invoices.retrieve(object.id); object = invoice;
    subId = invoiceSubscription(invoice);
  } else if (event.type === 'checkout.session.completed') {
    object = await stripe().checkout.sessions.retrieve(object.id);
    if (object.mode !== 'subscription' || object.status !== 'complete') return 'ignored checkout';
    subId = idOf(object.subscription);
  } else subId = object.id;
  if (!validId(subId)) return 'not a subscription';
  // Metadata in the canonical subscription is the account binding created by our
  // authenticated Checkout request. A customer lookup also supports older records.
  let sub = await stripe().subscriptions.retrieve(subId);
  const customer = idOf(sub.customer);
  const owner = customer ? await store.findUserByCustomer(customer) : null;
  const uid = sub.metadata?.uid || owner?.uid;
  if (!validId(uid) || !validId(customer)) return 'subscription without account';
  if (owner && owner.uid !== uid) return 'customer ownership mismatch';
  if (idOf(object.customer) !== customer || (object.client_reference_id && object.client_reference_id !== uid)) return 'object ownership mismatch';
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await store.getUser(uid), revision = before?.billingRevision || 0;
    // Fetch after the revision snapshot, including the first attempt.
    sub = await stripe().subscriptions.retrieve(subId);
    if (sub.id !== subId || idOf(sub.customer) !== customer || (sub.metadata?.uid && sub.metadata.uid !== uid)) throw new Error('Stripe account binding changed during reconciliation');
    const item = approvedItem(sub), period = periodOf(sub, item || sub.items?.data?.[0]);
    const grant = invoice ? invoiceGrant(invoice, sub, item, period) : null;
    try {
      return await store.atomicAccount(uid, grant?.keys || [], (user, records) => {
        if ((user.billingRevision || 0) !== revision) throw credits.error('BILLING_RETRY', 'Billing changed during reconciliation');
        if (user.stripeCustomerId && user.stripeCustomerId !== customer) return { result: 'customer ownership mismatch' };
        if (user.subscription?.id && user.subscription.id !== subId &&
          !(user.subscription.status === 'canceled' && ['active', 'trialing'].includes(sub.status))) return { result: 'different subscription' };
        const change = grant ? credits.credit(user, records, grant) : { result: 'subscription reconciled' };
        change.patch = { ...change.patch, stripeCustomerId: customer, billingRevision: revision + 1,
          subscription: { id: subId, status: sub.status, priceId: sub.items?.data?.[0]?.price?.id || null,
            verified: true, approved: Boolean(item && period),
            currentPeriodEnd: period ? new Date(period.end * 1000).toISOString() : null,
            cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end) } };
        change.result = grant ? 'invoice reconciled' : 'subscription reconciled';
        return change;
      }, event.id, customer);
    } catch (e) { if (e.code !== 'BILLING_RETRY' || attempt === 4) throw e; }
  }
}

// Express handler; needs the raw body (mounted with express.raw before express.json).
async function webhook(req, res) {
  let event;
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    event = stripe().webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (e) {
    return res.status(400).send(`Webhook error: ${e.message}`);
  }
  try {
    const what = await handleEvent(event);
    console.log(`[stripe] ${event.type} ${event.id}: ${what}`);
    return res.json({ received: true });
  } catch (e) {
    console.error('[stripe] handler failed', event.type, e);
    return res.status(500).json({ received: false }); // Stripe retries
  }
}

module.exports = { createCheckout, createPortal, handleEvent, webhook, setStripe: (s) => { client = s; } };
