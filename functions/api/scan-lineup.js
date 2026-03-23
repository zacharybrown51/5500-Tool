// Cloudflare Pages Function: /api/scan-lineup
// Extracts investment lineup from 5500 PDF text + SEC EDGAR fallback
// Zero AI cost — pure pattern matching

// ============================================================
// FUND FAMILY DATABASE
// ============================================================
const FUND_FAMILIES = [
  { name: 'Vanguard', patterns: [/\bvanguard\b/i], tdf: /vanguard\s+target\s+retirement\s+(\d{4})/i },
  { name: 'Fidelity', patterns: [/\bfidelity\b/i], tdf: /fidelity\s+freedom\s+(?:index\s+)?(\d{4})/i },
  { name: 'T. Rowe Price', patterns: [/\bt\.?\s*rowe\s*price\b/i], tdf: /t\.?\s*rowe\s*price\s+retirement\s+(\d{4})/i },
  { name: 'BlackRock', patterns: [/\bblackrock\b/i, /\bishares\b/i], tdf: /(?:blackrock\s+)?lifepath\s+(?:index\s+)?(\d{4})/i },
  { name: 'JPMorgan', patterns: [/\bjpmorgan\b/i, /\bjp\s*morgan\b/i], tdf: /jpmorgan\s+smartretirement\s+(\d{4})/i },
  { name: 'Schwab', patterns: [/\bschwab\b/i], tdf: /schwab\s+target\s+(\d{4})/i },
  { name: 'American Funds', patterns: [/\bamerican\s+funds\b/i, /\bcapital\s+group\b/i], tdf: /american\s+funds\s+target\s+date\s+retirement\s+(\d{4})/i },
  { name: 'Principal', patterns: [/\bprincipal\b/i], tdf: /principal\s+lifetime\s+(?:hybrid\s+)?(\d{4})/i },
  { name: 'John Hancock', patterns: [/\bjohn\s+hancock\b/i], tdf: /john\s+hancock\s+(?:multi[- ]?index\s+)?(?:lifetime\s+)?(\d{4})/i },
  { name: 'Nationwide', patterns: [/\bnationwide\b/i], tdf: /nationwide\s+destination\s+(\d{4})/i },
  { name: 'MassMutual', patterns: [/\bmassmutual\b/i, /\bmass\s+mutual\b/i], tdf: /massmutual\s+retir(?:esmart|ement)\s+(?:by\s+)?(\d{4})/i },
  { name: 'Empower', patterns: [/\bempower\b/i, /\bgreat[- ]?west\b/i], tdf: /empower\s+target\s+(?:date\s+)?(\d{4})/i },
  { name: 'Lincoln Financial', patterns: [/\blincoln\b/i], tdf: /lincoln\s+(?:director\s+)?(\d{4})/i },
  { name: 'Transamerica', patterns: [/\btransamerica\b/i], tdf: /transamerica\s+(?:clearn?path|retirement\s+solutions)\s+(\d{4})/i },
  { name: 'TIAA', patterns: [/\btiaa\b/i, /\bnuveen\b/i, /\bcref\b/i], tdf: /tiaa[- ]?cref\s+lifecycle\s+(?:index\s+)?(\d{4})/i },
  { name: 'Putnam', patterns: [/\bputnam\b/i], tdf: /putnam\s+retirement\s+advantage\s+(\d{4})/i },
  { name: 'Franklin Templeton', patterns: [/\bfranklin\b/i, /\btempleton\b/i], tdf: /franklin\s+(?:templeton\s+)?(?:lifesmart\s+)?(\d{4})\s+target/i },
  { name: 'Invesco', patterns: [/\binvesco\b/i], tdf: /invesco\s+balanced[- ]?risk\s+retirement\s+(\d{4})/i },
  { name: 'PIMCO', patterns: [/\bpimco\b/i], tdf: /pimco\s+realpath\s+(?:blend\s+)?(\d{4})/i },
  { name: 'State Street', patterns: [/\bstate\s+street\b/i, /\bssga\b/i, /\bspy\b/i], tdf: /state\s+street\s+target\s+retirement\s+(\d{4})/i },
  { name: 'Dimensional (DFA)', patterns: [/\bdimensional\b/i, /\bdfa\b/i], tdf: /dimensional\s+(\d{4})\s+target/i },
  { name: 'Wells Fargo / Allspring', patterns: [/\bwells\s+fargo\b/i, /\ballspring\b/i], tdf: /(?:wells\s+fargo|allspring)\s+target\s+(?:date\s+)?(\d{4})/i },
  { name: 'MFS', patterns: [/\bmfs\b/i], tdf: /mfs\s+lifetime\s+(\d{4})/i },
  { name: 'Columbia Threadneedle', patterns: [/\bcolumbia\b/i], tdf: /columbia\s+(?:threadneedle\s+)?(?:adaptive\s+)?retirement\s+(\d{4})/i },
  { name: 'Nuveen', patterns: [/\bnuveen\b/i], tdf: /nuveen\s+lifecycle\s+(\d{4})/i },
  { name: 'Federated Hermes', patterns: [/\bfederated\b/i], tdf: /federated\s+hermes\s+target\s+(\d{4})/i },
  { name: 'American Century', patterns: [/\bamerican\s+century\b/i], tdf: /american\s+century\s+one\s+choice\s+(\d{4})/i },
  { name: 'Manning & Napier', patterns: [/\bmanning\b/i], tdf: /manning\s+.*target\s+(\d{4})/i },
  { name: 'AB (AllianceBernstein)', patterns: [/\balliancebernstein\b/i, /\b(?:^|\s)ab\s/i], tdf: /ab\s+(\d{4})\s+(?:multi[- ]?manager|target)/i },
  { name: 'Harbor', patterns: [/\bharbor\b/i], tdf: /harbor\s+target\s+retirement\s+(\d{4})/i },
  { name: 'Wilshire', patterns: [/\bwilshire\b/i], tdf: /wilshire\s+(\d{4})/i },
  { name: 'Northern Trust', patterns: [/\bnorthern\s+trust\b/i], tdf: null },
  { name: 'MetLife', patterns: [/\bmetlife\b/i], tdf: null },
  { name: 'Prudential', patterns: [/\bprudential\b/i, /\bpgim\b/i], tdf: /prudential\s+day\s+one\s+(\d{4})/i },
  { name: 'Goldman Sachs', patterns: [/\bgoldman\s+sachs\b/i, /\bgs\s+fund\b/i], tdf: /goldman\s+sachs\s+target\s+date\s+(\d{4})/i },
  { name: 'Morgan Stanley', patterns: [/\bmorgan\s+stanley\b/i, /\beaton\s+vance\b/i], tdf: null },
  { name: 'Dodge & Cox', patterns: [/\bdodge\s*&?\s*cox\b/i], tdf: null },
  { name: 'Lord Abbett', patterns: [/\blord\s+abbett\b/i], tdf: null },
  { name: 'Baird', patterns: [/\bbaird\b/i], tdf: null },
  { name: 'Hartford', patterns: [/\bhartford\b/i], tdf: /hartford\s+target\s+retirement\s+(\d{4})/i },
  { name: 'Guideline', patterns: [/\bguideline\b/i], tdf: null },
];

// Generic TDF catch-all pattern
const GENERIC_TDF = /(?:target\s+(?:date|retirement)|lifecycle|lifepath|life\s*path|retirement\s+(?:\d{4}|fund)|freedom\s+\d{4})\s*(\d{4})?/gi;

// Fund type patterns
const FUND_TYPES = [
  { type: 'Target Date Fund', pattern: /target\s+(?:date|retirement)|lifecycle|lifepath|life\s*path|freedom\s+\d{4}|smartretirement|retir(?:esmart|ement\s+\d{4})|one\s+choice\s+\d{4}|lifetime\s+\d{4}/i },
  { type: 'Index Fund', pattern: /\bindex\s+(?:fund|trust)\b|\b(?:500|s&p|total\s+(?:stock|bond|intl)|russell|msci)\s+index\b/i },
  { type: 'Stable Value', pattern: /\bstable\s+value\b|\bfixed\s+income\b.*\bstable\b|\bgic\b|\bguaranteed\b/i },
  { type: 'Money Market', pattern: /\bmoney\s+market\b|\bcash\s+(?:reserve|management)\b/i },
  { type: 'Bond Fund', pattern: /\bbond\b|\bfixed\s+income\b|\baggregate\b|\bcore\s+plus\b|\btotal\s+return\b.*\bbond\b/i },
  { type: 'International', pattern: /\binternational\b|\bforeign\b|\bemerging\b|\bglobal\b|\bintl\b|\boverseas\b/i },
  { type: 'Large Cap', pattern: /\blarge\s*cap\b|\blg\s*cap\b|\b(?:growth|value)\s+(?:fund|trust)\b|\bs&p\s*500\b/i },
  { type: 'Small/Mid Cap', pattern: /\bsmall\s*cap\b|\bmid\s*cap\b|\bsm\s*cap\b|\bmd\s*cap\b|\bsmid\b/i },
  { type: 'Real Estate', pattern: /\breal\s+estate\b|\breit\b|\bproperty\b/i },
  { type: 'Company Stock', pattern: /\bcompany\s+stock\b|\bemployer\s+(?:stock|securities)\b|\besop\b/i },
  { type: 'Brokerage Window', pattern: /\bbrokerage\s+(?:window|account|option)\b|\bself[- ]?directed\b/i },
];

// ============================================================
// PDF TEXT EXTRACTION (lightweight, no dependencies)
// ============================================================
function extractTextFromPDF(uint8Array) {
  // Simple PDF text extractor — handles most text-based PDFs
  // Converts the PDF bytes to string and extracts text between BT/ET markers
  // and also handles stream content
  var text = '';
  var bytes = uint8Array;
  var str = '';
  
  // Convert to string for regex processing
  for (var i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  
  // Method 1: Extract text objects (between BT and ET)
  var textBlocks = str.match(/BT[\s\S]*?ET/g) || [];
  for (var i = 0; i < textBlocks.length; i++) {
    // Extract text from Tj and TJ operators
    var tjMatches = textBlocks[i].match(/\(([^)]*)\)\s*Tj/g) || [];
    for (var j = 0; j < tjMatches.length; j++) {
      var m = tjMatches[j].match(/\(([^)]*)\)/);
      if (m) text += m[1] + ' ';
    }
    // TJ arrays
    var tjArrays = textBlocks[i].match(/\[(.*?)\]\s*TJ/g) || [];
    for (var j = 0; j < tjArrays.length; j++) {
      var parts = tjArrays[j].match(/\(([^)]*)\)/g) || [];
      for (var k = 0; k < parts.length; k++) {
        var pm = parts[k].match(/\(([^)]*)\)/);
        if (pm) text += pm[1];
      }
      text += ' ';
    }
  }
  
  // Method 2: Also try to find readable ASCII strings (fallback for complex PDFs)
  var asciiChunks = str.match(/[\x20-\x7E]{10,}/g) || [];
  var asciiText = asciiChunks.join(' ');
  
  // Use whichever produced more useful text
  if (asciiText.length > text.length * 2) {
    text = asciiText;
  }
  
  // Clean up
  text = text
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
  
  return text;
}

// ============================================================
// PATTERN MATCHING ENGINE
// ============================================================
function scanForFunds(text) {
  var results = {
    fundFamilies: [],
    tdfProvider: null,
    tdfYears: [],
    funds: [],
    confidence: 'none',
    textLength: text.length,
  };
  
  if (!text || text.length < 50) return results;
  
  // Scan for fund families
  var familyHits = {};
  for (var i = 0; i < FUND_FAMILIES.length; i++) {
    var ff = FUND_FAMILIES[i];
    var matched = false;
    for (var j = 0; j < ff.patterns.length; j++) {
      if (ff.patterns[j].test(text)) { matched = true; break; }
    }
    if (matched) {
      familyHits[ff.name] = { name: ff.name, hasTDF: false, tdfYears: [] };
      
      // Check for TDF
      if (ff.tdf) {
        var tdfMatches = text.match(new RegExp(ff.tdf.source, 'gi')) || [];
        if (tdfMatches.length > 0) {
          familyHits[ff.name].hasTDF = true;
          for (var k = 0; k < tdfMatches.length; k++) {
            var ym = tdfMatches[k].match(/(\d{4})/);
            if (ym) {
              var yr = parseInt(ym[1]);
              if (yr >= 2020 && yr <= 2075 && familyHits[ff.name].tdfYears.indexOf(yr) < 0) {
                familyHits[ff.name].tdfYears.push(yr);
              }
            }
          }
          familyHits[ff.name].tdfYears.sort();
        }
      }
    }
  }
  
  results.fundFamilies = Object.values(familyHits);
  
  // Determine primary TDF provider (the one with the most year matches)
  var bestTDF = null;
  var bestCount = 0;
  for (var fname in familyHits) {
    var fh = familyHits[fname];
    if (fh.hasTDF && fh.tdfYears.length > bestCount) {
      bestTDF = fh;
      bestCount = fh.tdfYears.length;
    }
  }
  if (bestTDF) {
    results.tdfProvider = bestTDF.name;
    results.tdfYears = bestTDF.tdfYears;
  }
  
  // Extract individual fund names (lines that look like fund names)
  // Look for patterns like "Fund Name    $1,234,567" or "Fund Name    1234567"
  var fundLines = text.match(/[A-Z][A-Za-z\s&.'()-]+(?:Fund|Trust|Portfolio|Idx|Index|ETF|Class\s+[A-Z]|Instl?|Institutional|Retirement|Target|Bond|Stock|Income|Growth|Value|Intl|International|Cap)\s*[\$\d,]+/g) || [];
  
  var seenFunds = {};
  for (var i = 0; i < fundLines.length; i++) {
    var line = fundLines[i].trim();
    // Extract fund name (before the dollar amount)
    var nameMatch = line.match(/^(.+?)\s+[\$]?[\d,]+/);
    if (nameMatch) {
      var fundName = nameMatch[1].trim();
      if (fundName.length > 5 && fundName.length < 100 && !seenFunds[fundName.toLowerCase()]) {
        seenFunds[fundName.toLowerCase()] = true;
        
        // Classify the fund
        var fundType = 'Unknown';
        for (var j = 0; j < FUND_TYPES.length; j++) {
          if (FUND_TYPES[j].pattern.test(fundName)) {
            fundType = FUND_TYPES[j].type;
            break;
          }
        }
        
        // Try to extract the dollar value
        var valMatch = line.match(/[\$]?([\d,]+(?:\.\d{2})?)\s*$/);
        var value = valMatch ? parseInt(valMatch[1].replace(/[,]/g, '')) : null;
        
        results.funds.push({ name: fundName, type: fundType, value: value });
      }
    }
  }
  
  // Set confidence
  if (results.funds.length >= 3 && results.tdfProvider) {
    results.confidence = 'high';
  } else if (results.fundFamilies.length >= 2 || results.funds.length >= 2) {
    results.confidence = 'medium';
  } else if (results.fundFamilies.length >= 1 || results.funds.length >= 1) {
    results.confidence = 'low';
  }
  
  return results;
}

// ============================================================
// SEC EDGAR FALLBACK (free, no API key)
// ============================================================
async function searchEDGAR(ein, planName) {
  // Use SEC's free EFTS (full-text search) API
  // Search for the EIN across N-PORT and 11-K filings
  var results = { filings: [], fundFamilies: [], source: 'edgar' };
  
  if (!ein) return results;
  
  // Clean EIN format
  var cleanEIN = ein.replace(/[^0-9]/g, '');
  if (cleanEIN.length === 9) {
    cleanEIN = cleanEIN.substring(0, 2) + '-' + cleanEIN.substring(2);
  }
  
  try {
    // Search EDGAR EFTS for this EIN in annual report filings
    var searchUrl = 'https://efts.sec.gov/LATEST/search-index?q=%22' + encodeURIComponent(cleanEIN) + '%22&dateRange=custom&startdt=2023-01-01&forms=N-CEN,11-K,N-PORT&hits.hits.total=10';
    
    // Also try the simpler EDGAR full text search
    var eftsUrl = 'https://efts.sec.gov/LATEST/search-index?q=%22' + encodeURIComponent(cleanEIN) + '%22&forms=11-K&hits.hits._source=file_description,form_type,file_date,display_names';
    
    // Use the public EDGAR search API
    var searchUrl2 = 'https://efts.sec.gov/LATEST/search-index?q=%22' + encodeURIComponent(cleanEIN) + '%22&forms=11-K,N-CEN&from=0&size=5';
    
    // Try the working EDGAR full-text search endpoint
    var resp = await fetch('https://efts.sec.gov/LATEST/search-index?q=%22' + cleanEIN + '%22&forms=11-K&size=5', {
      headers: { 
        'User-Agent': 'Mammini401kProspector/1.0 support@mammini.com',
        'Accept': 'application/json'
      }
    });
    
    if (resp.ok) {
      var data = await resp.json();
      if (data.hits && data.hits.hits) {
        for (var i = 0; i < data.hits.hits.length; i++) {
          var hit = data.hits.hits[i]._source || {};
          results.filings.push({
            form: hit.form_type || hit.file_type || '',
            date: hit.file_date || '',
            names: hit.display_names || [],
            description: hit.file_description || ''
          });
        }
      }
    }
  } catch (e) {
    // EDGAR search failed silently — not critical
    results.error = e.message;
  }
  
  // Also try the submissions API (always works, no auth needed)
  try {
    // Look up company by EIN via the company search
    var companyUrl = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=' + encodeURIComponent(planName || '') + '&type=11-K&dateb=&owner=include&count=5&search_text=&action=getcompany&output=atom';
    // This is XML but we can check if it returns anything
  } catch (e) {
    // Silent fail
  }
  
  return results;
}

// ============================================================
// MAIN HANDLER
// ============================================================
function jsonResp(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
  });
}

export async function onRequestOptions() {
  return new Response('', {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
  });
}

export async function onRequestPost({ request }) {
  try {
    var body = await request.json();
    var mode = body.mode || 'scan';
    
    if (mode === 'scan' && body.base64) {
      // Decode PDF
      var binaryStr = atob(body.base64);
      var bytes = new Uint8Array(binaryStr.length);
      for (var i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      
      // Extract text
      var text = extractTextFromPDF(bytes);
      
      // Scan for funds
      var scanResult = scanForFunds(text);
      
      // If low/no confidence, try EDGAR fallback
      var edgarResult = null;
      if (scanResult.confidence === 'none' || scanResult.confidence === 'low') {
        edgarResult = await searchEDGAR(body.ein || '', body.planName || '');
      }
      
      return jsonResp(200, {
        ok: true,
        scan: scanResult,
        edgar: edgarResult,
        method: scanResult.confidence !== 'none' ? 'pdf-scan' : 'edgar-fallback',
        textExtracted: text.length,
      });
    }
    
    if (mode === 'edgar-lookup') {
      // Direct EDGAR lookup by EIN
      var edgarResult = await searchEDGAR(body.ein || '', body.planName || '');
      return jsonResp(200, {
        ok: true,
        edgar: edgarResult,
        method: 'edgar-direct'
      });
    }
    
    return jsonResp(400, { ok: false, error: 'Invalid mode. Use "scan" with base64 PDF or "edgar-lookup" with ein.' });
    
  } catch (err) {
    return jsonResp(200, { ok: false, error: err.message || 'Scan failed.' });
  }
}
