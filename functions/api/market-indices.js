// Cloudflare Pages Function: /api/market-indices
// Yahoo Finance (free, no key needed)

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

function normalizeSymbol(sym) {
  var map = {};
  SYMBOLS.forEach(function(s) {
    map[s.symbol] = s.display;
    map[decodeURIComponent(s.symbol)] = s.display;
  });
  return map[sym] || decodeURIComponent(sym);
}

async function fetchQuotesAndCharts() {
  // Fetch 5-day chart data for all symbols (includes current quote in meta)
  var results = [];

  for (var i = 0; i < SYMBOLS.length; i++) {
    var sym = SYMBOLS[i].symbol;
    var url = 'https://query2.finance.yahoo.com/v8/finance/chart/' + sym + '?interval=1d&range=5d';

    try {
      var resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!resp.ok) continue;
      var data = await resp.json();
      var chart = data && data.chart && data.chart.result && data.chart.result[0];
      if (!chart) continue;

      var meta = chart.meta || {};
      var price = Number(meta.regularMarketPrice);
      // Use previousClose (yesterday's close) for daily change, NOT chartPreviousClose (5-day ago)
      var prevClose = Number(meta.previousClose);
      // Fallback to chartPreviousClose only if previousClose is missing
      if (!isFinite(prevClose) || prevClose <= 0) {
        prevClose = Number(meta.chartPreviousClose);
      }
      var pct = (isFinite(price) && isFinite(prevClose) && prevClose > 0)
        ? ((price - prevClose) / prevClose) * 100 : null;

      // Extract 5-day closing prices for sparkline
      var timestamps = chart.timestamp || [];
      var closes = (chart.indicators && chart.indicators.quote && chart.indicators.quote[0] && chart.indicators.quote[0].close) || [];
      var sparkline = [];
      for (var j = 0; j < timestamps.length; j++) {
        if (closes[j] != null && isFinite(closes[j])) {
          sparkline.push(Math.round(closes[j] * 100) / 100);
        }
      }
      // Add current price as last point if different from last close
      if (isFinite(price) && (sparkline.length === 0 || sparkline[sparkline.length - 1] !== price)) {
        sparkline.push(Math.round(price * 100) / 100);
      }

      // Market state: REGULAR = open, PRE = pre-market, POST = after hours, CLOSED/PREPRE = closed
      var marketState = (meta.marketState || '').toUpperCase();
      var exchangeClose = meta.currentTradingPeriod && meta.currentTradingPeriod.regular && meta.currentTradingPeriod.regular.end;
      var lastTradeTime = meta.regularMarketTime;

      results.push({
        symbol: normalizeSymbol(sym),
        price: isFinite(price) ? price : null,
        previousClose: isFinite(prevClose) ? prevClose : null,
        changesPercentage: isFinite(pct) ? pct : null,
        change: (isFinite(price) && isFinite(prevClose)) ? Math.round((price - prevClose) * 100) / 100 : null,
        sparkline: sparkline,
        marketState: marketState,
        lastTradeTimestamp: lastTradeTime || null,
        exchange: meta.exchangeName || null
      });
    } catch (e) { /* skip failed symbol */ }
  }

  if (!results.length) throw new Error('No data returned from Yahoo');
  return results;
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
  try {
    var quotes = await fetchQuotesAndCharts();

    // Determine market status from first quote
    var mktState = quotes[0] && quotes[0].marketState ? quotes[0].marketState : 'CLOSED';
    var isOpen = mktState === 'REGULAR';
    var isPrePost = mktState === 'PRE' || mktState === 'POST' || mktState === 'POSTPOST';
    var lastTs = quotes[0] && quotes[0].lastTradeTimestamp ? quotes[0].lastTradeTimestamp : null;

    return jsonResp(200, {
      ok: true,
      quotes: quotes,
      marketStatus: isOpen ? 'open' : (isPrePost ? 'prepost' : 'closed'),
      marketState: mktState,
      lastUpdated: lastTs,
      source: 'yahoo-v8'
    });
  } catch (err) {
    return jsonResp(200, { ok: false, error: err.message || 'Failed.', quotes: [] });
  }
}
