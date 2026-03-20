const FMP_API_KEY = '3gipL1YiTdgPYBKkenyDOUfhoy3dT2ND';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

const MARKET_CONFIG = [
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^DJI', label: 'Dow' },
  { symbol: '^IXIC', label: 'Nasdaq' }
];

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}

async function fetchIndexQuote(symbol) {
  const url = 'https://financialmodelingprep.com/api/v3/quote/' + encodeURIComponent(symbol) + '?apikey=' + encodeURIComponent(FMP_API_KEY);
  const resp = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });

  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = null;
  }

  if (!resp.ok) {
    throw new Error(symbol + ' request failed with ' + resp.status + (text ? ' - ' + text.slice(0, 160) : ''));
  }

  if (!Array.isArray(data) || !data.length) {
    throw new Error(symbol + ' returned no quote data');
  }

  const row = data[0] || {};
  const price = Number(row.price);
  let changesPercentage = Number(row.changesPercentage);
  if (!isFinite(changesPercentage)) {
    const change = Number(row.change);
    if (isFinite(change) && isFinite(price) && price !== 0) {
      changesPercentage = (change / (price - change)) * 100;
    } else {
      changesPercentage = null;
    }
  }

  return {
    symbol,
    price: isFinite(price) ? price : null,
    changesPercentage: isFinite(changesPercentage) ? changesPercentage : null
  };
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    const quotes = await Promise.all(MARKET_CONFIG.map(item => fetchIndexQuote(item.symbol)));
    return jsonResponse(200, { ok: true, quotes });
  } catch (err) {
    return jsonResponse(200, {
      ok: false,
      error: err && err.message ? err.message : 'Market indices request failed.',
      quotes: []
    });
  }
};
