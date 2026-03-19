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

function currencyShort(n) {
  if (n == null || !isFinite(n)) return null;
  var abs = Math.abs(n);
  if (abs >= 1000000000) return '$' + (n / 1000000000).toFixed(abs >= 10000000000 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (abs >= 1000000) return '$' + (n / 1000000).toFixed(abs >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (abs >= 1000) return '$' + (n / 1000).toFixed(abs >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return '$' + Math.round(n).toLocaleString();
}

function pct1(n) {
  if (n == null || !isFinite(n)) return null;
  return (n * 100).toFixed(1).replace(/\.0$/, '') + '%';
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

function buildInsights(parsed) {
  var f = parsed && parsed.financials ? parsed.financials : {};
  var p = parsed && parsed.participants ? parsed.participants : {};
  var c = parsed && parsed.compliance ? parsed.compliance : {};
  var assets = f.totalAssetsEOY;
  var assetsBOY = f.totalAssetsBOY;
  var participants = p.withAccountBalances != null ? p.withAccountBalances : (p.totalEndOfYear != null ? p.totalEndOfYear : p.activeEndOfYear);
  var activeParticipants = p.activeEndOfYear;
  var totalParticipants = p.totalEndOfYear;
  var beginningParticipants = p.beginningOfYear;
  var employer = f.employerContributions;
  var employee = f.participantContributions;
  var totalContrib = f.totalContributions;
  var benefitsPaid = f.benefitsPaid;
  var adminExpenses = f.adminExpenses;
  var totalExpenses = f.totalExpenses;
  var totalIncome = f.totalIncome;
  var netIncome = f.netIncome;
  var loans = f.participantLoans;
  var investmentGainLoss = f.investmentGainLoss;
  var likelyRecordkeeper = inferRecordkeeper(parsed);
  var hasRoth = hasFeature(parsed, /roth/);
  var hasLoans = (loans != null && loans > 0) || hasFeature(parsed, /loan/);
  var hasMatch = employer != null && employer > 0;
  var audited = !!(parsed && parsed.auditor && parsed.auditor.name);
  var lateContributions = c.lateContributions === true;
  var prohibitedTransactions = c.prohibitedTransactions === true;
  var loansInDefault = c.loansInDefault === true;
  var planSegment = getPlanSegment(participants, assets);
  var assetsPerParticipant = (assets != null && participants && participants > 0) ? assets / participants : null;
  var assetGrowth = (assets != null && assetsBOY != null) ? (assets - assetsBOY) : null;
  var assetGrowthPct = (assets != null && assetsBOY != null && assetsBOY !== 0) ? ((assets - assetsBOY) / assetsBOY) : null;
  var contributionRate = (totalContrib != null && assets != null && assets > 0) ? (totalContrib / assets) : null;
  var employeeRate = (employee != null && assets != null && assets > 0) ? (employee / assets) : null;
  var employerRate = (employer != null && assets != null && assets > 0) ? (employer / assets) : null;
  var adminExpenseRate = (adminExpenses != null && assets != null && assets > 0) ? (adminExpenses / assets) : null;
  var benefitDrainRate = (benefitsPaid != null && assets != null && assets > 0) ? (benefitsPaid / assets) : null;
  var loanRate = (loans != null && assets != null && assets > 0) ? (loans / assets) : null;
  var participantGrowth = (totalParticipants != null && beginningParticipants != null && beginningParticipants > 0)
    ? ((totalParticipants - beginningParticipants) / beginningParticipants)
    : null;

  var score = 5;
  if (assets != null) {
    if (assets >= 50000000) score += 2;
    else if (assets >= 10000000) score += 1;
    else if (assets < 1000000) score -= 1;
  }
  if (participants != null) {
    if (participants >= 50) score += 1;
    if (participants >= 200) score += 1;
    if (participants < 10) score -= 1;
  }
  if (lateContributions) score += 1;
  if (prohibitedTransactions) score += 1;
  if (!hasRoth) score += 1;
  if (!hasMatch && employee != null && employee > 0) score += 1;
  if (adminExpenseRate != null && adminExpenseRate > 0.01) score += 1;
  score = Math.max(1, Math.min(10, Math.round(score)));

  var strengths = [];
  var watchItems = [];
  var opportunities = [];
  var questionsToAsk = [];
  var recommendations = [];
  var smartObservations = [];

  if (assets != null) {
    strengths.push('The plan has real scale at ' + currencyShort(assets) + ' in year-end assets, which makes provider benchmarking and governance improvements economically meaningful.');
  }

  if (participants != null) {
    strengths.push('The participant base appears large enough for plan design, education, and service changes to have visible impact rather than just cosmetic value.');
  }

  if (assetsPerParticipant != null && assetsPerParticipant >= 100000) {
    strengths.push('Average balances are relatively strong at about ' + currencyShort(assetsPerParticipant) + ' per participant, which supports a more sophisticated discussion around fees, investment structure, and participant advice solutions.');
  } else if (assetsPerParticipant != null && assetsPerParticipant >= 50000) {
    strengths.push('Average balances are respectable at roughly ' + currencyShort(assetsPerParticipant) + ' per participant, which suggests the plan may be mature enough for a meaningful fee and design review.');
  }

  if (audited) {
    strengths.push('This appears to be an audited filing, which usually means there is enough complexity and visibility for an advisor to have a broader governance conversation.');
  }

  if (assetGrowth != null && assetGrowth > 0) {
    strengths.push('Assets grew year over year, which at minimum suggests the plan is not stagnant and may reflect a healthy mix of contributions, retention, and market participation.');
  }

  if (likelyRecordkeeper) {
    smartObservations.push('The likely recordkeeper appears to be ' + likelyRecordkeeper + ', so the real conversation may be as much about platform value, participant experience, and service friction as it is about investments.');
  }

  if (assetGrowthPct != null) {
    if (assetGrowthPct > 0.15) {
      smartObservations.push('The pace of asset growth looks meaningful. That can indicate a plan gaining traction, but it also raises the question of whether the current provider and fee structure have kept up with the plan’s new scale.');
    } else if (assetGrowthPct > 0.03) {
      smartObservations.push('The plan appears to be growing at a healthy pace, which creates a natural opening to ask whether governance and provider oversight have evolved alongside that growth.');
    } else if (assetGrowthPct < -0.05) {
      smartObservations.push('Assets moved backward year over year, which does not automatically mean the plan is weak, but it does raise useful questions about distributions, workforce turnover, or overall engagement.');
    }
  }

  if (participantGrowth != null) {
    if (participantGrowth > 0.1) {
      smartObservations.push('Participant counts appear to have grown noticeably, which may point to workforce expansion or better participation and makes plan scalability more relevant.');
    } else if (participantGrowth < -0.05) {
      smartObservations.push('Participant counts appear to have softened, which may deserve a closer look because shrinking headcount can change how the sponsor thinks about costs, plan design, and service needs.');
    }
  }

  if (contributionRate != null && contributionRate > 0.08) {
    smartObservations.push('Contribution flow looks fairly healthy relative to assets, which may suggest the plan is more engaged than a surface-level filing review would otherwise imply.');
  }

  if (loanRate != null && loanRate > 0.08) {
    smartObservations.push('Participant loan activity looks material relative to total assets, which often points to real participant liquidity needs rather than a one-off data quirk.');
  }

  if (adminExpenseRate != null && adminExpenseRate > 0.0075) {
    smartObservations.push('Administrative costs look elevated enough to justify a serious benchmarking conversation, especially if the sponsor assumes the current setup is simply “market.”');
  }

  if (lateContributions) {
    watchItems.push('Late contributions were flagged in the filing. That is not just a technical compliance issue—it is often a sign of payroll or internal process discipline that can become a broader fiduciary conversation.');
  }

  if (prohibitedTransactions) {
    watchItems.push('The filing reflects prohibited transactions, which is a meaningful governance concern and gives an advisor a legitimate process-and-risk angle rather than a generic sales pitch.');
  }

  if (loansInDefault) {
    watchItems.push('Participant loans in default were flagged, which may suggest weak loan follow-through, participant financial stress, or insufficient plan education.');
  }

  if (!hasRoth) {
    watchItems.push('No clear Roth feature was identifiable from the filing. That may be a data limitation rather than a true absence, but it is important enough to verify directly.');
  }

  if (!hasMatch && employee != null && employee > 0) {
    watchItems.push('Participant deferrals are present, but no employer contribution was clearly identified. That can leave the plan looking less competitive unless the sponsor has a deliberate reason for that design.');
  }

  if (adminExpenseRate != null && adminExpenseRate > 0.01) {
    watchItems.push('Administrative expenses look high relative to plan assets, which could signal expensive providers, inefficient plan structure, or costs that have not been revisited in too long.');
  } else if (adminExpenseRate != null && adminExpenseRate > 0.0075) {
    watchItems.push('Administrative costs look high enough to benchmark rather than assume they are reasonable.');
  }

  if (benefitDrainRate != null && benefitDrainRate > 0.1) {
    watchItems.push('Benefit payments are a notable draw on plan assets. That can be perfectly normal in a mature plan, but it also changes the tone of the conversation toward retention, demographics, and cash-flow behavior.');
  }

  if (loanRate != null && loanRate > 0.15) {
    watchItems.push('Participant loans appear to be a sizable share of total assets, which is usually worth digging into because it can signal recurring participant cash stress.');
  }

  if (!hasRoth) {
    opportunities.push('Verify whether Roth is available. If it is absent, that is a practical plan-design improvement conversation. If it exists but is not visible in the filing dynamics, the opportunity may really be participant education and adoption.');
  }

  if (!hasLoans) {
    opportunities.push('Confirm whether participant loans are intentionally excluded. If so, the more interesting question is whether cash-need pressure is surfacing elsewhere through hardship activity or participant behavior.');
  }

  if (!hasMatch) {
    opportunities.push('A sponsor with no employer contribution may still have a strong rationale, but it creates an opening to discuss whether the current design is helping enough with retention, recruiting, and participation.');
  }

  if (likelyRecordkeeper) {
    opportunities.push('Benchmark the current ' + likelyRecordkeeper + ' setup on total cost, service responsiveness, payroll integration, education support, and participant experience instead of treating recordkeeping as a commodity.');
  }

  if (assetsPerParticipant != null && assetsPerParticipant > 100000) {
    opportunities.push('The balance profile looks strong enough to support a more sophisticated review of share classes, QDIA quality, managed-account value, retirement-income positioning, and overall investment architecture.');
  }

  if (lateContributions || prohibitedTransactions || loansInDefault) {
    opportunities.push('The filing already gives you a real governance/process wedge. That is often a stronger and more credible entry point than leading with performance or fund replacement ideas.');
  }

  if (parsed && Array.isArray(parsed.serviceProviders) && parsed.serviceProviders.length >= 3) {
    opportunities.push('There are enough providers identified here to open a broader vendor-accountability conversation, not just a narrow investment review.');
  }

  if (adminExpenseRate != null && adminExpenseRate > 0.0075) {
    opportunities.push('A fee and service benchmark looks justified here, and the conversation should include both explicit plan costs and participant-borne friction.');
  }

  if (likelyRecordkeeper) {
    questionsToAsk.push('How satisfied is the sponsor or committee with ' + likelyRecordkeeper + ' on service, payroll integration, participant support, and solving real problems when they come up?');
  } else {
    questionsToAsk.push('What is the sponsor happiest with today, and where do they feel the current plan/provider setup falls short in practice?');
  }

  if (!hasRoth) {
    questionsToAsk.push('Does the plan currently permit Roth contributions, and if not, has that decision been reviewed recently in light of how participants save today?');
  }

  if (!hasMatch) {
    questionsToAsk.push('Is the current employer contribution approach intentional, and does the sponsor believe it is still competitive for the workforce they are trying to retain?');
  }

  if (lateContributions) {
    questionsToAsk.push('What specifically caused the late contribution issue, and was that fixed at the payroll/process level or just corrected after the fact?');
  }

  if (loanRate != null && loanRate > 0.08) {
    questionsToAsk.push('Is participant loan usage viewed internally as normal convenience, or has the sponsor noticed broader employee cash-flow pressure?');
  } else if (hasLoans) {
    questionsToAsk.push('How does the sponsor think about participant loans philosophically—helpful flexibility, necessary evil, or something they would rather minimize?');
  }

  if (adminExpenseRate != null) {
    questionsToAsk.push('When was the last true fee and service benchmark, including plan-level costs, participant experience, and whether the current provider stack is earning its keep?');
  }

  if (benefitDrainRate != null && benefitDrainRate > 0.1) {
    questionsToAsk.push('Is the plan becoming more distribution-heavy, and if so, how is the sponsor thinking about demographics, retirement readiness, and participant support?');
  }

  recommendations.push('Do not lead this conversation with fund performance. Start with whether the plan is well-designed, well-governed, and well-served for its current size and workforce.');
  recommendations.push('Frame the first meeting around diagnosis: service friction, fiduciary process, plan design fit, payroll flow, participant behavior, and what the sponsor actually wants the plan to accomplish.');

  if (lateContributions || prohibitedTransactions || loansInDefault) {
    recommendations.push('Lead with fiduciary process and operational control. That is the most credible opening because the filing itself already points to process risk.');
  } else {
    recommendations.push('Lead with benchmarking and strategic fit. The strongest angle here is often whether the current provider/design setup still makes sense as the plan evolves.');
  }

  if (!hasRoth) {
    recommendations.push('Use Roth as a smart talking point, but verify the fact pattern rather than presenting it as a certainty.');
  }

  if (!hasMatch) {
    recommendations.push('Explore whether the sponsor’s contribution philosophy is still aligned with the labor market and employee behavior, not just whether a match exists on paper.');
  }

  if (adminExpenseRate != null && adminExpenseRate > 0.0075) {
    recommendations.push('Bring a fee-and-service benchmark lens, but make it broader than basis points. Tie costs back to participant experience and sponsor oversight burden.');
  }

  if (loanRate != null && loanRate > 0.08) {
    recommendations.push('If participant loans are meaningful, pair any plan-design discussion with participant education rather than treating loan usage as only a compliance footnote.');
  }

  var summaryParts = [];
  if (planSegment) summaryParts.push('This reads like a ' + planSegment.toLowerCase() + '-market defined contribution plan');
  else summaryParts.push('This reads like a defined contribution plan');

  if (assets != null) summaryParts.push('with about ' + currencyShort(assets) + ' in assets');
  if (participants != null) summaryParts.push('and roughly ' + participants.toLocaleString() + ' participants with balances');
  if (likelyRecordkeeper) summaryParts.push('likely sitting on ' + likelyRecordkeeper);

  var subjectiveSummary = summaryParts.join(' ') + '. ';
  if (lateContributions || prohibitedTransactions || loansInDefault) {
    subjectiveSummary += 'The filing gives you a real governance and process angle, which is stronger than a generic investment pitch because it ties directly to sponsor risk and fiduciary discipline. ';
  } else if (!hasRoth || !hasMatch || !hasLoans) {
    subjectiveSummary += 'What stands out most is not necessarily a broken plan, but a plan-design and competitiveness conversation waiting to happen. ';
  } else {
    subjectiveSummary += 'At first glance this does not look like a disaster case. The opportunity is more likely in sharpening governance, benchmarking the current provider setup, and making sure the plan has not simply been left on autopilot. ';
  }

  if (assetsPerParticipant != null && assetsPerParticipant > 100000) {
    subjectiveSummary += 'The balance profile is strong enough that a thoughtful advisor should be asking harder questions about value, costs, and participant outcomes.';
  } else if (assetsPerParticipant != null && assetsPerParticipant < 25000) {
    subjectiveSummary += 'The lower balance profile suggests participant engagement, savings behavior, or workforce demographics may matter as much as pure investment menu quality.';
  }

  var growthCommentary = null;
  if (assetGrowth != null && assetGrowthPct != null) {
    if (assetGrowthPct > 0.15) {
      growthCommentary = 'Plan assets appear to have grown materially year over year—roughly ' + pct1(assetGrowthPct) + '. Some of that may be market-driven, but growth of that magnitude usually invites a fair question: has the provider, fee, and governance setup kept pace with the plan’s current scale?';
    } else if (assetGrowthPct > 0.03) {
      growthCommentary = 'The plan appears to have posted healthy year-over-year asset growth of about ' + pct1(assetGrowthPct) + '. That is often a good sign, but it can also mask complacency if the sponsor has not revisited fees, design, or service as the plan has matured.';
    } else if (assetGrowthPct >= -0.03) {
      growthCommentary = 'Assets look relatively flat year over year. That is not inherently negative, but it shifts the more interesting questions toward participation behavior, employer philosophy, and whether the plan is evolving strategically or simply operating in place.';
    } else {
      growthCommentary = 'Assets declined year over year by about ' + pct1(Math.abs(assetGrowthPct)) + '. That does not prove there is a problem, but it does make it worth asking whether distributions, headcount changes, or weak contribution behavior are putting pressure on the plan.';
    }
  } else if (participantGrowth != null) {
    if (participantGrowth > 0.1) {
      growthCommentary = 'Participant counts appear to be moving in the right direction, which suggests the plan may be growing in reach even if the asset story is less clear from the filing.';
    } else if (participantGrowth < -0.05) {
      growthCommentary = 'Participant counts appear softer year over year, which can change the economics and priorities of the plan even if headline asset data does not look dramatic.';
    }
  }

  var humanTake = 'This is not the kind of plan I would approach with a canned “we can improve your investments” pitch. ';
  if (lateContributions || prohibitedTransactions || loansInDefault) {
    humanTake += 'The more credible opening is operational discipline, fiduciary process, and sponsor protection. ';
  } else {
    humanTake += 'The more credible opening is whether the plan is simply functioning versus actually being competitive, well-governed, and aligned with the sponsor’s workforce goals. ';
  }
  if (likelyRecordkeeper) {
    humanTake += 'If the current platform is ' + likelyRecordkeeper + ', I would go in prepared to talk about service model, participant experience, and cost/value tradeoffs—not just lineup construction.';
  } else {
    humanTake += 'I would want to understand where the real friction is today before assuming the issue is investments.';
  }

  var pitchAngle;
  if (lateContributions || prohibitedTransactions || loansInDefault) {
    pitchAngle = 'Lead with fiduciary process, operational cleanup, and sponsor-risk reduction. Position investments as part of the broader oversight conversation, not the opening headline.';
  } else if (!hasRoth || !hasMatch || !hasLoans) {
    pitchAngle = 'Lead with plan design, competitiveness, and participant outcomes. The better story here is whether the current design still fits the workforce and sponsor goals.';
  } else {
    pitchAngle = 'Lead with benchmarking, governance, and whether the current provider setup is delivering enough value for a plan of this size and profile.';
  }

  var confidence = 'medium';
  if (parsed && parsed.planName && parsed.ein && assets != null && participants != null) confidence = 'high';

  return {
    subjectiveSummary: subjectiveSummary,
    smartObservations: uniqueStrings(smartObservations, 6),
    growthCommentary: growthCommentary,
    strengths: uniqueStrings(strengths, 6),
    watchItems: uniqueStrings(watchItems, 6),
    opportunities: uniqueStrings(opportunities, 6),
    questionsToAsk: uniqueStrings(questionsToAsk, 6),
    recommendations: uniqueStrings(recommendations, 6),
    pitchAngle: pitchAngle,
    humanTake: humanTake,
    confidence: confidence,
    score: score,
    meta: {
      likelyRecordkeeper: likelyRecordkeeper,
      planSegment: planSegment,
      assetsPerParticipant: assetsPerParticipant != null ? Math.round(assetsPerParticipant) : null,
      hasRoth: hasRoth,
      hasLoans: hasLoans,
      hasMatch: hasMatch,
      assetGrowth: assetGrowth != null ? Math.round(assetGrowth) : null,
      assetGrowthPct: assetGrowthPct,
      audited: audited,
      contributionRate: contributionRate,
      adminExpenseRate: adminExpenseRate,
      loanRate: loanRate
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
    var insights = buildInsights(parsed);

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
