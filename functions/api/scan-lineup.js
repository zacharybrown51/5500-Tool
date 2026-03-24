// Cloudflare Pages Function: /api/scan-lineup
// Extracts investment lineup from 5500 PDF text + SEC EDGAR fallback
// Zero AI cost — pure pattern matching

// ============================================================
// FUND FAMILY DATABASE
// ============================================================
const FUND_FAMILIES = [
  { name: 'Vanguard', patterns: [/\bvanguard\b/i], tdf: [
    /vanguard\b.{0,30}(?:target|trgt?|tgt)\b.{0,20}(?:ret(?:irement)?|ret)\b.{0,10}(\d{4})/i,
    /vanguard\b.{0,30}(\d{4})\b.{0,20}(?:target|trgt?|tgt)/i,
    /\bvtrs?x?\b.{0,10}(\d{4})/i,
  ]},
  { name: 'Fidelity', patterns: [/\bfidelity\b/i, /\bfid\s/i], tdf: [
    /fidelity\b.{0,20}freedom\b.{0,20}(?:index\s+)?(\d{4})/i,
    /freedom\b.{0,20}(?:index\s+)?(\d{4})\b.{0,20}(?:fund|fd|cl|class|k|commingled|cit)/i,
    /\bfreedom\s+(?:index\s+)?(\d{4})\b/i,
    /fidelity\b.{0,30}(\d{4})\b.{0,20}(?:fund|fd|commingled|cit)/i,
  ]},
  { name: 'T. Rowe Price', patterns: [/\bt\.?\s*rowe/i, /\btrowe/i, /\btrp\b/i], tdf: [
    /t\.?\s*rowe\b.{0,20}(?:ret(?:irement)?|retire)\b.{0,10}(\d{4})/i,
    /t\.?\s*rowe\b.{0,30}(\d{4})\b.{0,20}(?:fund|fd|trust|cit)/i,
    /\btrp\b.{0,20}ret(?:irement)?\b.{0,10}(\d{4})/i,
  ]},
  { name: 'BlackRock', patterns: [/\bblackrock\b/i, /\bishares\b/i, /\blifepath\b/i], tdf: [
    /lifepath\b.{0,20}(?:index\s+)?(?:ret(?:irement)?\s+)?(\d{4})/i,
    /blackrock\b.{0,30}(?:lifepath|target|tgt)\b.{0,20}(\d{4})/i,
    /\blifepath\b.{0,10}(\d{4})/i,
  ]},
  { name: 'JPMorgan', patterns: [/\bjp\s*morgan\b/i, /\bjpmcb\b/i, /\bsmart\s*ret/i], tdf: [
    /(?:jp\s*morgan|jpmcb)\b.{0,30}smart\s*ret(?:irement)?\b.{0,10}(\d{4})/i,
    /smart\s*ret(?:irement)?\b.{0,10}(?:blend\s+)?(\d{4})/i,
    /jp\s*morgan\b.{0,30}(\d{4})\b.{0,20}(?:fund|fd|cit)/i,
  ]},
  { name: 'Schwab', patterns: [/\bschwab\b/i], tdf: [
    /schwab\b.{0,20}(?:target|tgt)\b.{0,10}(\d{4})/i,
    /schwab\b.{0,30}(\d{4})\b.{0,20}(?:fund|fd|index)/i,
  ]},
  { name: 'American Funds', patterns: [/\bamerican\s+funds\b/i, /\bcapital\s+group\b/i, /\bamcap\b/i], tdf: [
    /american\s+funds?\b.{0,30}(?:target|tgt)\b.{0,20}(?:date\s+)?(?:ret(?:irement)?\s+)?(\d{4})/i,
    /(?:capital\s+group|american\s+funds?)\b.{0,30}(\d{4})\b/i,
  ]},
  { name: 'Principal', patterns: [/\bprincipal\b/i], tdf: [
    /principal\b.{0,20}(?:lifetime|life\s*time)\b.{0,20}(?:hybrid\s+)?(\d{4})/i,
    /principal\b.{0,30}(\d{4})\b.{0,20}(?:fund|fd|trust|cit|sep)/i,
  ]},
  { name: 'John Hancock', patterns: [/\bjohn\s*hancock\b/i, /\bjhancock\b/i], tdf: [
    /(?:john\s*hancock|jhancock)\b.{0,30}(?:multi|lifetime|life)\b.{0,20}(\d{4})/i,
    /(?:john\s*hancock|jhancock)\b.{0,30}(\d{4})\b/i,
  ]},
  { name: 'Nationwide', patterns: [/\bnationwide\b/i], tdf: [
    /nationwide\b.{0,20}(?:destination|dest)\b.{0,10}(\d{4})/i,
    /nationwide\b.{0,30}(\d{4})\b/i,
  ]},
  { name: 'MassMutual', patterns: [/\bmassmutual\b/i, /\bmass\s*mutual\b/i], tdf: [
    /mass\s*mutual\b.{0,20}(?:retire\s*smart|ret(?:irement)?)\b.{0,10}(\d{4})/i,
    /retire\s*smart\b.{0,10}(?:by\s+)?(\d{4})/i,
  ]},
  { name: 'Empower', patterns: [/\bempower\b/i, /\bgreat[- ]?west\b/i, /\bgwrs\b/i], tdf: [
    /empower\b.{0,20}(?:target|tgt)\b.{0,10}(\d{4})/i,
    /great[- ]?west\b.{0,20}(?:target|tgt|lifetime)\b.{0,10}(\d{4})/i,
  ]},
  { name: 'Lincoln Financial', patterns: [/\blincoln\b/i], tdf: [
    /lincoln\b.{0,20}(?:director|target)\b.{0,10}(\d{4})/i,
  ]},
  { name: 'Transamerica', patterns: [/\btransamerica\b/i], tdf: [
    /transamerica\b.{0,20}(?:clear\s*path|ret(?:irement)?)\b.{0,10}(\d{4})/i,
    /clear\s*path\b.{0,10}(\d{4})/i,
  ]},
  { name: 'TIAA', patterns: [/\btiaa\b/i, /\bcref\b/i], tdf: [
    /tiaa\b.{0,20}(?:cref\s+)?lifecycle\b.{0,20}(?:index\s+)?(\d{4})/i,
    /\blifecycle\b.{0,15}(?:index\s+)?(\d{4})\b.{0,20}(?:fund|fd|cit|ret)/i,
  ]},
  { name: 'Putnam', patterns: [/\bputnam\b/i], tdf: [
    /putnam\b.{0,20}(?:ret(?:irement)?\s+)?(?:advantage|sustainable)\b.{0,10}(\d{4})/i,
  ]},
  { name: 'Franklin Templeton', patterns: [/\bfranklin\b/i, /\btempleton\b/i], tdf: [
    /franklin\b.{0,30}(?:lifesmart|target)\b.{0,10}(\d{4})/i,
    /franklin\b.{0,30}(\d{4})\b.{0,20}(?:target|fund|fd)/i,
  ]},
  { name: 'Invesco', patterns: [/\binvesco\b/i], tdf: [
    /invesco\b.{0,20}(?:balanced|target|oppenheimer)\b.{0,20}(\d{4})/i,
  ]},
  { name: 'PIMCO', patterns: [/\bpimco\b/i], tdf: [
    /pimco\b.{0,20}(?:realpath|real\s*path)\b.{0,20}(?:blend\s+)?(\d{4})/i,
  ]},
  { name: 'State Street', patterns: [/\bstate\s+street\b/i, /\bssga\b/i], tdf: [
    /state\s+street\b.{0,20}(?:target|tgt)\b.{0,20}ret(?:irement)?\b.{0,10}(\d{4})/i,
    /ssga\b.{0,20}(?:target|tgt)\b.{0,10}(\d{4})/i,
  ]},
  { name: 'Dimensional (DFA)', patterns: [/\bdimensional\b/i, /\bdfa\b/i], tdf: [
    /dimensional\b.{0,20}(\d{4})\b.{0,20}(?:target|fund|fd)/i,
    /dfa\b.{0,20}(?:target|tgt)\b.{0,10}(\d{4})/i,
  ]},
  { name: 'Wells Fargo / Allspring', patterns: [/\bwells\s+fargo\b/i, /\ballspring\b/i], tdf: [
    /(?:wells\s+fargo|allspring)\b.{0,20}(?:target|tgt)\b.{0,10}(\d{4})/i,
  ]},
  { name: 'MFS', patterns: [/\bmfs\b/i], tdf: [/mfs\b.{0,20}(?:lifetime|life\s*time)\b.{0,10}(\d{4})/i]},
  { name: 'Columbia Threadneedle', patterns: [/\bcolumbia\b/i], tdf: [
    /columbia\b.{0,30}(?:adaptive\s+)?ret(?:irement)?\b.{0,10}(\d{4})/i,
  ]},
  { name: 'Nuveen', patterns: [/\bnuveen\b/i], tdf: [/nuveen\b.{0,20}lifecycle\b.{0,10}(\d{4})/i]},
  { name: 'Federated Hermes', patterns: [/\bfederated\b/i], tdf: [/federated\b.{0,30}(?:target|hermes)\b.{0,10}(\d{4})/i]},
  { name: 'American Century', patterns: [/\bamerican\s+century\b/i], tdf: [
    /american\s+century\b.{0,20}(?:one\s+choice|in\s+ret(?:irement)?)\b.{0,10}(\d{4})/i,
  ]},
  { name: 'Manning & Napier', patterns: [/\bmanning\b/i], tdf: [/manning\b.{0,30}(?:target|tgt)\b.{0,10}(\d{4})/i]},
  { name: 'AB (AllianceBernstein)', patterns: [/\balliancebernstein\b/i, /\bab\s+\d{4}\b/i], tdf: [
    /(?:alliancebernstein|ab)\b.{0,20}(\d{4})\b.{0,20}(?:multi|target|fund|fd)/i,
  ]},
  { name: 'Harbor', patterns: [/\bharbor\b/i], tdf: [/harbor\b.{0,20}(?:target|tgt)\b.{0,10}(\d{4})/i]},
  { name: 'Wilshire', patterns: [/\bwilshire\b/i], tdf: [/wilshire\b.{0,15}(\d{4})/i]},
  { name: 'Northern Trust', patterns: [/\bnorthern\s+trust\b/i], tdf: [/northern\s+trust\b.{0,20}(?:target|focus)\b.{0,10}(\d{4})/i]},
  { name: 'MetLife', patterns: [/\bmetlife\b/i], tdf: [/metlife\b.{0,20}(?:target|tgt)\b.{0,10}(\d{4})/i]},
  { name: 'Prudential', patterns: [/\bprudential\b/i, /\bpgim\b/i], tdf: [
    /(?:prudential|pgim)\b.{0,20}(?:day\s+one|target|tgt)\b.{0,10}(\d{4})/i,
  ]},
  { name: 'Goldman Sachs', patterns: [/\bgoldman\b/i, /\bgs\s+fund\b/i], tdf: [
    /goldman\b.{0,20}(?:target|tgt)\b.{0,10}(\d{4})/i,
  ]},
  { name: 'Morgan Stanley', patterns: [/\bmorgan\s+stanley\b/i, /\beaton\s+vance\b/i], tdf: [
    /morgan\s+stanley\b.{0,20}(?:pathway|target|tgt)\b.{0,10}(\d{4})/i,
  ]},
  { name: 'Hartford', patterns: [/\bhartford\b/i], tdf: [/hartford\b.{0,20}(?:target|tgt)\b.{0,10}(\d{4})/i]},
  { name: 'Dodge & Cox', patterns: [/\bdodge\s*&?\s*cox\b/i], tdf: null },
  { name: 'Lord Abbett', patterns: [/\blord\s+abbett\b/i], tdf: null },
  { name: 'Baird', patterns: [/\bbaird\b/i], tdf: null },
  { name: 'Guideline', patterns: [/\bguideline\b/i], tdf: null },
];

// Generic TDF catch-all — catches ANY target-date pattern regardless of provider
const GENERIC_TDF_PATTERNS = [
  /(?:target\s+(?:date|ret(?:irement)?))\s+(\d{4})/gi,
  /(?:target|tgt)\s+(\d{4})\s+(?:fund|fd|trust|cit|class|blend)/gi,
  /(\d{4})\s+(?:target\s+(?:date|ret)|retirement\s+(?:fund|blend|trust))/gi,
  /(?:lifecycle|lifepath|life\s*path|freedom|smartretirement|retire\s*smart|destination|lifetime|one\s+choice|day\s+one|clear\s*path|realpath)\s+(?:index\s+)?(\d{4})/gi,
];

// Fund type patterns
const FUND_TYPES = [
  { type: 'Target Date Fund', pattern: /target\s+(?:date|retirement)|lifecycle|lifepath|life\s*path|freedom\s+\d{4}|smartretirement|retir(?:esmart|ement\s+\d{4})|one\s+choice\s+\d{4}|lifetime\s+\d{4}/i },
  { type: 'CIT/CIF', pattern: /\bcollective\s+(?:invest(?:ment)?|trust)\b|\b(?:cit|cif)\b|\bcommingled\b|\bcommon\s+trust\b|\btrust\s+(?:fund|class)\b|\bcollective\s+fund\b|\bpooled\s+fund\b/i },
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
    hasCIT: false,
    confidence: 'none',
    textLength: text.length,
  };
  
  if (!text || text.length < 50) return results;
  
  // Check for CIT/CIF usage
  if (/\bcollective\s+(?:invest(?:ment)?|trust)\b|\bcommingled\b|\bcommon\s+(?:collective|trust)\b|\b(?:cit|cif)\s+(?:fund|class|tier)\b/i.test(text)) {
    results.hasCIT = true;
  }
  
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
      
      // Check for TDF — now handles array of patterns
      if (ff.tdf && Array.isArray(ff.tdf)) {
        for (var ti = 0; ti < ff.tdf.length; ti++) {
          var tdfRe = new RegExp(ff.tdf[ti].source, 'gi');
          var tdfMatch;
          while ((tdfMatch = tdfRe.exec(text)) !== null) {
            familyHits[ff.name].hasTDF = true;
            var ym = tdfMatch[0].match(/(\d{4})/);
            if (ym) {
              var yr = parseInt(ym[1]);
              if (yr >= 2020 && yr <= 2075 && familyHits[ff.name].tdfYears.indexOf(yr) < 0) {
                familyHits[ff.name].tdfYears.push(yr);
              }
            }
          }
        }
        familyHits[ff.name].tdfYears.sort();
      }
    }
  }
  
  // Generic TDF catch-all — if no family-specific TDF found, look for any target-date pattern
  var genericTDFYears = [];
  if (!Object.values(familyHits).some(function(fh){return fh.hasTDF})) {
    for (var gi = 0; gi < GENERIC_TDF_PATTERNS.length; gi++) {
      var gRe = new RegExp(GENERIC_TDF_PATTERNS[gi].source, 'gi');
      var gMatch;
      while ((gMatch = gRe.exec(text)) !== null) {
        var gYm = gMatch[0].match(/(\d{4})/);
        if (gYm) {
          var gYr = parseInt(gYm[1]);
          if (gYr >= 2020 && gYr <= 2075 && genericTDFYears.indexOf(gYr) < 0) {
            genericTDFYears.push(gYr);
          }
        }
      }
    }
    if (genericTDFYears.length > 0) {
      genericTDFYears.sort();
      // Try to attribute to a detected family
      var attributed = false;
      for (var fname in familyHits) {
        if (!familyHits[fname].hasTDF) {
          familyHits[fname].hasTDF = true;
          familyHits[fname].tdfYears = genericTDFYears;
          attributed = true;
          break;
        }
      }
      if (!attributed) {
        familyHits['Unknown TDF Provider'] = { name: 'Unknown TDF Provider', hasTDF: true, tdfYears: genericTDFYears };
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
// SEC EDGAR 11-K FUND EXTRACTION
// ============================================================
async function searchEDGAR(ein, planName) {
  var results = { filings: [], fundFamilies: [], funds: [], tdfProvider: null, source: 'edgar' };
  
  if (!ein) return results;
  
  var cleanEIN = ein.replace(/[^0-9]/g, '');
  var formattedEIN = cleanEIN.length === 9 ? cleanEIN.substring(0, 2) + '-' + cleanEIN.substring(2) : cleanEIN;
  
  // Step 1: Use EDGAR full-text search to find 11-K filings
  try {
    var searchUrl = 'https://efts.sec.gov/LATEST/search-index?q=%22' + encodeURIComponent(formattedEIN) + '%22&forms=11-K&dateRange=custom&startdt=2022-01-01&enddt=2026-12-31&_source=file_date,display_names,file_description,form_type&size=5';
    
    var resp = await fetch(searchUrl, {
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
            form: hit.form_type || '11-K',
            date: hit.file_date || '',
            names: hit.display_names || [],
            description: hit.file_description || '',
            id: data.hits.hits[i]._id || ''
          });
        }
      }
    }
  } catch (e) {
    results.error = 'EFTS search: ' + e.message;
  }
  
  // Step 2: Try the EDGAR submissions API (always works, no auth, data.sec.gov)
  if (results.filings.length === 0) {
    try {
      // Look up CIK by company name
      var companySearchUrl = 'https://www.sec.gov/cgi-bin/browse-edgar?company=' + encodeURIComponent(planName || '') + '&CIK=&type=11-K&dateb=&owner=include&count=10&search_text=&action=getcompany&output=atom';
      
      var resp2 = await fetch(companySearchUrl, {
        headers: { 
          'User-Agent': 'Mammini401kProspector/1.0 support@mammini.com',
          'Accept': 'application/atom+xml'
        }
      });
      
      if (resp2.ok) {
        var atomText = await resp2.text();
        // Extract filing URLs from Atom feed
        var entryMatches = atomText.match(/<entry>[\s\S]*?<\/entry>/g) || [];
        for (var i = 0; i < Math.min(entryMatches.length, 3); i++) {
          var titleMatch = entryMatches[i].match(/<title[^>]*>(.*?)<\/title>/);
          var dateMatch = entryMatches[i].match(/<updated>(.*?)<\/updated>/);
          var linkMatch = entryMatches[i].match(/<link[^>]*href="([^"]+)"/);
          if (titleMatch) {
            results.filings.push({
              form: '11-K',
              date: dateMatch ? dateMatch[1].substring(0, 10) : '',
              names: [titleMatch[1]],
              description: titleMatch[1],
              url: linkMatch ? linkMatch[1] : ''
            });
          }
        }
      }
    } catch (e) {
      // Silent fail on backup search
    }
  }
  
  // Step 3: If we found 11-K filings, try to fetch the most recent one and extract funds
  if (results.filings.length > 0) {
    var filing = results.filings[0];
    try {
      // Try to get the filing index page to find the actual HTML document
      var filingUrl = filing.url || '';
      if (filing.id) {
        // Construct URL from EFTS ID
        filingUrl = 'https://www.sec.gov/Archives/edgar/data/' + filing.id.replace(/-/g, '/');
      }
      
      if (filingUrl && filingUrl.indexOf('http') === 0) {
        var docResp = await fetch(filingUrl, {
          headers: { 'User-Agent': 'Mammini401kProspector/1.0 support@mammini.com' }
        });
        
        if (docResp.ok) {
          var docText = await docResp.text();
          // Extract fund data from the 11-K HTML content
          var extracted = extractFundsFrom11K(docText);
          if (extracted.funds.length > 0) {
            results.funds = extracted.funds;
            results.fundFamilies = extracted.fundFamilies;
            results.tdfProvider = extracted.tdfProvider;
            results.source = '11-K filing';
          }
        }
      }
    } catch (e) {
      results.fetchError = e.message;
    }
  }
  
  return results;
}

// Extract fund lineup from 11-K HTML content
function extractFundsFrom11K(htmlText) {
  var result = { funds: [], fundFamilies: [], tdfProvider: null };
  
  // Strip HTML tags to get plain text
  var text = htmlText
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ');
  
  if (text.length < 100) return result;
  
  // Use the same fund scanning logic as PDF scan
  var scanResult = scanForFunds(text);
  result.funds = scanResult.funds;
  result.fundFamilies = scanResult.fundFamilies;
  result.tdfProvider = scanResult.tdfProvider;
  
  return result;
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
