/* A customers row as the page sees it (camelCase, same shape the profile form posts) */
export function profileJson(r) {
  return {
    email: r.email, firstName: r.first_name, lastName: r.last_name,
    legalName: r.legal_name, tradingName: r.trading_name, abn: r.abn, phone: r.phone,
    billing: r.billing || {}, deliverySame: r.delivery_same, delivery: r.delivery || {},
    onboarded: !!r.onboarded_at, xeroLinked: !!r.xero_contact_id,
  };
}
