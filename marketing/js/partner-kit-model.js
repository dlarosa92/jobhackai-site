(function (root) {
  'use strict';
  const text = value => String(value || '').trim();
  const shown = value => text(value) || 'Not added yet';
  const confirmations = { yes: 'Confirmed', no: 'No', unknown: 'Not confirmed' };
  const confirmed = value => confirmations[value] || confirmations.unknown;
  function interviewSummary(data) {
    const actions = [text(data.action1), text(data.action2)].filter(Boolean);
    const ready = [Boolean(text(data.project) && text(data.result)), Boolean(actions.length && text(data.ownership) && text(data.boundary)), Boolean(text(data.reflection))];
    return {
      complete: ready.filter(Boolean).length,
      text: ['MY INTERVIEW PREPARATION', '', 'TEAM RESULT', `Project: ${shown(data.project)}`, `Result: ${shown(data.result)}`, '', 'MY EXACT PART', `My role: ${shown(data.ownership)}`, ...((actions.length ? actions : ['Not added yet']).map((action, i) => `${i + 1}. ${action}`)), `Where my part stopped: ${shown(data.boundary)}`, '', 'NEXT TIME', shown(data.reflection)].join('\n')
    };
  }
  function amount(value) {
    if (value === '' || value == null) return 'Not provided';
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n) : 'Check the amount';
  }
  function moveoutSummary(data) {
    const a = data.a || {}, b = data.b || {};
    const fields = [['Quote amount', p => amount(p.price)], ['Address and deadline', p => confirmed(p.available)], ['My specific items', p => confirmed(p.items)], ['Carrying and loading', p => confirmed(p.carrying)], ['Disposal included', p => confirmed(p.disposal)], ['Written scope and quote', p => confirmed(p.written)], ['Extras and exclusions', p => shown(p.extras)]];
    const rows = fields.map(([label, get]) => [label, get(a), get(b)]);
    const checks = p => ['available', 'items', 'carrying', 'disposal', 'written'].filter(k => p[k] === 'yes').length;
    return {
      rows, names: [text(a.name) || 'Provider A', text(b.name) || 'Provider B'],
      status: `Provider A: ${checks(a)} of 5 checks confirmed. Provider B: ${checks(b)} of 5 checks confirmed. Confirm every unknown or unavailable item directly before booking.`,
      text: ['MY MOVE-OUT QUOTE COMPARISON', `Items: ${shown(data.items)}`, `Access: ${shown(data.access)}`, `Deadline: ${shown(data.deadline)}`, '', `${text(a.name) || 'Provider A'} | ${text(b.name) || 'Provider B'}`, ...rows.map(([label, av, bv]) => `${label}: ${av} | ${bv}`), '', 'Quote amounts may cover different work. Confirm scope, extras and availability directly. Listings are not endorsements.'].join('\n')
    };
  }
  const api = { interviewSummary, moveoutSummary };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JHAKitModel = Object.freeze(api);
})(typeof window === 'object' ? window : this);
