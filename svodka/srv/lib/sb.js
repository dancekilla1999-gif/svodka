// Вызовы функций базы (Supabase RPC) с публичным ключом — как из браузера.
const URL = process.env.SB_URL || 'https://qozyihhlocvgpkchyqsp.supabase.co';
const KEY = process.env.SB_KEY || 'sb_publishable_Us9CgaJDpwIpAHSQYN7QMg_ADy35Uov';
async function rpc(fn, args) {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}),
    signal: AbortSignal.timeout(20000)
  });
  const txt = await r.text();
  let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
  if (!r.ok) { const e = new Error((data && data.message) || `База ответила ${r.status}`); e.hint = data && data.hint; e.status = r.status; throw e; }
  return data;
}
module.exports = { rpc };
