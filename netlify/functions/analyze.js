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

function buildAiInsights(parsed) {
  var assets = parsed && parsed.financials ? parsed.financials.totalAssetsEOY : null;
  var assetsBOY = parsed && parsed.financials ? parsed.financials.totalAssetsBOY : null;
  var participants = parsed && parsed.participants
    ? (parsed.participants.withAccountBalances != null
      ? parsed.participants.withAccountBalances
      : (parsed.participants.totalEndOfYear != null
        ? parsed.participants.totalEndOfYear
        : parsed.participants.activeEndOfYear))
    : null;

  var activeParticipants = parsed && parsed.participants ? parsed.participants.activeEndOfYear : null;
  var totalParticipants = parsed && parsed.participants ? parsed.participants.totalEndOfYear : null;
  var employer = parsed && parsed.financials ? parsed.financials.employerContributions : null;
  var employee = parsed && parsed.financials ? parsed.financials.participantContributions : null;
  var totalContrib = parsed && parsed.financials ? parsed.financials.totalContributions : null;
  var benefitsPaid = parsed && parsed.financials ? parsed.financials.benefitsPaid : null;
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

  var strengths = [];
  var watchItems = [];
  var opportunities = [];
  var questionsToAsk = [];
  var recommendations = [];

  if (assets != null) {
    strengths.push('The plan has meaningful scale at roughly $' + Math.round(assets).toLocaleString() + ' in year-end assets.');
  }
  if (participants != null) {
    strengths.push('The filing shows approximately ' + participants.toLocaleString() + ' participants with balances, which is enough scale to make advisory, pricing, and governance improvements matter.');
  }
  if (assetsPerParticipant != null) {
    strengths.push('Average assets per participant are about $' + Math.round(assetsPerParticipant).toLocaleString() + ', which can support a more thoughtful fee and investment discussion.');
  }
  if (likelyRecordkeeper) {
    strengths.push('The service provider data points to ' + likelyRecordkeeper + ' as the likely recordkeeper or key platform partner.');
  }
  if (audited) {
    strengths.push('This appears to be an audited filing, which usually means there is more visibility into governance, controls, and provider relationships.');
  }
  if (assetGrowth != null && assetGrowth > 0) {
    strengths.push('Plan assets increased year over year, which generally suggests a healthy or growing plan base.');
  }

  if (lateContributions) {
    watchItems.push('Late contributions were flagged in the filing, which is both a compliance issue and a practical opening for a payroll/process conversation.');
  }
  if (prohibitedTransactions) {
    watchItems.push('The filing indicates prohibited transactions, which is a meaningful governance concern and should not be treated lightly.');
  }
  if (loansInDefault) {
    watchItems.push('Participant loans in default were flagged, which may point to participant financial stress or weak loan administration controls.');
  }
  if (!hasRoth) {
    watchItems.push('No clear Roth feature was identified from the filing data. That does not guarantee Roth is absent, but it is worth confirming.');
  }
  if (!hasMatch && employee != null && employee > 0) {
    watchItems.push('Employee deferrals are present, but no employer contribution was clearly identified. That could make the plan less competitive or less compelling from a participant-engagement standpoint.');
  }
  if (participantLoans != null && assets != null && assets > 0 && participantLoans / assets > 0.15) {
    watchItems.push('Participant loans appear to be a meaningful share of plan assets, which could signal recurring liquidity pressure among participants.');
  }
  if (adminExpenses != null && assets != null && assets > 0 && adminExpenses / assets > 0.01) {
    watchItems.push('Administrative expenses look elevated relative to plan assets and are worth benchmarking.');
  }

  if (!hasRoth) {
    opportunities.push('Review whether the plan offers Roth contributions and, if not, whether adding Roth would improve competitiveness and participant flexibility.');
  }
  if (!hasLoans) {
    opportunities.push('Confirm whether participant loans are intentionally excluded. If so, there may still be an opportunity to discuss participant liquidity needs and whether hardship activity is filling that gap.');
  }
  if (likelyRecordkeeper) {
    opportunities.push('Benchmark ' + likelyRecordkeeper + ' on pricing, participant service, payroll integration, education support, and investment flexibility.');
  }
  if (assetsPerParticipant != null && assetsPerParticipant > 100000) {
    opportunities.push('The average balance profile is strong enough to justify a serious review of fees, share classes, managed account value, and overall investment architecture.');
  }
  if (lateContributions) {
    opportunities.push('A governance and process review is a natural wedge into the relationship because the filing already points to an operational weakness.');
  }
  if (!hasMatch) {
    opportunities.push('If the sponsor is not making employer contributions, there may be room to discuss whether the current design still aligns with retention and participation goals.');
  }
  if (parsed && Array.isArray(parsed.serviceProviders) && parsed.serviceProviders.length > 0) {
    opportunities.push('The filing identifies enough providers to frame a broader vendor-overlap and accountability conversation rather than limiting the discussion to investments alone.');
  }

  if (likelyRecordkeeper) {
    questionsToAsk.push('How satisfied is the committee or sponsor with ' + likelyRecordkeeper + ' on service quality, payroll integration, participant support, and issue resolution?');
  }
  if (!hasRoth) {
    questionsToAsk.push('Does the plan currently allow Roth contributions, and if not, has that been reviewed recently?');
  }
  if (!hasMatch) {
    questionsToAsk.push('Is the current employer contribution design intentional, and is it still helping with recruiting, retention, and participation objectives?');
  }
  if (lateContributions) {
    questionsToAsk.push('What caused the late contribution issue, and has the underlying payroll or remittance process been corrected?');
  }
  if (participantLoans != null && participantLoans > 0) {
    questionsToAsk.push('How often are participants using loans, and does the sponsor view loan activity as a participant need, a design issue, or an education issue?');
  }
  if (adminExpenses != null && assets != null && assets > 0) {
    questionsToAsk.push('When was the last full fee and service benchmark, including both hard-dollar plan costs and participant-borne costs?');
  }

  recommendations.push('Start with governance and plan design before pitching investments. A stronger conversation begins with process, participant outcomes, and vendor accountability.');
  if (likelyRecordkeeper) {
    recommendations.push('Prepare a benchmarking angle around the current platform, especially participant experience, service responsiveness, and total cost relative to plan size.');
  }
  if (!hasRoth) {
    recommendations.push('Use Roth as a practical talking point, but verify first rather than assuming the feature is absent.');
  }
  if (!hasMatch) {
    recommendations.push('Explore whether plan design is lagging the sponsor’s workforce goals. Even if they do not want a match, the discussion itself is valuable.');
  }
  if (participantLoans != null && participantLoans > 0) {
    recommendations.push('If loan usage is material, pair any design discussion with participant education rather than treating loans as only a compliance data point.');
  }
  if (lateContributions || prohibitedTransactions || loansInDefault) {
    recommendations.push('Lean into fiduciary process and risk control. That tends to be a stronger entry point than leading with fund performance.');
  }

  var summaryParts = [];
  if (planSegment) summaryParts.push('This looks like a ' + planSegment.toLowerCase() + '-market defined contribution plan');
  else summaryParts.push('This appears to be a defined contribution plan');
  if (assets != null) summaryParts.push('with roughly $' + Math.round(assets).toLocaleString() + ' in assets');
  if (participants != null) summaryParts.push('and about ' + participants.toLocaleString() + ' participants with balances');
  if (likelyRecordkeeper) summaryParts.push('likely supported by ' + likelyRecordkeeper);
  var summary = summaryParts.join(' ') + '. ';
  summary += 'From a prospecting standpoint, the filing suggests the best entry points are ';
  if (lateContributions || prohibitedTransactions || loansInDefault) {
    summary += 'governance, process discipline, and fiduciary cleanup';
  } else if (!hasRoth || !hasMatch || !hasLoans) {
    summary += 'plan design, participant flexibility, and vendor benchmarking';
  } else {
    summary += 'fee benchmarking, provider evaluation, and participant experience';
  }
  summary += ' rather than a generic investment-only pitch.';

  var humanTake = 'This is the kind of plan where a credible advisor should show up with a point of view, not just a lineup critique. ';
  if (lateContributions || prohibitedTransactions || loansInDefault) {
    humanTake += 'The filing gives you a legitimate compliance/process angle, which is often the cleanest door-opener because it ties directly to fiduciary oversight. ';
  } else {
    humanTake += 'The better approach is to diagnose whether the plan is simply functional or actually competitive and well-governed. ';
  }
  if (!hasRoth || !hasMatch || !hasLoans) {
    humanTake += 'There also appear to be plan design questions worth surfacing, especially around participant flexibility and whether the current structure still fits the workforce.';
  } else {
    humanTake += 'That makes this more of a quality-of-service, cost, and strategic oversight conversation than a rescue mission.';
  }

  var confidence = 'medium';
  if (parsed && parsed.planName && parsed.ein && assets != null && participants != null) confidence = 'high';

  return {
    summary: summary,
    score: score,
    strengths: uniqueStrings(strengths, 6),
    watchItems: uniqueStrings(watchItems, 6),
    opportunities: uniqueStrings(opportunities, 6),
    questionsToAsk: uniqueStrings(questionsToAsk, 6),
    recommendations: uniqueStrings(recommendations, 6),
    pitchAngle: lateContributions || prohibitedTransactions || loansInDefault
      ? 'Lead with fiduciary process, operational control, and sponsor-risk reduction. Use investments as a secondary discussion, not the headline.'
      : 'Lead with benchmarking, participant outcomes, and whether the current provider/design setup is still the best fit for the plan’s size and goals.',
    humanTake: humanTake,
    confidence: confidence,
    meta: {
      likelyRecordkeeper: likelyRecordkeeper,
      planSegment: planSegment,
      assetsPerParticipant: assetsPerParticipant,
      hasRoth: hasRoth,
      hasLoans: hasLoans,
      hasMatch: hasMatch
    }
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

    var response = await callAnthropic({
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

    var rawText = extractTextFromAnthropicResponse(response);
    var parsed = normalizeParsed(parseMaybeJSON(rawText));
    var insights = buildAiInsights(parsed);

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
