// Cloudflare Pages Function: /api/market-indices
// Uses Yahoo Finance (free, no key) with Alpha Vantage fallback

const SYMBOLS = [
  { symbol: '%5EGSPC', label: 'S&P 500', display: '^GSPC' },
  { symbol: '%5EDJI', label: 'Dow', display: '^DJI' },
  { symbol: '%5EIXIC', label: 'Nasdaq', display: '^IXIC' }
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

async function fetchYahoo() {
  var symbolStr = SYMBOLS.map(function(s) { return s.symbol; }).join(',');
  var url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + symbolStr + '&fields=regularMarketPrice,regularMarketChangePercent';

  var resp = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0'
    }
  });

  if (!resp.ok) throw new Error('Yahoo ' + resp.status);

  var data = await resp.json();
  var results = data && data.quoteResponse && data.quoteResponse.result;
  if (!Array.isArray(results) || !results.length) throw new Error('Yahoo empty response');

  var displayMap = {}; SYMBOLS.forEach(function(s) { displayMap[decodeURIComponent(s.symbol)] = s.display || s.symbol; });
  return results.map(function(row) {
    var price = Number(row.regularMarketPrice);
    var pct = Number(row.regularMarketChangePercent);
    return {
      symbol: displayMap[row.symbol] || row.symbol || '',
      price: isFinite(price) ? price : null,
      changesPercentage: isFinite(pct) ? pct : null
    };
  });
}

async function fetchYahooV8() {
  // Fallback: Yahoo v8 endpoint (different format)
  var quotes = [];
  for (var i = 0; i < SYMBOLS.length; i++) {
    var sym = SYMBOLS[i].symbol;
    var url = 'https://query2.finance.yahoo.com/v8/finance/chart/' + sym + '?interval=1d&range=2d';
    var resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) continue;
    var data = await resp.json();
    var meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
    if (meta) {
      var price = Number(meta.regularMarketPrice);
      var prevClose = Number(meta.chartPreviousClose || meta.previousClose);
      var pct = (isFinite(price) && isFinite(prevClose) && prevClose > 0) ? ((price - prevClose) / prevClose) * 100 : null;
      quotes.push({ symbol: sym, price: isFinite(price) ? price : null, changesPercentage: pct });
    }
  }
  if (!quotes.length) throw new Error('Yahoo v8 returned no data');
  return quotes;
}

async function fetchGoogleFinance() {
  // Last resort: scrape Google Finance for basic price data
  var quotes = [];
  for (var i = 0; i < SYMBOLS.length; i++) {
    try {
      var sym = SYMBOLS[i].symbol;
      var url = 'https://www.google.com/finance/quote/' + (sym === '%5EGSPC' ? '.INX:INDEXSP' : sym === '%5EDJI' ? '.DJI:INDEXDJX' : '.IXIC:INDEXNASDAQ');
      var resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!resp.ok) continue;
      var html = await resp.text();
      // Extract price from the data attribute
      var priceMatch = html.match(/data-last-price="([0-9.]+)"/);
      var changeMatch = html.match(/data-last-normal-market-change-percent="([0-9.\-]+)"/);
      if (priceMatch) {
        quotes.push({
          symbol: sym,
          price: parseFloat(priceMatch[1]) || null,
          changesPercentage: changeMatch ? parseFloat(changeMatch[1]) : null
        });
      }
    } catch (e) { /* skip */ }
  }
  if (!quotes.length) throw new Error('Google Finance returned no data');
  return quotes;
}

function normalizeQuoteSymbols(quotes) {
  var displayMap = {};
  SYMBOLS.forEach(function(s) { 
    displayMap[s.symbol] = s.display || decodeURIComponent(s.symbol);
    displayMap[decodeURIComponent(s.symbol)] = s.display || decodeURIComponent(s.symbol);
  });
  return quotes.map(function(q) {
    q.symbol = displayMap[q.symbol] || decodeURIComponent(q.symbol);
    return q;
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

export async function onRequestGet() {
  var errors = [];

  // Try Yahoo v7
  try {
    var quotes = await fetchYahoo();
    return jsonResp(200, { ok: true, quotes: normalizeQuoteSymbols(quotes), source: 'yahoo-v7' });
  } catch (e) { errors.push('yahoo-v7: ' + e.message); }

  // Try Yahoo v8
  try {
    var quotes = await fetchYahooV8();
    return jsonResp(200, { ok: true, quotes: normalizeQuoteSymbols(quotes), source: 'yahoo-v8' });
  } catch (e) { errors.push('yahoo-v8: ' + e.message); }

  // Try Google Finance
  try {
    var quotes = await fetchGoogleFinance();
    return jsonResp(200, { ok: true, quotes: normalizeQuoteSymbols(quotes), source: 'google' });
  } catch (e) { errors.push('google: ' + e.message); }

  return jsonResp(200, { ok: false, error: errors.join(' | '), quotes: [] });
}
