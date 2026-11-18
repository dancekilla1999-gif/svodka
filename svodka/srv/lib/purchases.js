// Закупки из iiko: приходные накладные за день → строки «товар · поставщик · кол-во · сумма» для истории цен.
async function collectPurchases(iiko, day) {
  const docs = await iiko.invoices(day, day);
  const out = { day, docs: docs.length, rows: [], sum: 0 };
  if (!docs.length) return out;
  const [products, suppliers] = await Promise.all([iiko.products().catch(() => ({})), iiko.suppliers().catch(() => ({}))]);
  const agg = {};
  docs.forEach((d) => {
    const sup = suppliers[d.supplier] || '';
    d.items.forEach((it) => {
      const k = it.product + '|' + sup;
      const p = products[it.product] || {};
      if (!agg[k]) agg[k] = { product_id: it.product, name: p.name || ('Товар ' + (it.article || it.product.slice(0, 8))), unit: p.unit || '', supplier: sup, qty: 0, sum: 0, day };
      agg[k].qty += it.amount; agg[k].sum += it.sum;
    });
  });
  out.rows = Object.values(agg).map((r) => Object.assign(r, { qty: Math.round(r.qty * 1000) / 1000, sum: Math.round(r.sum * 100) / 100 }));
  out.sum = Math.round(out.rows.reduce((s, r) => s + r.sum, 0) * 100) / 100;
  return out;
}
module.exports = { collectPurchases };
