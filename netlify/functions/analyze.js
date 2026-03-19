const API_URL = 'https://api.anthropic.com/v1/messages';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const EXTRACTION_SYSTEM_PROMPT = `You are a Form 5500 retirement plan filing analyst.

Extract useful retirement-plan data from a Form 5500 PDF into one valid JSON object.

Rules:
- Return exactly one valid JSON object
- No markdown
- No commentary
- No trailing commas
- If a field is not found, use null
- Prefer accuracy over completeness
- Do not invent values
- Keep arrays concise:
  - investments: include up to 20 clearly identified holdings
  - serviceProviders: include up to 15 clearly identified providers
  - assetAllocation: include clearly stated categories only
  - planFeatures: include only clearly inferable features/codes

Return this exact JSON shape:
{
  "planName": string|null,
  "sponsor": string|null,
  "ein": string|null,
  "planNumber": string|null,
  "planYear": string|null,
  "planType": string|null,
  "filingType": string|null,
  "participants": {
    "beginningOfYear": number|null,
    "activeEndOfYear": number|null,
    "totalEndOfYear": number|null,
    "retired": number|null,
    "separated": number|null,
    "deceased": number|null,
    "withAccountBalances": number|null,
    "terminatedUnvested": number|null
  },
  "financials": {
    "totalAssetsBOY": number|null,
    "totalAssetsEOY": number|null,
    "netAssets": number|null,
    "totalContributions": number|null,
    "employerContributions": number|null,
    "participantContributions": number|null,
    "rollovers": number|null,
    "benefitsPaid": number|null,
    "totalIncome": number|null,
    "totalExpenses": number|null,
    "adminExpenses": number|null,
    "investmentGainLoss": number|null,
    "netIncome": number|null,
    "participantLoans": number|null,
    "employerSecurities": number|null
  },
  "assetAllocation": [{"category": string, "beginningValue": number|null, "endValue": number|null}],
  "investments": [{"name": string, "value": number|null, "type": string|null}],
  "serviceProviders": [{"name": string, "ein": string|null, "role": string|null, "serviceCodes": string|null, "directCompensation": number|null, "indirectCompensation": number|null, "relationship": string|null}],
  "planFeatures": [{"code": string, "description": string}],
  "compliance": {
    "lateContributions": boolean|null,
    "lateContributionAmount": number|null,
    "prohibitedTransactions": boolean|null,
    "loansInDefault": boolean|null,
    "fidelityBond": boolean|null,
    "fidelityBondAmount": number|null,
    "blackoutPeriod": boolean|null,
    "failedToPayBenefits": boolean|null,
    "assetsHeldForInvestment": boolean|null,
    "planTerminating": boolean|null
  },
  "auditor": {"name": string|null, "ein": string|null, "opinionType": string|null},
  "fundingInfo": {"minimumRequired": number|null, "actualContribution": number|null, "fundingShortfall": number|null},
  "notes": string|null
}`;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}

function extractTextFromAnthropicResponse(data) {
  let text = '';
  const blocks = Array.isArray(data && data.content) ? data.content : [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block && block.type === 'text' && typeof block.text === 'string') {
      text += block.text;
    }
  }
  return text.trim();
}

function extractBalancedJSONObject(str) {
  const start = str.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in model response.');

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < str.length; i++) {
    const ch = str[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return str.slice(start, i + 1);
        }
      }
    }
  }

  throw new Error('No complete JSON object found in model response.');
}

function cleanCandidateJSON(str) {
  return String(str || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']')
    .trim();
}

function parseMaybeJSON(rawText) {
  const cleaned = cleanCandidateJSON(rawText);
  const candidate = extractBalancedJSONObject(cleaned);
  return JSON.parse(candidate);
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;

  const raw = String(v).trim();
  if (!raw) return null;

  const negative = /^\(.*\)$/.test(raw);
  const stripped = raw.replace(/[\$,%\s,()]/g, '').trim();
  if (!stripped) return null;

  const num = Number(stripped);
  if (!Number.isFinite(num)) return null;

  return negative ? -num : num;
}

function toBoolOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;

  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === 'yes' || s === 'y' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === 'n' || s === '0') return false;
  return null;
}

function toStringOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function limitArray(arr, max) {
  return Array.isArray(arr) ? arr.slice(0, max) : [];
}

function normalizeParsed(r) {
  const participants = r && r.participants ? r.participants : {};
  const financials = r && r.financials ? r.financials : {};
  const compliance = r && r.compliance ? r.compliance : {};
  const auditor = r && r.auditor ? r.auditor : {};
  const fundingInfo = r && r.fundingInfo ? r.fundingInfo : {};

  return {
    planName: toStringOrNull(r && r.planName),
    sponsor: toStringOrNull(r && r.sponsor),
    ein: toStringOrNull(r && r.ein) ? toStringOrNull(r.ein).replace(/[^\d-]/g, '') : null,
    planNumber: toStringOrNull(r && r.planNumber),
    planYear: toStringOrNull(r && r.planYear),
    planType: toStringOrNull(r && r.planType),
    filingType: toStringOrNull(r && r.filingType),
    participants: {
      beginningOfYear: toNumberOrNull(participants.beginningOfYear),
      activeEndOfYear: toNumberOrNull(participants.activeEndOfYear),
      totalEndOfYear: toNumberOrNull(participants.totalEndOfYear),
      retired: toNumberOrNull(participants.retired),
      separated: toNumberOrNull(participants.separated),
      deceased: toNumberOrNull(participants.deceased),
      withAccountBalances: toNumberOrNull(participants.withAccountBalances),
      terminatedUnvested: toNumberOrNull(participants.terminatedUnvested)
    },
    financials: {
      totalAssetsBOY: toNumberOrNull(financials.totalAssetsBOY),
      totalAssetsEOY: toNumberOrNull(financials.totalAssetsEOY),
      netAssets: toNumberOrNull(financials.netAssets),
      totalContributions: toNumberOrNull(financials.totalContributions),
      employerContributions: toNumberOrNull(financials.employerContributions),
      participantContributions: toNumberOrNull(financials.participantContributions),
      rollovers: toNumberOrNull(financials.rollovers),
      benefitsPaid: toNumberOrNull(financials.benefitsPaid),
      totalIncome: toNumberOrNull(financials.totalIncome),
      totalExpenses: toNumberOrNull(financials.totalExpenses),
      adminExpenses: toNumberOrNull(financials.adminExpenses),
      investmentGainLoss: toNumberOrNull(financials.investmentGainLoss),
      netIncome: toNumberOrNull(financials.netIncome),
      participantLoans: toNumberOrNull(financials.participantLoans),
      employerSecurities: toNumberOrNull(financials.employerSecurities)
    },
    assetAllocation: limitArray(r && r.assetAllocation, 20).map(function(x) {
      return {
        category: toStringOrNull(x && x.category) || 'Unspecified',
        beginningValue: toNumberOrNull(x && x.beginningValue),
        endValue: toNumberOrNull(x && x.endValue)
      };
    }),
    investments: limitArray(r && r.investments, 20).map(function(x) {
      return {
        name: toStringOrNull(x && x.name) || 'Unnamed investment',
        value: toNumberOrNull(x && x.value),
        type: toStringOrNull(x && x.type)
      };
    }),
    serviceProviders: limitArray(r && r.serviceProviders, 15).map(function(x) {
      return {
        name: toStringOrNull(x && x.name) || 'Unnamed provider',
        ein: toStringOrNull(x && x.ein),
        role: toStringOrNull(x && x.role),
        serviceCodes: toStringOrNull(x && x.serviceCodes),
        directCompensation: toNumberOrNull(x && x.directCompensation),
        indirectCompensation: toNumberOrNull(x && x.indirectCompensation),
        relationship: toStringOrNull(x && x.relationship)
      };
    }),
    planFeatures: limitArray(r && r.planFeatures, 20).map(function(x) {
      return {
        code: toStringOrNull(x && x.code) || '',
        description: toStringOrNull(x && x.description) || ''
      };
    }).filter(function(x) {
      return x.code || x.description;
    }),
    compliance: {
      lateContributions: toBoolOrNull(compliance.lateContributions),
      lateContributionAmount: toNumberOrNull(compliance.lateContributionAmount),
      prohibitedTransactions: toBoolOrNull(compliance.prohibitedTransactions),
      loansInDefault: toBoolOrNull(compliance.loansInDefault),
      fidelityBond: toBoolOrNull(compliance.fidelityBond),
      fidelityBondAmount: toNumberOrNull(compliance.fidelityBondAmount),
      blackoutPeriod: toBoolOrNull(compliance.blackoutPeriod),
      failedToPayBenefits: toBoolOrNull(compliance.failedToPayBenefits),
      assetsHeldForInvestment: toBoolOrNull(compliance.assetsHeldForInvestment),
      planTerminating: toBoolOrNull(compliance.planTerminating)
    },
    auditor: {
      name: toStringOrNull(auditor.name),
      ein: toStringOrNull(auditor.ein),
      opinionType: toStringOrNull(auditor.opinionType)
    },
    fundingInfo: {
      minimumRequired: toNumberOrNull(fundingInfo.minimumRequired),
      actualContribution: toNumberOrNull(fundingInfo.actualContribution),
      fundingShortfall: toNumberOrNull(fundingInfo.fundingShortfall)
    },
    notes: toStringOrNull(r && r.notes)
  };
}

function inferRecordkeeper(parsed) {
  const names = [];
  const providers = Array.isArray(parsed && parsed.serviceProviders) ? parsed.serviceProviders : [];

  for (let i = 0; i < providers.length; i++) {
    if (providers[i] && providers[i].name) names.push(String(providers[i].name));
    if (providers[i] && providers[i].role) names.push(String(providers[i].role));
  }

  const hay = names.join(' | ').toLowerCase();
  if (!hay) return null;

  if (hay.indexOf('fidelity') >= 0 || hay.indexOf('national financial services') >= 0 || hay.indexOf('nfs') >= 0) return 'Fidelity';
  if (hay.indexOf('empower') >= 0 || hay.indexOf('great-west') >= 0 || hay.indexOf('great west') >= 0) return 'Empower';
  if (hay.indexOf('principal') >= 0) return 'Principal';
  if (hay.indexOf('voya') >= 0) return 'Voya';
  if (hay.indexOf('john hancock') >= 0) return 'John Hancock';
  if (hay.indexOf('ascensus') >= 0) return 'Ascensus';
  if (hay.indexOf('schwab') >= 0 || hay.indexOf('td ameritrade') >= 0) return 'Schwab';
  if (hay.indexOf('alight') >= 0) return 'Alight';
  if (hay.indexOf('adp') >= 0) return 'ADP';
  if (hay.indexOf('transamerica') >= 0) return 'Transamerica';
  if (hay.indexOf('lincoln') >= 0) return 'Lincoln';
  if (hay.indexOf('paychex') >= 0) return 'Paychex';
  if (hay.indexOf('merrill') >= 0 || hay.indexOf('bank of america') >= 0) return 'Merrill';
  if (hay.indexOf('pershing') >= 0) return 'Pershing';

  return null;
}

function hasFeature(parsed, pattern) {
  const featureText = [];
  const features = Array.isArray(parsed && parsed.planFeatures) ? parsed.planFeatures : [];

  for (let i = 0; i < features.length; i++) {
    featureText.push((features[i].code || '') + ' ' + (features[i].description || ''));
  }

  if (parsed && parsed.notes) featureText.push(parsed.notes);

  return pattern.test(featureText.join(' | ').toLowerCase());
}

function buildDerivedInsights(parsed) {
  const assets = parsed && parsed.financials ? parsed.financials.totalAssetsEOY : null;
  const participants = parsed && parsed.participants
    ? (parsed.participants.withAccountBalances != null
      ? parsed.participants.withAccountBalances
      : (parsed.participants.totalEndOfYear != null
        ? parsed.participants.totalEndOfYear
        : parsed.participants.activeEndOfYear))
    : null;

  const employer = parsed && parsed.financials ? parsed.financials.employerContributions : null;
  const likelyRecordkeeper = inferRecordkeeper(parsed);
  const hasRoth = hasFeature(parsed, /roth/);
  const hasLoans = ((parsed && parsed.financials && parsed.financials.participantLoans) || 0) > 0 || hasFeature(parsed, /loan/);
  const hasMatch = employer != null && employer > 0;
  const lateContributions = !!(parsed && parsed.compliance && parsed.compliance.lateContributions);
  const assetsPerParticipant = (assets != null && participants) ? Math.round(assets / participants) : null;

  let prospectScore = 5;

  if (assets != null) {
    if (assets >= 25000000) prospectScore += 2;
    else if (assets >= 5000000) prospectScore += 1;
    else if (assets < 1000000) prospectScore -= 1;
  }

  if (participants != null) {
    if (participants >= 50) prospectScore += 1;
    if (participants < 10) prospectScore -= 1;
  }

  if (lateContributions) prospectScore += 1;
  if (!hasRoth) prospectScore += 1;

  prospectScore = Math.max(1, Math.min(10, Math.round(prospectScore)));

  const watchItems = [];
  const opportunities = [];
  const questionsToAsk = [];

  if (lateContributions) watchItems.push('Late contributions were flagged in the filing.');
  if (!hasRoth) watchItems.push('No clear Roth feature was identified.');
  if (!hasMatch) watchItems.push('No employer contribution was clearly identified.');
  if (parsed && parsed.compliance && parsed.compliance.prohibitedTransactions === true) {
    watchItems.push('Prohibited transactions were flagged.');
  }

  if (!hasRoth) opportunities.push('Roth availability or participant communication may be a plan improvement opportunity.');
  if (!hasLoans) opportunities.push('Ask whether loans are intentionally excluded and whether liquidity issues show up elsewhere.');
  if (likelyRecordkeeper) opportunities.push('Benchmark ' + likelyRecordkeeper + ' on pricing, support, and participant experience.');
  if (assetsPerParticipant != null && assetsPerParticipant > 100000) {
    opportunities.push('Average balances are high enough to justify a fee and investment review.');
  }

  if (likelyRecordkeeper) questionsToAsk.push('How satisfied is the sponsor with ' + likelyRecordkeeper + '?');
  if (!hasRoth) questionsToAsk.push('Has the sponsor considered adding or better promoting Roth?');
  if (!hasMatch) questionsToAsk.push('Is the current employer contribution design still competitive?');
  if (lateContributions) questionsToAsk.push('What caused the late contribution issue and has it been fixed?');

  return {
    likelyRecordkeeper: likelyRecordkeeper,
    assetsPerParticipant: assetsPerParticipant,
    hasRoth: hasRoth,
    hasLoans: hasLoans,
    hasMatch: hasMatch,
    prospectScore: prospectScore,
    watchItems: watchItems,
    opportunities: opportunities,
    questionsToAsk: questionsToAsk
  };
}

async function callAnthropic(payload, apiKey) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });

  const text = await resp.text();

  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = null;
  }

  if (!resp.ok) {
    throw new Error((data && data.error && data.error.message) || text || ('Anthropic error ' + resp.status));
  }

  if (!data || !Array.isArray(data.content)) {
    throw new Error('Anthropic returned an unexpected response shape.');
  }

  return data;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonResponse(500, { ok: false, error: 'Missing ANTHROPIC_API_KEY environment variable in Netlify.' });
  }

  try {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return jsonResponse(400, { ok: false, error: 'Request body must be valid JSON.' });
    }

    if (body.mode !== 'extract_5500') {
      return jsonResponse(400, { ok: false, error: 'Unsupported mode.' });
    }

    if (!body.base64 || typeof body.base64 !== 'string') {
      return jsonResponse(400, { ok: false, error: 'Missing base64 PDF payload.' });
    }

    if (body.base64.length > 7000000) {
      return jsonResponse(413, {
        ok: false,
        error: 'This PDF is too large for the current Netlify function setup. Try a smaller filing or compress the PDF first.'
      });
    }

    const response = await callAnthropic({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2600,
      temperature: 0,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: body.base64
            }
          },
          {
            type: 'text',
            text: 'Analyze this Form 5500 and return only the required JSON object.'
          }
        ]
      }]
    }, process.env.ANTHROPIC_API_KEY);

    const rawText = extractTextFromAnthropicResponse(response);
    const parsed = normalizeParsed(parseMaybeJSON(rawText));
    const derived = buildDerivedInsights(parsed);

    return jsonResponse(200, {
      ok: true,
      parsed: parsed,
      partial: false,
      repaired: false,
      insights: null,
      derived: derived
    });
  } catch (err) {
    return jsonResponse(500, {
      ok: false,
      error: (err && err.message) ? err.message : 'Function failed.'
    });
  }
};
