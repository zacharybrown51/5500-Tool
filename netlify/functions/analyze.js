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
  - planFeatures: include only clearly inferable features/codes, with no duplicates
- Do not repeat the same plan feature multiple times
- Do not repeat the same investment multiple times
- Do not repeat the same service provider multiple times

Very important instructions for participant loans:
- "participantLoans" should only reflect loans or notes receivable from participants
- Only populate "participantLoans" if the filing clearly shows participant loans / notes receivable from participants as a distinct line item or clearly states that amount
- Do NOT use total assets, net assets, or any broad investment total as participantLoans
- Do NOT guess participantLoans from a general asset allocation table unless the participant loan amount is explicitly identifiable
- If unclear, use null

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

const ADVISOR_INSIGHT_SYSTEM_PROMPT = `You are a sharp, practical retirement plan advisor.

You will be given structured Form 5500 data that was already extracted from a filing.

Your job is to produce:
- an intuitive subjective summary
- commentary on plan growth, scale, design, governance, and prospecting angle
- stronger advisor observations than generic bullet points

Rules:
- Return exactly one valid JSON object
- No markdown
- No extra commentary outside the JSON
- Be specific and thoughtful, not hypey
- Do not invent facts not reasonably supported by the structured data
- If something is uncertain, acknowledge that briefly
- Use plain, direct language
- The summary should feel like an experienced advisor sizing up the plan before a meeting
- Mention plan growth if assets or participants suggest it
- Mention what is strategically interesting, not just what is technically present

Return this exact JSON shape:
{
  "subjectiveSummary": string|null,
  "smartObservations": [string],
  "growthCommentary": string|null,
  "strengths": [string],
  "watchItems": [string],
  "opportunities": [string],
  "questionsToAsk": [string],
  "recommendations": [string],
  "pitchAngle": string|null,
  "humanTake": string|null,
  "confidence": string|null
}`;

function jsonResponse(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}

function extractTextFromAnthropicResponse(data) {
  var text = '';
  var blocks = Array.isArray(data && data.content) ? data.content : [];
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    if (block && block.type === 'text' && typeof block.text === 'string') {
      text += block.text;
    }
  }
  return text.trim();
}

function extractBalancedJSONObject(str) {
  var start = str.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in model response.');

  var depth = 0;
  var inString = false;
  var escape = false;

  for (var i = start; i < str.length; i++) {
    var ch = str[i];

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
  var cleaned = cleanCandidateJSON(rawText);
  var candidate = extractBalancedJSONObject(cleaned);
  return JSON.parse(candidate);
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;

  var raw = String(v).trim();
  if (!raw) return null;

  var negative = /^\(.*\)$/.test(raw);
  var stripped = raw.replace(/[\$,%\s,()]/g, '').trim();
  if (!stripped) return null;

  var num = Number(stripped);
  if (!isFinite(num)) return null;

  return negative ? -num : num;
}

function toBoolOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;

  var s = String(v).trim().toLowerCase();
  if (s === 'true' || s === 'yes' || s === 'y' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === 'n' || s === '0') return false;
  return null;
}

function toStringOrNull(v) {
  if (v === null || v === undefined) return null;
  var s = String(v).trim();
  return s || null;
}

function limitArray(arr, max) {
  return Array.isArray(arr) ? arr.slice(0, max) : [];
}

function uniqueBy(arr, getKey) {
  if (!Array.isArray(arr)) return [];
  var seen = {};
  var out = [];

  for (var i = 0; i < arr.length; i++) {
    var item = arr[i];
    var key = String(getKey(item) || '').trim().toLowerCase();
    if (!key) continue;
    if (seen[key]) continue;
    seen[key] = true;
    out.push(item);
  }

  return out;
}

function uniqueStrings(arr, max) {
  var seen = {};
  var out = [];
  arr = Array.isArray(arr) ? arr : [];

  for (var i = 0; i < arr.length; i++) {
    var s = toStringOrNull(arr[i]);
    if (!s) continue;
    var k = s.toLowerCase();
    if (seen[k]) continue;
    seen[k] = true;
    out.push(s);
    if (max && out.length >= max) break;
  }

  return out;
}

function cleanPlanFeatures(features) {
  var cleaned = limitArray(features, 20).map(function(x) {
    return {
      code: toStringOrNull(x && x.code) || '',
      description: toStringOrNull(x && x.description) || ''
    };
  }).filter(function(x) {
    return x.code || x.description;
  });

  return uniqueBy(cleaned, function(x) {
    return (x.code || '') + '|' + (x.description || '');
  });
}

function cleanInvestments(investments) {
  var cleaned = limitArray(investments, 20).map(function(x) {
    return {
      name: toStringOrNull(x && x.name) || 'Unnamed investment',
      value: toNumberOrNull(x && x.value),
      type: toStringOrNull(x && x.type)
    };
  });

  return uniqueBy(cleaned, function(x) {
    return (x.name || '') + '|' + (x.type || '') + '|' + (x.value == null ? '' : x.value);
  });
}

function cleanServiceProviders(providers) {
  var cleaned = limitArray(providers, 15).map(function(x) {
    return {
      name: toStringOrNull(x && x.name) || 'Unnamed provider',
      ein: toStringOrNull(x && x.ein),
      role: toStringOrNull(x && x.role),
      serviceCodes: toStringOrNull(x && x.serviceCodes),
      directCompensation: toNumberOrNull(x && x.directCompensation),
      indirectCompensation: toNumberOrNull(x && x.indirectCompensation),
      relationship: toStringOrNull(x && x.relationship)
    };
  });

  return uniqueBy(cleaned, function(x) {
    return (x.name || '') + '|' + (x.role || '') + '|' + (x.ein || '');
  });
}

function cleanAssetAllocation(items) {
  var cleaned = limitArray(items, 20).map(function(x) {
    return {
      category: toStringOrNull(x && x.category) || 'Unspecified',
      beginningValue: toNumberOrNull(x && x.beginningValue),
      endValue: toNumberOrNull(x && x.endValue)
    };
  });

  return uniqueBy(cleaned, function(x) {
    return (x.category || '') + '|' + (x.beginningValue == null ? '' : x.beginningValue) + '|' + (x.endValue == null ? '' : x.endValue);
  });
}

function sanitizeFinancials(financials) {
  return {
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
  };
}

function normalizeParsed(r) {
  var participants = r && r.participants ? r.participants : {};
  var financials = r && r.financials ? r.financials : {};
  var compliance = r && r.compliance ? r.compliance : {};
  var auditor = r && r.auditor ? r.auditor : {};
  var fundingInfo = r && r.fundingInfo ? r.fundingInfo : {};

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
    financials: sanitizeFinancials(financials),
    assetAllocation: cleanAssetAllocation(r && r.assetAllocation),
    investments: cleanInvestments(r && r.investments),
    serviceProviders: cleanServiceProviders(r && r.serviceProviders),
    planFeatures: cleanPlanFeatures(r && r.planFeatures),
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
  var names = [];
  var providers = Array.isArray(parsed && parsed.serviceProviders) ? parsed.serviceProviders : [];

  for (var i = 0; i < providers.length; i++) {
    if (providers[i] && providers[i].name) names.push(String(providers[i].name));
    if (providers[i] && providers[i].role) names.push(String(providers[i].role));
  }

  var hay = names.join(' | ').toLowerCase();
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
  var featureText = [];
  var features = Array.isArray(parsed && parsed.planFeatures) ? parsed.planFeatures : [];

  for (var i = 0; i < features.length; i++) {
    featureText.push((features[i].code || '') + ' ' + (features[i].description || ''));
  }

  if (parsed && parsed.notes) featureText.push(parsed.notes);

  return pattern.test(featureText.join(' | ').toLowerCase());
}

function getPlanSegment(participants, assets) {
  if (participants != null) {
    if (participants < 25) return 'Micro';
    if (participants < 100) return 'Small';
    if (participants < 500) return 'Mid';
    return 'Large';
  }

  if (assets != null) {
    if (assets < 1000000) return 'Micro';
    if (assets < 10000000) return 'Small';
    if (assets < 50000000) return 'Mid';
    return 'Large';
  }

  return null;
}

function buildBaselineInsights(parsed) {
  var assets = parsed && parsed.financials ? parsed.financials.totalAssetsEOY : null;
  var assetsBOY = parsed && parsed.financials ? parsed.financials.totalAssetsBOY : null;
  var participants = parsed && parsed.participants
    ? (parsed.participants.withAccountBalances != null
      ? parsed.participants.withAccountBalances
      : (parsed.participants.totalEndOfYear != null
        ? parsed.participants.totalEndOfYear
        : parsed.participants.activeEndOfYear))
    : null;

  var employer = parsed && parsed.financials ? parsed.financials.employerContributions : null;
  var employee = parsed && parsed.financials ? parsed.financials.participantContributions : null;
  var adminExpenses = parsed && parsed.financials ? parsed.financials.adminExpenses : null;
  var participantLoans = parsed && parsed.financials ? parsed.financials.participantLoans : null;
  var likelyRecordkeeper = inferRecordkeeper(parsed);
  var hasRoth = hasFeature(parsed, /roth/);
  var hasLoans = (participantLoans != null && participantLoans > 0) || hasFeature(parsed, /loan/);
  var hasMatch = employer != null && employer > 0;
  var lateContributions = !!(parsed && parsed.compliance && parsed.compliance.lateContributions);
  var prohibitedTransactions = !!(parsed && parsed.compliance && parsed.compliance.prohibitedTransactions);
  var loansInDefault = !!(parsed && parsed.compliance && parsed.compliance.loansInDefault);
  var audited = !!(parsed && parsed.auditor && parsed.auditor.name);
  var assetsPerParticipant = (assets != null && participants) ? Math.round(assets / participants) : null;
  var planSegment = getPlanSegment(participants, assets);
  var assetGrowth = (assets != null && assetsBOY != null) ? (assets - assetsBOY) : null;

  var score = 5;
  if (assets != null) {
    if (assets >= 25000000) score += 2;
    else if (assets >= 5000000) score += 1;
    else if (assets < 1000000) score -= 1;
  }
  if (participants != null) {
    if (participants >= 50) score += 1;
    if (participants < 10) score -= 1;
  }
  if (lateContributions) score += 1;
  if (!hasRoth) score += 1;
  if (adminExpenses != null && assets != null && assets > 0 && adminExpenses / assets > 0.01) score += 1;
  if (prohibitedTransactions) score += 1;
  score = Math.max(1, Math.min(10, Math.round(score)));

  return {
    score: score,
    meta: {
      likelyRecordkeeper: likelyRecordkeeper,
      planSegment: planSegment,
      assetsPerParticipant: assetsPerParticipant,
      hasRoth: hasRoth,
      hasLoans: hasLoans,
      hasMatch: hasMatch,
      assetGrowth: assetGrowth,
      audited: audited,
      lateContributions: lateContributions,
      prohibitedTransactions: prohibitedTransactions,
      loansInDefault: loansInDefault,
      employeeContributions: employee,
      employerContributions: employer
    }
  };
}

function normalizeAdvisorInsightResponse(r) {
  return {
    subjectiveSummary: toStringOrNull(r && r.subjectiveSummary),
    smartObservations: uniqueStrings(r && r.smartObservations, 6),
    growthCommentary: toStringOrNull(r && r.growthCommentary),
    strengths: uniqueStrings(r && r.strengths, 6),
    watchItems: uniqueStrings(r && r.watchItems, 6),
    opportunities: uniqueStrings(r && r.opportunities, 6),
    questionsToAsk: uniqueStrings(r && r.questionsToAsk, 6),
    recommendations: uniqueStrings(r && r.recommendations, 6),
    pitchAngle: toStringOrNull(r && r.pitchAngle),
    humanTake: toStringOrNull(r && r.humanTake),
    confidence: toStringOrNull(r && r.confidence)
  };
}

function buildFallbackInsights(parsed, baseline) {
  var meta = baseline && baseline.meta ? baseline.meta : {};
  var assets = parsed && parsed.financials ? parsed.financials.totalAssetsEOY : null;
  var participants = parsed && parsed.participants
    ? (parsed.participants.withAccountBalances != null
      ? parsed.participants.withAccountBalances
      : (parsed.participants.totalEndOfYear != null
        ? parsed.participants.totalEndOfYear
        : parsed.participants.activeEndOfYear))
    : null;

  var summary = 'This appears to be ';
  if (meta.planSegment) summary += 'a ' + meta.planSegment.toLowerCase() + '-market ';
  summary += 'defined contribution plan';
  if (assets != null) summary += ' with roughly $' + Math.round(assets).toLocaleString() + ' in assets';
  if (participants != null) summary += ' and about ' + participants.toLocaleString() + ' participants with balances';
  summary += '. ';
  if (meta.likelyRecordkeeper) {
    summary += 'The filing also suggests ' + meta.likelyRecordkeeper + ' may be the current platform or a key provider. ';
  }
  if (meta.lateContributions || meta.prohibitedTransactions || meta.loansInDefault) {
    summary += 'The most natural advisor angle here is governance, operational cleanup, and fiduciary process.';
  } else {
    summary += 'The most natural advisor angle here is benchmarking, plan design, and participant outcomes rather than a generic fund-performance conversation.';
  }

  var growthCommentary = null;
  if (meta.assetGrowth != null) {
    if (meta.assetGrowth > 0) {
      growthCommentary = 'Assets increased year over year, which can point to a growing or healthy plan, though part of that growth may simply reflect market performance.';
    } else if (meta.assetGrowth < 0) {
      growthCommentary = 'Assets declined year over year, which is worth exploring because that can reflect distributions, weaker contributions, headcount changes, or market pressure.';
    } else {
      growthCommentary = 'Assets were roughly flat year over year, which suggests the better questions are around participation, contribution behavior, and overall plan competitiveness.';
    }
  }

  var strengths = [];
  var watchItems = [];
  var opportunities = [];
  var questionsToAsk = [];
  var recommendations = [];
  var smartObservations = [];

  if (assets != null) strengths.push('The plan has enough asset scale to make benchmarking and oversight meaningful.');
  if (participants != null) strengths.push('There is enough participant scale here for design and education improvements to matter.');
  if (meta.audited) strengths.push('An audited filing generally means a more visible governance and provider landscape.');
  if (meta.likelyRecordkeeper) smartObservations.push('The provider footprint may be as important as the investment lineup in this case.');
  if (meta.assetsPerParticipant != null && meta.assetsPerParticipant > 100000) {
    smartObservations.push('Average balances look strong, which usually makes fee efficiency and investment architecture more important.');
  }
  if (meta.lateContributions) watchItems.push('Late contributions were flagged.');
  if (meta.prohibitedTransactions) watchItems.push('Prohibited transactions were flagged.');
  if (meta.loansInDefault) watchItems.push('Loans in default were flagged.');
  if (!meta.hasRoth) watchItems.push('No clear Roth feature was identified.');
  if (!meta.hasMatch) watchItems.push('No employer contribution was clearly identified.');

  if (!meta.hasRoth) opportunities.push('Review whether Roth is available and whether participant communication around tax diversification is strong enough.');
  if (!meta.hasLoans) opportunities.push('Confirm whether loans are intentionally excluded and whether participant liquidity needs are surfacing elsewhere.');
  if (meta.likelyRecordkeeper) opportunities.push('Benchmark the current provider setup on cost, service, and participant experience.');
  recommendations.push('Lead with diagnosis, not product. Start by understanding plan design, service friction, and fiduciary process.');
  questionsToAsk.push('What is the sponsor actually unhappy with today: service, fees, participation, education, payroll integration, or governance?');

  return {
    subjectiveSummary: summary,
    smartObservations: uniqueStrings(smartObservations, 6),
    growthCommentary: growthCommentary,
    strengths: uniqueStrings(strengths, 6),
    watchItems: uniqueStrings(watchItems, 6),
    opportunities: uniqueStrings(opportunities, 6),
    questionsToAsk: uniqueStrings(questionsToAsk, 6),
    recommendations: uniqueStrings(recommendations, 6),
    pitchAngle: meta.lateContributions || meta.prohibitedTransactions || meta.loansInDefault
      ? 'Lead with governance, operational control, and sponsor-risk reduction.'
      : 'Lead with benchmarking, participant outcomes, and whether the current setup still fits the plan.',
    humanTake: 'This is a plan where a thoughtful advisor should show up with a real point of view on governance, design, and service quality—not just a lineup critique.',
    confidence: 'medium'
  };
}

async function callAnthropic(payload, apiKey) {
  var resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });

  var text = await resp.text();

  var data = null;
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

async function generateAdvisorInsights(parsed, baseline, apiKey) {
  var prompt = {
    parsed: parsed,
    baseline: baseline
  };

  var response = await callAnthropic({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1400,
    temperature: 0.4,
    system: ADVISOR_INSIGHT_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Review this structured Form 5500 analysis and return the requested JSON only.\n\n' + JSON.stringify(prompt)
        }
      ]
    }]
  }, apiKey);

  var rawText = extractTextFromAnthropicResponse(response);
  return normalizeAdvisorInsightResponse(parseMaybeJSON(rawText));
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
    var body;
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

    var extractionResponse = await callAnthropic({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2800,
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

    var rawText = extractTextFromAnthropicResponse(extractionResponse);
    var parsed = normalizeParsed(parseMaybeJSON(rawText));
    var baseline = buildBaselineInsights(parsed);

    var insights;
    try {
      insights = await generateAdvisorInsights(parsed, baseline, process.env.ANTHROPIC_API_KEY);
      insights.score = baseline.score;
      insights.meta = baseline.meta;
      if (!insights.confidence) insights.confidence = 'medium';
    } catch (e) {
      insights = buildFallbackInsights(parsed, baseline);
      insights.score = baseline.score;
      insights.meta = baseline.meta;
    }

    return jsonResponse(200, {
      ok: true,
      parsed: parsed,
      partial: false,
      repaired: false,
      insights: insights,
      derived: insights && insights.meta ? insights.meta : null
    });
  } catch (err) {
    return jsonResponse(500, {
      ok: false,
      error: (err && err.message) ? err.message : 'Function failed.'
    });
  }
};
