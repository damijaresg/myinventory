/* Money, profit and status calculations. No browser APIs here so it is easy to test. */
(function (root) {
  'use strict';

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  /* "$1,234.50" -> 1234.5. Blank means 0. Anything unreadable or negative -> NaN. */
  function parseMoney(v) {
    if (typeof v === 'number') return isFinite(v) && v >= 0 ? round2(v) : NaN;
    var s = String(v == null ? '' : v).replace(/[$,\s]/g, '');
    if (s === '') return 0;
    if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return round2(parseFloat(s));
  }

  /* Whole number, zero or more. Blank -> the fallback. Unreadable -> NaN. */
  function parseQty(v, fallback) {
    if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : NaN;
    var s = String(v == null ? '' : v).replace(/[,\s]/g, '');
    if (s === '') return fallback;
    if (!/^\d+$/.test(s)) return NaN;
    return parseInt(s, 10);
  }

  function estimateFee(salePrice, feePct) {
    return round2((Number(salePrice) || 0) * (Number(feePct) || 0) / 100);
  }

  /* salePrice is the total for the whole sale; unitCost is what was paid for one. */
  function saleProfit(s) {
    return round2(s.salePrice - s.fee - s.shipping - s.unitCost * s.qty);
  }

  function totals(sales) {
    var t = { units: 0, revenue: 0, profit: 0 };
    sales.forEach(function (s) {
      t.units += s.qty;
      t.revenue += s.salePrice;
      t.profit += s.profit;
    });
    t.revenue = round2(t.revenue);
    t.profit = round2(t.profit);
    return t;
  }

  /* 'soldout' | 'listed' | 'unlisted' */
  function status(item) {
    if (item.qty <= 0) return 'soldout';
    return item.listed ? 'listed' : 'unlisted';
  }

  /* Low stock only makes sense for items that once had more than the threshold,
     so a one-of-a-kind item is never flagged. */
  function isLow(item, threshold) {
    threshold = Number(threshold) || 0;
    if (threshold <= 0 || item.qty <= 0) return false;
    return item.qty <= threshold && (item.maxQty || item.qty) > threshold;
  }

  var api = {
    round2: round2,
    parseMoney: parseMoney,
    parseQty: parseQty,
    estimateFee: estimateFee,
    saleProfit: saleProfit,
    totals: totals,
    status: status,
    isLow: isLow
  };
  root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
