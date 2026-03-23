// Cloudflare Pages Function: /api/market-indices
// Yahoo Finance — dual fetch: quote for daily data, chart for sparklines

const SYMBOLS = [
  { symbol: '%5EGSPC', label: 'S&P 500', display: '^GSPC' },
  { symbol: '%5EDJI', label: 'Dow', display: '^DJI' },
  { symbol: '%5EIXIC', label: 'Nasdaq', display: '^IXIC' }
];

const YF_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

function jsonResp(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
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

// Fetch sparkline data from chart endpoint
async function fetchSparklines() {
  var sparklines = {};
  for (var i = 0; i < SYMBOLS.length; i++) {
    var sym = SYMBOLS[i].symbol;
    try {
      var url = 'https://query2.finance.yahoo.com/v8/finance/chart/' + sym + '?interval=1d&range=5d';
      var resp = await fetch(url, { headers: YF_HEADERS });
      if (!resp.ok) continue;
      var data = await resp.json();
      var chart = data && data.chart && data.chart.result && data.chart.result[0];
      if (!chart) continue;

      var closes = (chart.indicators && chart.indicators.quote && chart.indicators.quote[0] && chart.indicators.quote[0].close) || [];
      var sparkline = [];
      for (var j = 0; j < closes.length; j++) {
        if (closes[j] != null && isFinite(closes[j])) {
          sparkline.push(Math.round(closes[j] * 100) / 100);
        }
      }
      sparklines[SYMBOLS[i].display] = sparkline;
    } catch (e) { /* skip */ }
  }
  return sparklines;
}

// Fetch real-time quotes — try multiple Yahoo endpoints
async function fetchQuotes() {
  var symbolList = SYMBOLS.map(function(s) { return s.symbol; }).join(',');

  // Try v7 quote endpoint (best for real-time daily data)
  try {
    var url7 = 'https://query2.finance.yahoo.com/v7/finance/quote?symbols=' + symbolList;
    var resp7 = await fetch(url7, { headers: YF_HEADERS });
    if (resp7.ok) {
      var data7 = await resp7.json();
      if (data7 && data7.quoteResponse && data7.quoteResponse.result && data7.quoteResponse.result.length) {
        return { source: 'v7-quote', quotes: data7.quoteResponse.result };
      }
    }
  } catch (e) { /* try next */ }

  // Try v6 quote endpoint
  try {
    var url6 = 'https://query2.finance.yahoo.com/v6/finance/quote?symbols=' + symbolList;
    var resp6 = await fetch(url6, { headers: YF_HEADERS });
    if (resp6.ok) {
      var data6 = await resp6.json();
      if (data6 && data6.quoteResponse && data6.quoteResponse.result && data6.quoteResponse.result.length) {
        return { source: 'v6-quote', quotes: data6.quoteResponse.result };
      }
    }
  } catch (e) { /* try next */ }

  // Fallback: use chart meta for each symbol individually
  var results = [];
  for (var i = 0; i < SYMBOLS.length; i++) {
    var sym = SYMBOLS[i].symbol;
    try {
      var chartUrl = 'https://query2.finance.yahoo.com/v8/finance/chart/' + sym + '?interval=1d&range=1d';
      var chartResp = await fetch(chartUrl, { headers: YF_HEADERS });
      if (!chartResp.ok) continue;
      var chartData = await chartResp.json();
      var chart = chartData && chartData.chart && chartData.chart.result && chartData.chart.result[0];
      if (!chart) continue;
      var meta = chart.meta || {};

      // For 1d range, chartPreviousClose IS yesterday's close
      var price = meta.regularMarketPrice;
      var prevClose = meta.chartPreviousClose || meta.previousClose;

      results.push({
        symbol: meta.symbol || decodeURIComponent(sym),
        regularMarketPrice: price,
        regularMarketPreviousClose: prevClose,
        regularMarketChange: (price && prevClose) ? price - prevClose : null,
        regularMarketChangePercent: (price && prevClose && prevClose > 0) ? ((price - prevClose) / prevClose) * 100 : null,
        marketState: meta.marketState,
        regularMarketTime: meta.regularMarketTime,
        exchangeName: meta.exchangeName,
        _fromChart: true
      });
    } catch (e) { /* skip */ }
  }
  return { source: 'v8-chart-1d-fallback', quotes: results };
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
    // Fetch quotes and sparklines in parallel
    var [quoteResult, sparklines] = await Promise.all([
      fetchQuotes(),
      fetchSparklines()
    ]);

    var rawQuotes = quoteResult.quotes;
    var source = quoteResult.source;
    var results = [];
    var marketState = '';

    for (var i = 0; i < rawQuotes.length; i++) {
      var q = rawQuotes[i];
      var sym = normalizeSymbol(q.symbol || '');

      var price = Number(q.regularMarketPrice);
      var prevClose = Number(q.regularMarketPreviousClose);
      var change = Number(q.regularMarketChange);
      var changePct = Number(q.regularMarketChangePercent);

      // If change data is missing, compute from price & prevClose
      if (!isFinite(change) && isFinite(price) && isFinite(prevClose) && prevClose > 0) {
        change = Math.round((price - prevClose) * 100) / 100;
        changePct = ((price - prevClose) / prevClose) * 100;
      }

      var state = (q.marketState || '').toUpperCase();
      if (!marketState && state) marketState = state;

      // Get sparkline and append current price
      var spark = (sparklines[sym] || []).slice();
      if (isFinite(price) && (spark.length === 0 || spark[spark.length - 1] !== Math.round(price * 100) / 100)) {
        spark.push(Math.round(price * 100) / 100);
      }

      results.push({
        symbol: sym,
        price: isFinite(price) ? price : null,
        previousClose: isFinite(prevClose) ? prevClose : null,
        changesPercentage: isFinite(changePct) ? changePct : null,
        change: isFinite(change) ? change : null,
        sparkline: spark,
        marketState: state,
        lastTradeTimestamp: q.regularMarketTime || null,
        exchange: q.exchangeName || q.fullExchangeName || null
      });
    }

    if (!results.length) throw new Error('No data returned');

    // Determine market status
    var isOpen = marketState === 'REGULAR';
    var isPrePost = marketState === 'PRE' || marketState === 'POST' || marketState === 'POSTPOST';
    var lastTs = results[0] && results[0].lastTradeTimestamp ? results[0].lastTradeTimestamp : null;

    return jsonResp(200, {
      ok: true,
      quotes: results,
      marketStatus: isOpen ? 'open' : (isPrePost ? 'prepost' : 'closed'),
      marketState: marketState,
      lastUpdated: lastTs,
      source: source,
      _debug: {
        rawMarketState: marketState,
        firstQuote: results[0] ? {
          price: results[0].price,
          prevClose: results[0].previousClose,
          change: results[0].change,
          changePct: results[0].changesPercentage
        } : null,
        fetchedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    return jsonResp(200, { ok: false, error: err.message || 'Failed.', quotes: [], _debug: { error: String(err) } });
  }
}
