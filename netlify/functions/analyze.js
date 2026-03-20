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

function isReasonableParticipantCount(n) {
  return n != null && isFinite(n) && n >= 5;
}

function buildInsights(parsed) {
  var f = parsed && parsed.financials ? parsed.financials : {};
  var p = parsed && parsed.participants ? parsed.participants : {};
  var c = parsed && parsed.compliance ? parsed.compliance : {};

  var assets = f.totalAssetsEOY;
  var assetsBOY = f.totalAssetsBOY;
  var participants = p.withAccountBalances != null ? p.withAccountBalances : (p.totalEndOfYear != null ? p.totalEndOfYear : p.activeEndOfYear);
  var beginningParticipants = p.beginningOfYear;
  var employer = f.employerContributions;
  var employee = f.participantContributions;
  var totalContrib = f.totalContributions;
  var benefitsPaid = f.benefitsPaid;
  var adminExpenses = f.adminExpenses;
  var loans = f.participantLoans;

  var likelyRecordkeeper = inferRecordkeeper(parsed);
  var hasRoth = hasFeature(parsed, /roth/);
  var hasLoans = (loans != null && loans > 0) || hasFeature(parsed, /loan/);
  var hasMatch = employer != null && employer > 0;
  var lateContributions = c.lateContributions === true;
  var prohibitedTransactions = c.prohibitedTransactions === true;
  var loansInDefault = c.loansInDefault === true;

  var planSegment = getPlanSegment(participants, assets);
  var reasonableParticipants = isReasonableParticipantCount(participants);

  var assetsPerParticipant = (assets != null && reasonableParticipants) ? assets / participants : null;
  var assetGrowth = (assets != null && assetsBOY != null) ? (assets - assetsBOY) : null;
  var assetGrowthPct = (assets != null && assetsBOY != null && assetsBOY !== 0) ? ((assets - assetsBOY) / assetsBOY) : null;
  var adminExpenseRate = (adminExpenses != null && assets != null && assets > 0) ? (adminExpenses / assets) : null;
  var loanRate = (loans != null && assets != null && assets > 0) ? (loans / assets) : null;
  var contributionRate = (totalContrib != null && assets != null && assets > 0) ? (totalContrib / assets) : null;
  var benefitDrainRate = (benefitsPaid != null && assets != null && assets > 0) ? (benefitsPaid / assets) : null;
  var participantGrowth = (reasonableParticipants && beginningParticipants != null && beginningParticipants > 0)
    ? ((participants - beginningParticipants) / beginningParticipants)
    : null;

  var score = 5;
  if (assets != null) {
    if (assets >= 50000000) score += 2;
    else if (assets >= 10000000) score += 1;
    else if (assets < 1000000) score -= 1;
  }
  if (reasonableParticipants) {
    if (participants >= 50) score += 1;
    if (participants >= 200) score += 1;
  }
  if (lateContributions) score += 1;
  if (prohibitedTransactions) score += 1;
  if (!hasRoth) score += 1;
  if (!hasMatch && employee != null && employee > 0) score += 1;
  score = Math.max(1, Math.min(10, Math.round(score)));

  var whatStandsOut = [];
  var discussionPoints = [];
  var questionsToValidate = [];

  if (assetGrowthPct != null) {
    if (assetGrowthPct > 0.15) {
      whatStandsOut.push('Asset growth looks strong year over year, though some of that may be market-driven.');
    } else if (assetGrowthPct > 0.03) {
      whatStandsOut.push('Assets appear to be growing at a healthy pace.');
    } else if (assetGrowthPct < -0.05) {
      whatStandsOut.push('Assets moved down year over year, which is worth understanding before drawing conclusions.');
    }
  }

  if (!reasonableParticipants && assets != null) {
    whatStandsOut.push('The participant count in the filing may not be reading cleanly, so balance-based conclusions should be treated cautiously.');
  }

  if (loanRate != null && loanRate > 0.08) {
    whatStandsOut.push('Participant loan balances look meaningful relative to assets.');
  } else if (hasLoans) {
    whatStandsOut.push('The plan appears to have participant loans outstanding.');
  }

  if (!hasRoth) {
    whatStandsOut.push('No clear Roth feature was identified from the filing data.');
  }

  if (!hasMatch && employee != null && employee > 0) {
    whatStandsOut.push('No employer contribution was clearly shown.');
  }

  if (lateContributions) {
    whatStandsOut.push('Late contributions were flagged in the filing.');
  }

  if (prohibitedTransactions) {
    whatStandsOut.push('The filing reflects prohibited transactions.');
  }

  if (likelyRecordkeeper) {
    discussionPoints.push('Whether the current ' + likelyRecordkeeper + ' setup is still the right fit on service, cost, and participant experience.');
  } else {
    discussionPoints.push('Whether the current provider setup is still the right fit on service, cost, and participant experience.');
  }

  if (!hasRoth) {
    discussionPoints.push('Whether Roth is available and, if it is, whether participants are actually using it.');
  }

  if (!hasMatch) {
    discussionPoints.push('Whether the current contribution design is still competitive for the workforce.');
  }

  if (loanRate != null && loanRate > 0.08) {
    discussionPoints.push('Whether participant loan usage reflects broader cash-flow pressure or just normal plan usage.');
  }

  if (adminExpenseRate != null && adminExpenseRate > 0.0075) {
    discussionPoints.push('Whether fees and service have been benchmarked recently.');
  }

  if (benefitDrainRate != null && benefitDrainRate > 0.1) {
    discussionPoints.push('Whether the plan is becoming more distribution-heavy and how that is affecting overall plan dynamics.');
  }

  if (reasonableParticipants && assetsPerParticipant != null && assetsPerParticipant > 100000) {
    discussionPoints.push('Whether the plan’s balance profile supports a more thoughtful review of fees, investments, and participant support.');
  }

  questionsToValidate.push('Is Roth currently available?');

  if (!hasMatch) {
    questionsToValidate.push('Is the lack of employer contribution intentional?');
  }

  if (!reasonableParticipants) {
    questionsToValidate.push('Are the participant counts being interpreted correctly from the filing?');
  }

  if (loanRate != null && loanRate > 0.08) {
    questionsToValidate.push('Is participant loan usage actually this high, and if so, what is driving it?');
  }

  if (adminExpenseRate != null) {
    questionsToValidate.push('When was the last fee and service review?');
  }

  if (likelyRecordkeeper) {
    questionsToValidate.push('How satisfied is the sponsor with ' + likelyRecordkeeper + ' today?');
  }

  var summaryParts = [];
  if (planSegment) summaryParts.push('This appears to be a ' + planSegment.toLowerCase() + '-market plan');
  else summaryParts.push('This appears to be a defined contribution plan');

  if (assets != null) summaryParts.push('with roughly ' + currencyShort(assets) + ' in assets');
  if (reasonableParticipants) summaryParts.push('and about ' + participants.toLocaleString() + ' participants with balances');

  var subjectiveSummary = summaryParts.join(' ') + '. ';
  if (!reasonableParticipants) {
    subjectiveSummary += 'At a high level, it does not look broken, but the participant data may not be parsing cleanly, so a few conclusions should be treated cautiously. ';
  } else if (lateContributions || prohibitedTransactions || loansInDefault) {
    subjectiveSummary += 'The most obvious angle here is governance and process rather than investments alone. ';
  } else {
    subjectiveSummary += 'At a high level, this looks more like a plan to validate and benchmark than a clear problem case. ';
  }

  if (reasonableParticipants && assetsPerParticipant != null && assetsPerParticipant > 100000) {
    subjectiveSummary += 'The balance profile looks strong enough to justify a closer look at overall value, not just fund lineup changes.';
  } else if (!reasonableParticipants) {
    subjectiveSummary += 'I would validate the headcount and participant-balance data before leaning too hard on average-balance commentary.';
  }

  var confidence = 'medium';
  if (parsed && parsed.planName && parsed.ein && assets != null) confidence = 'high';

  return {
    subjectiveSummary: subjectiveSummary,
    growthCommentary: assetGrowthPct != null
      ? (assetGrowthPct > 0.15
        ? 'Assets grew meaningfully year over year, though some of that may simply reflect market movement.'
        : assetGrowthPct > 0.03
          ? 'Assets appear to have grown modestly year over year.'
          : assetGrowthPct < -0.05
            ? 'Assets declined year over year, which is worth understanding in context.'
            : 'Assets were relatively flat year over year.')
      : null,
    whatStandsOut: uniqueStrings(whatStandsOut, 4),
    discussionPoints: uniqueStrings(discussionPoints, 4),
    questionsToValidate: uniqueStrings(questionsToValidate, 5),
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
      adminExpenseRate: adminExpenseRate,
      loanRate: loanRate,
      contributionRate: contributionRate
    }
  };
}

async function callAnthropic(payload, apiKey, didRetry) {
  var controller = new AbortController();
  var timeout = setTimeout(function() {
    controller.abort();
  }, 25000);

  var resp, text, data;

  try {
    resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    text = await resp.text();

    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('Non-JSON response (likely timeout or HTML error)');
    }

    if (!resp.ok) {
      throw new Error((data && data.error && data.error.message) || ('Anthropic error ' + resp.status));
    }

    if (!data || !Array.isArray(data.content)) {
      throw new Error('Anthropic returned an unexpected response shape.');
    }

    return data;
  } catch (err) {
    if (!didRetry) {
      var retryPayload = JSON.parse(JSON.stringify(payload));
      retryPayload.max_tokens = 1800;
      return callAnthropic(retryPayload, apiKey, true);
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
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
    return jsonResponse(200, {
      ok: false,
      error: (err && err.message) ? err.message : 'Function failed.'
    });
  }
};
