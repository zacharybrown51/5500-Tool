// Cloudflare Pages Function: /api/market-indices
// Optionally set FMP_API_KEY in environment, or uses hardcoded free key

const FMP_KEY_DEFAULT = '3gipL1YiTdgPYBKkenyDOUfhoy3dT2ND';

const SYMBOLS = [
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'DIA', label: 'Dow' },
  { symbol: 'QQQ', label: 'Nasdaq' }
];

function jsonResp(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    }
  });
}

export async function onRequestOptions() {
  return new Response('', {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    }
  });
}

export async function onRequestGet(context) {
  const apiKey = (context.env && context.env.FMP_API_KEY) || FMP_KEY_DEFAULT;

  try {
    const symbolStr = SYMBOLS.map(s => s.symbol).join(',');
    const url = 'https://financialmodelingprep.com/api/v3/quote/' + symbolStr + '?apikey=' + encodeURIComponent(apiKey);
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const text = await resp.text();

    if (!resp.ok) throw new Error('FMP ' + resp.status + ': ' + text.slice(0, 200));

    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('FMP non-JSON: ' + text.slice(0, 200)); }
    if (!Array.isArray(data) || !data.length) throw new Error('FMP empty response: ' + text.slice(0, 200));

    const quotes = data.map(row => {
      const price = Number(row.price);
      let pct = Number(row.changesPercentage);
      if (!isFinite(pct)) {
        const ch = Number(row.change);
        if (isFinite(ch) && isFinite(price) && price !== 0) pct = (ch / (price - ch)) * 100;
        else pct = null;
      }
      return { symbol: row.symbol || '', price: isFinite(price) ? price : null, changesPercentage: isFinite(pct) ? pct : null };
    });

    return jsonResp(200, { ok: true, quotes });
  } catch (err) {
    return jsonResp(200, { ok: false, error: err.message || 'Failed.', quotes: [] });
  }
}
