// Google purchase value excludes tax/shipping. Only a complete digital-service
// payment with an explicit tax breakdown is eligible; never allocate guessed
// revenue across balances, partial captures, or physical shipping.
const minor = n => Number.isSafeInteger(n) && n >= 0;
export function analyticsMoney(charge, { checkout, invoice } = {}) {
  const captured=charge.amount_captured;
  if (!minor(captured) || captured===0) return null;
  let total, value, tax, currency, item;
  if (invoice) {
    if (invoice.status!=='paid' || invoice.amount_paid!==captured || invoice.amount_remaining!==0 || invoice.shipping_cost!==null) return null;
    total=invoice.total; value=invoice.total_excluding_tax; tax=total-value;
    currency=invoice.currency; item='jobhackai_subscription';
  } else if (checkout?.mode==='payment') {
    if (checkout.total_details?.amount_shipping!==0) return null;
    total=checkout.amount_total; tax=checkout.total_details?.amount_tax; value=total-tax;
    currency=checkout.currency; item='jobhackai_one_time';
  } else return null;
  if (total!==captured || currency!==charge.currency || !minor(value) || !minor(tax) || value+tax!==captured) return null;
  return {captured,value,tax,currency,item};
}
export function analyticsMoneyStatement(db, chargeId, value) {
  return db.prepare(`INSERT INTO stripe_payment_analytics_values(charge_id,captured_minor,value_minor,tax_minor,currency,item_id)
    VALUES(?,?,?,?,?,?) ON CONFLICT(charge_id) DO UPDATE SET
    captured_minor=excluded.captured_minor,value_minor=excluded.value_minor,tax_minor=excluded.tax_minor,currency=excluded.currency,item_id=excluded.item_id
    WHERE excluded.captured_minor>=stripe_payment_analytics_values.captured_minor AND excluded.currency=stripe_payment_analytics_values.currency`)
    .bind(chargeId,value.captured,value.value,value.tax,value.currency,value.item);
}
