const FMP_API_KEY = process.env.FMP_API_KEY || '3gipL1YiTdgPYBKkenyDOUfhoy3dT2ND';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

const MARKET_CONFIG = [
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'DIA', label: 'Dow' },
  { symbol: 'QQQ', label: 'Nasdaq' }
];

function jsonResponse(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

async function fetchQuotesBatch() {
  var symbols = MARKET_CONFIG.map(function(i) { return i.symbol; }).join(',');
  var url = 'https://financialmodelingprep.com/api/v3/quote/' + symbols + '?apikey=' + encodeURIComponent(FMP_API_KEY);
  var resp = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
  var text = await resp.text();
  if (!resp.ok) throw new Error('FMP ' + resp.status + ': ' + text.slice(0, 200));
  var data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('FMP non-JSON: ' + text.slice(0, 200)); }
  if (!Array.isArray(data) || !data.length) throw new Error('FMP empty. Key may be expired. Raw: ' + text.slice(0, 200));
  return data.map(function(row) {
    var price = Number(row.price);
    var pct = Number(row.changesPercentage);
    if (!isFinite(pct)) {
      var ch = Number(row.change);
      if (isFinite(ch) && isFinite(price) && price !== 0) pct = (ch / (price - ch)) * 100;
      else pct = null;
    }
    return { symbol: row.symbol || '', price: isFinite(price) ? price : null, changesPercentage: isFinite(pct) ? pct : null };
  });
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { ok: false, error: 'Method not allowed.' });
  try {
    var quotes = await fetchQuotesBatch();
    return jsonResponse(200, { ok: true, quotes: quotes });
  } catch (err) {
    return jsonResponse(200, {
      ok: false,
      error: err && err.message ? err.message : 'Failed.',
      quotes: [],
      debug: { apiKeyPresent: !!FMP_API_KEY, apiKeySource: process.env.FMP_API_KEY ? 'env' : 'hardcoded', symbols: MARKET_CONFIG.map(function(i) { return i.symbol; }) }
    });
  }
};
