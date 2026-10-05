'use strict';

/**
 * InternSafe detector
 * -------------------
 * A rule-based, deterministic checker for fake internship / job offers.
 * Same input -> same output. No AI API, no network calls, no dependencies.
 *
 * How it works (the 30-second viva answer):
 *   1. Every red flag is a RULE (see the RULES list below). A rule has a weight.
 *   2. For each rule we look for matching phrases (regex) or run a small check.
 *   3. Score = sum of the weights of the rules that triggered (max 100).
 *   4. Score decides the level: Low / Medium / High.
 *
 * To tune the detector, only change the numbers in RULES and THRESHOLDS.
 */

// ---------------------------------------------------------------------------
// 1. CONFIG
// ---------------------------------------------------------------------------

const MAX_TEXT_LENGTH = 5000; // longer text is cut (protects the server)
const MIN_TEXT_LENGTH = 15; // shorter text cannot be analysed meaningfully

// Score -> level. 0-29 Low, 30-59 Medium, 60+ High
const THRESHOLDS = { medium: 30, high: 60 };

// Email providers anyone can sign up for. A real company uses its own domain.
const FREE_EMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in',
  'outlook.com', 'hotmail.com', 'live.com', 'rediffmail.com', 'proton.me',
  'protonmail.com', 'icloud.com', 'aol.com', 'mail.com', 'ymail.com',
];

// Link shorteners hide where a link really goes.
const URL_SHORTENERS = [
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'cutt.ly', 'rb.gy',
  'shorturl.at', 'is.gd', 'tiny.cc', 'ow.ly', 'rebrand.ly', 'bl.ink',
];

// Chat links are handled by the CHAT_ONLY_CONTACT rule, not the link rule.
const CHAT_HOSTS = [
  't.me', 'telegram.me', 'telegram.dog', 'wa.me',
  'chat.whatsapp.com', 'api.whatsapp.com',
];

// Cheap domain endings that scammers like. Not proof, just a signal.
const SUSPICIOUS_TLDS = [
  'xyz', 'top', 'click', 'work', 'site', 'buzz', 'tk', 'ml', 'ga', 'cf',
  'gq', 'icu', 'cyou', 'monster', 'rest',
];

// Brands scammers pretend to be. Used to spot lookalike domains.
const BRANDS = [
  'amazon', 'google', 'microsoft', 'infosys', 'wipro', 'flipkart',
  'accenture', 'deloitte', 'cognizant', 'paytm', 'linkedin', 'naukri',
  'internshala',
];

// Words that are not useful when comparing a company name with a domain.
const COMPANY_STOPWORDS = [
  'pvt', 'ltd', 'private', 'limited', 'llp', 'inc', 'corp', 'corporation',
  'technologies', 'technology', 'solutions', 'services', 'systems',
  'software', 'labs', 'india', 'global', 'group', 'the', 'and', 'company',
  'studio',
];

// ---------------------------------------------------------------------------
// 2. SMALL HELPERS
// ---------------------------------------------------------------------------

class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

/** Make sure a regex has the "g" flag so we can find every match. */
function globalRegex(re) {
  return new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
}

/**
 * Is the phrase at `index` negated?  "There is NO registration fee" must not
 * count as a red flag. We look at the 30 characters before the phrase.
 */
function isNegated(text, index) {
  const before = text.slice(Math.max(0, index - 30), index);
  return /\b(?:no|not|never|without|zero|nahi|nahin|don'?t|doesn'?t|won'?t|neither|nor)\b[^.!?,;:\n]{0,20}$/i.test(before);
}

/** Remove overlapping matches (keep the one that starts first / is longer). */
function dedupeMatches(matches) {
  const sorted = matches
    .slice()
    .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const out = [];
  let lastEnd = -1;
  for (const m of sorted) {
    if (m.start >= lastEnd) {
      out.push(m);
      lastEnd = m.end;
    }
  }
  return out;
}

/** Find every pattern of a rule inside the text. */
function findPatternMatches(rule, ctx) {
  const found = [];
  for (const re of rule.patterns) {
    for (const m of ctx.text.matchAll(re)) {
      if (!m[0]) continue;
      if (isNegated(ctx.text, m.index)) continue;
      found.push({
        phrase: m[0],
        start: m.index,
        end: m.index + m[0].length,
        source: 'text',
      });
    }
  }
  return dedupeMatches(found);
}

/** Turn a link into a URL object, or null if it is not a valid link. */
function parseUrl(raw) {
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'http://' + raw;
    const u = new URL(withScheme);
    if (!u.hostname || !u.hostname.includes('.')) return null;
    return u;
  } catch (e) {
    return null;
  }
}

function hostOf(url) {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

function companyTokens(company) {
  return company
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !COMPANY_STOPWORDS.includes(t));
}

// ---------------------------------------------------------------------------
// 3. CUSTOM DETECTORS (rules that need more than a phrase list)
// ---------------------------------------------------------------------------

const URL_REGEX = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+|\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|rb\.gy|shorturl\.at|is\.gd|tiny\.cc|ow\.ly)\/[^\s<>"')\]]+/gi;
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

/** Look for a brand name used in an unofficial domain (amaz0n-jobs.xyz). */
function brandImpersonated(host) {
  const normalised = host
    .replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/5/g, 's');
  for (const brand of BRANDS) {
    if (normalised.includes(brand)) {
      const official = new RegExp('(^|\\.)' + brand + '\\.(com|in|co\\.in|org|net)$');
      if (!official.test(host)) return brand;
    }
  }
  return null;
}

function detectSuspiciousLink(ctx) {
  const candidates = [];
  for (const m of ctx.text.matchAll(URL_REGEX)) {
    const url = m[0].replace(/[.,;!?)\]]+$/, '');
    candidates.push({ url, start: m.index, end: m.index + url.length, source: 'text' });
  }
  if (ctx.link) candidates.push({ url: ctx.link, start: -1, end: -1, source: 'link' });

  const matches = [];
  const seen = new Set();
  for (const c of candidates) {
    const key = c.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const parsed = parseUrl(c.url);
    if (!parsed) {
      if (c.source === 'link') {
        ctx.warnings.push('The link you entered is not a valid web address, so it was not checked.');
      }
      continue;
    }
    const host = hostOf(parsed);
    if (CHAT_HOSTS.includes(host)) continue; // handled by CHAT_ONLY_CONTACT

    const reasons = [];
    if (URL_SHORTENERS.includes(host)) reasons.push('shortened link hides the real website');
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) reasons.push('link uses a raw IP address');
    if (/^http:\/\//i.test(c.url)) reasons.push('link does not use HTTPS');
    const tld = host.split('.').pop();
    if (SUSPICIOUS_TLDS.includes(tld)) reasons.push('unusual domain ending .' + tld);
    const brand = brandImpersonated(host);
    if (brand) reasons.push('uses the name "' + brand + '" on an unofficial domain');
    if (/-(?:apply|careers?|jobs?|offer|registration|verify|hiring|intern(?:ship)?s?)\b/.test(host)) {
      reasons.push('domain looks like a fake careers page');
    }
    if (ctx.company) {
      const tokens = companyTokens(ctx.company);
      const flatHost = host.replace(/[^a-z0-9]/g, '');
      if (tokens.length && !tokens.some((t) => flatHost.includes(t))) {
        reasons.push('website name does not match the company name');
      }
    }
    if (reasons.length) {
      matches.push({
        phrase: c.url, start: c.start, end: c.end, source: c.source,
        reason: reasons.join('; '),
      });
    }
  }
  return matches;
}

function detectUnofficialEmail(ctx) {
  const matches = [];
  for (const m of ctx.text.matchAll(EMAIL_REGEX)) {
    if (FREE_EMAIL_DOMAINS.includes(m[1].toLowerCase())) {
      matches.push({
        phrase: m[0], start: m.index, end: m.index + m[0].length, source: 'text',
        reason: 'free email provider (' + m[1].toLowerCase() + ')',
      });
    }
  }
  if (ctx.sender && ctx.sender.includes('@')) {
    const domain = ctx.sender.split('@').pop().trim().toLowerCase();
    if (FREE_EMAIL_DOMAINS.includes(domain)) {
      matches.push({
        phrase: ctx.sender, start: -1, end: -1, source: 'sender',
        reason: 'sender uses a free email provider (' + domain + ')',
      });
    }
  }
  return matches;
}

const COMPANY_IN_TEXT = [
  /\b(?:at|with|from|by|join(?:ing)?)\s+(?:the\s+)?[A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3}/,
  /[A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)*\s+(?:Pvt\.?\s*Ltd\.?|Private\s+Limited|Limited|LLP|Inc\.?|Corp\.?)/,
];
const ROLE_WORDS = /\b(?:intern(?:ship)?s?|developer|engineer(?:ing)?|analyst|designer|trainee|associate|executive|scientist|consultant|research|marketing|sales|writer|editor|accountant|tester)\b/i;
const DOMAIN_LIKE = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|co\.in|org|io|ai|net|edu|gov\.in|ac\.in)\b/gi;

/** Flag offers that name no company, no website and/or no real role. */
function detectVagueDetails(ctx) {
  const hasCompany =
    Boolean(ctx.company) || COMPANY_IN_TEXT.some((re) => re.test(ctx.text));
  const hasRole = ROLE_WORDS.test(ctx.text);

  const ignored = FREE_EMAIL_DOMAINS.concat(URL_SHORTENERS, CHAT_HOSTS);
  const domains = (ctx.text + ' ' + ctx.sender).match(DOMAIN_LIKE) || [];
  const usableDomain = domains.some((d) => !ignored.includes(d.toLowerCase()));
  const linkOk = ctx.link && !CHAT_HOSTS.includes((ctx.link.replace(/^https?:\/\//i, '').split('/')[0] || '').toLowerCase());
  const hasWebsite = usableDomain || Boolean(linkOk);

  const missing = [];
  if (!hasCompany) missing.push('company name');
  if (!hasWebsite) missing.push('company website or official email');
  if (!hasRole) missing.push('clear role description');

  if (missing.length >= 2) {
    return [{
      phrase: 'Missing: ' + missing.join(', '),
      start: -1, end: -1, source: 'analysis',
    }];
  }
  return [];
}

const MISSPELLINGS = /\b(?:selceted|selcted|opertunity|oppurtunity|oppertunity|recieve|recived|intership|joinng|salery|sallary|cmpany|compnay|carrer|aplly|registeration|registraion|certficate|payement|paymnet|transcation|congratulation)\b/gi;

/** Scam messages are often shouty, over-excited and full of typos. */
function detectPoorLanguage(ctx) {
  const matches = [];
  const capsRuns = [...ctx.text.matchAll(/\b[A-Z]{5,}(?:\s+[A-Z]{2,})*\b/g)];
  if (capsRuns.length >= 2) {
    for (const m of capsRuns) {
      matches.push({
        phrase: m[0], start: m.index, end: m.index + m[0].length,
        source: 'text', reason: 'shouting in capital letters',
      });
    }
  }
  for (const m of ctx.text.matchAll(/!{2,}/g)) {
    matches.push({
      phrase: m[0], start: m.index, end: m.index + m[0].length,
      source: 'text', reason: 'repeated exclamation marks',
    });
  }
  for (const m of ctx.text.matchAll(MISSPELLINGS)) {
    matches.push({
      phrase: m[0], start: m.index, end: m.index + m[0].length,
      source: 'text', reason: 'spelling mistake',
    });
  }
  return dedupeMatches(matches);
}

// ---------------------------------------------------------------------------
// 4. THE RULES  (all weights live here)
// ---------------------------------------------------------------------------
// Each rule: id, name, weight, severity, explanation, checklist, and either
//   patterns (list of regex)  or  detect(ctx) (custom function).
// Every rule understands English AND Hinglish phrases for its own topic.

const RULES = [
  {
    id: 'MONEY_REQUEST',
    name: 'Asks you to pay money',
    weight: 40,
    severity: 'critical',
    explanation:
      'A genuine company pays you, it never charges you to hire you. Registration, security, training or kit fees are the most common internship scam.',
    checklist:
      'Do not pay any fee, deposit or "refundable" amount. A real company never charges you to give you a job.',
    patterns: [
      /\b(?:registration|enrol(?:l)?ment|security|training|processing|verification|admission|joining|kit|laptop|id\s*card|certificate|certification|course|application|interview|placement|offer\s+letter|service)\s+(?:fees?|charges?|deposit|amount|cost)\b/gi,
      /\brefundable\s+(?:security\s+)?(?:deposit|amount|fees?)\b/gi,
      /\b(?:pay(?:able)?|transfer|deposit|send\s+(?:the\s+|your\s+)?(?:money|amount|payment|fees?))\b[^.\n]{0,40}?\b(?:upi|paytm|phonepe|gpay|google\s*pay|bhim|bank\s+account|account\s+number|qr\s*code)\b/gi,
      /\b(?:you|candidates?|students?|must|should|need\s+to|have\s+to|kindly|please|to|now)\s+(?:pay|deposit|transfer)\s+(?:an?\s+|the\s+)?(?:(?:amount|sum)\s+of\s+)?(?:(?:rs\.?|₹|inr)\s*\d[\d,]*|\d[\d,]*\s*(?:rs\.?|inr|rupees|\/-))/gi,
      /\bscan\s+(?:the\s+)?qr(?:\s*code)?\b/gi,
      // Hinglish
      /\bregistration\s+ke\s+liye\s+(?:\w+\s+){0,2}?(?:paise|paisa|rupay|rupaye|rs\.?|₹)/gi,
      /\b(?:paise|paisa|rupay|rupaye)\s+(?:bhejo|bhejiye|bhej\s+do|jama|dena|deni|dene|bharo)\b/gi,
      /\b(?:fees?|payment)\s+(?:jama|bharni|bharna|bharo|dena|deni)\b/gi,
      /\bpehle\s+(?:fees?|paise|payment)\b/gi,
    ],
  },
  {
    id: 'GUARANTEED_SELECTION',
    name: 'Guaranteed selection',
    weight: 25,
    severity: 'high',
    explanation:
      'Real selection involves an interview, test or screening. "100% placement" or "no interview" promises are a classic hook.',
    checklist:
      'Real hiring needs an interview or test. Be very careful with "guaranteed" or "no interview" offers.',
    patterns: [
      /\b(?:100\s*%|hundred\s+percent)\s*(?:placement|selection|job|guarantee(?:d)?|assured|sure)\b/gi,
      /\bguarantee(?:d)?\s+(?:selection|placement|job|internship|offer|joining)\b/gi,
      /\b(?:selection|placement|job)\s+(?:is\s+)?guaranteed\b/gi,
      /\bno\s+interviews?\b/gi,
      /\bwithout\s+(?:any\s+)?(?:interview|test|exam)s?\b/gi,
      /\bdirect\s+(?:joining|selection|offer)\b/gi,
      // Hinglish
      /\bpakka\s+(?:selection|job|placement)\b/gi,
      /\bbina\s+interview\b/gi,
    ],
  },
  {
    id: 'URGENCY_PRESSURE',
    name: 'Urgency and pressure',
    weight: 15,
    severity: 'medium',
    explanation:
      'Scammers rush you so you do not stop to verify. Real companies give you a few days to accept an offer.',
    checklist:
      'Take your time. Real companies give you days, not hours. Pressure to act today is a manipulation tactic.',
    patterns: [
      /\b(?:pay|confirm|register|apply|reply|respond|book)\s+(?:your\s+seat\s+)?(?:today|immediately|now|asap|urgently)\b/gi,
      /\b(?:seats|slots|vacancies|positions)\s+(?:are\s+)?(?:limited|filling\s+fast)\b/gi,
      /\blimited\s+(?:seats|slots|vacancies|positions)\b/gi,
      /\b(?:offer|link|seat|registration)\s+(?:will\s+)?(?:expires?|ends?|closes?)\s+(?:in|within|today|tonight|soon)\b/gi,
      /\b(?:valid|available)\s+only\s+(?:today|till|until|for)\b/gi,
      /\bonly\s+\d+\s+(?:seats?|slots?|vacancies|positions)\s+(?:left|remaining|available)\b/gi,
      /\b(?:hurry|last\s+chance|act\s+now)\b/gi,
      // Hinglish
      /\bjaldi\s+(?:karo|kariye|paise|pay|register)\b/gi,
      /\b(?:ghante|ghanta|din)\s+mein\s+(?:expire|khatam)\b/gi,
      /\bseats?\s+(?:limited|kam)\s+hain?\b/gi,
      /\bturant\s+(?:pay|payment|paise|register|confirm)\b/gi,
    ],
  },
  {
    id: 'UNOFFICIAL_EMAIL',
    name: 'Free email used for a company',
    weight: 20,
    severity: 'high',
    explanation:
      'Companies use their own email domain (name@company.com). A Gmail or Yahoo address claiming to be HR is a warning sign.',
    checklist:
      "Check that the sender uses the company's official email domain, not Gmail or Yahoo. Compare it with the contact details on the company's real website.",
    detect: detectUnofficialEmail,
  },
  {
    id: 'CHAT_ONLY_CONTACT',
    name: 'HR only on Telegram or WhatsApp',
    weight: 15,
    severity: 'medium',
    explanation:
      'Genuine recruiters use official email or the company portal. Asking you to move to Telegram or WhatsApp lets scammers disappear easily.',
    checklist:
      'Be cautious if HR only talks on Telegram or WhatsApp. Ask for an official email and a video interview.',
    patterns: [
      /\b(?:contact|message|text|ping|dm|call|reach)\b[^.\n]{0,40}?\b(?:telegram|whatsapp)\b/gi,
      /\b(?:t|wa)\.me\/\S+/gi,
      /\bjoin\b[^.\n]{0,25}?\b(?:telegram|whatsapp)\b/gi,
      /\btelegram\s+(?:id|handle|channel|group)\b/gi,
    ],
  },
  {
    id: 'UNREALISTIC_PAY',
    name: 'Too-good-to-be-true pay or easy work',
    weight: 20,
    severity: 'high',
    explanation:
      'High daily earnings for typing, data entry or "no skills needed" work is how task and work-from-home scams attract students.',
    checklist:
      'Compare the pay with the market. Big money for no skills or simple typing work is almost always a scam.',
    patterns: [
      /\bearn\s+(?:up\s*to\s+)?(?:rs\.?|₹|inr)?\s*\d[\d,]*\s*(?:\/|per|a|every)\s*(?:day|daily|week|weekly|hour)\b/gi,
      /\bwork\s+from\s+home\b[^.\n]{0,60}?\b(?:typing|data\s+entry|copy\s*paste|form\s+filling|ad\s+posting|like\s+and\s+share)\b/gi,
      /\b(?:typing|data\s+entry|copy\s*paste|form\s+filling|ad\s+posting)\s+(?:jobs?|work|ka\s+kaam|tasks?)\b/gi,
      /\bno\s+(?:skills?|experience|qualification|investment)\s+(?:is\s+)?(?:required|needed|necessary)\b/gi,
      /\b(?:daily|weekly)\s+(?:payment|payout|income|salary)\b/gi,
      /\bearn\s+(?:lakhs?|thousands?|crores?)\b/gi,
      /\bguaranteed\s+(?:income|salary|earnings?)\b/gi,
    ],
  },
  {
    id: 'VAGUE_DETAILS',
    name: 'Missing company details',
    weight: 10,
    severity: 'low',
    explanation:
      'A real offer names the company, the role and has a website or official email. Two or more of these missing is suspicious.',
    checklist:
      "Ask for the company name, role description, work location and website. Search the company on LinkedIn and its official site.",
    detect: detectVagueDetails,
  },
  {
    id: 'SUSPICIOUS_LINK',
    name: 'Suspicious link',
    weight: 25,
    severity: 'high',
    explanation:
      'Fake offers often use shortened, non-HTTPS or lookalike links (for example amaz0n-careers.xyz) to steal money or data.',
    checklist:
      "Do not click the link. Type the company's official website yourself and check whether the same offer is listed there.",
    detect: detectSuspiciousLink,
  },
  {
    id: 'POOR_LANGUAGE',
    name: 'Shouting, typos and over-excitement',
    weight: 10,
    severity: 'low',
    explanation:
      'ALL-CAPS, many exclamation marks and spelling mistakes are common in scam messages. Real HR messages are calm and proofread.',
    checklist:
      'Notice the tone. Real HR emails are calm and proofread, while scams shout and make mistakes.',
    detect: detectPoorLanguage,
  },
  {
    id: 'SENSITIVE_DATA_REQUEST',
    name: 'Asks for sensitive data early',
    weight: 30,
    severity: 'critical',
    explanation:
      'Aadhaar, PAN, bank details, OTP or passwords are asked by scammers for identity theft or to empty your account. Never share an OTP with anyone.',
    checklist:
      'Never share Aadhaar, PAN, bank details, OTP or passwords before you have joined and verified the company.',
    patterns: [
      /\b(?:send|share|provide|submit|upload|give|enter|tell|bhejo|bhejiye)\b[^.\n]{0,50}?\b(?:aadhaar|aadhar|adhaar|pan\s*(?:card|number|no\.?)|bank\s+(?:account|details|passbook)|passbook|otp|password|cvv|atm\s+pin|debit\s+card|credit\s+card|passport)\b/gi,
      /\b(?:otp|cvv|pin)\s+(?:bhejo|batao|share\s+karo|dena)\b/gi,
    ],
  },
  {
    id: 'HINGLISH_PATTERNS',
    name: 'Hinglish scam phrases',
    weight: 25,
    severity: 'high',
    explanation:
      'Phrases like "ghar baithe kamao", "lucky draw" or "paise wapas mil jayega" are typical of Indian WhatsApp and Telegram scams.',
    checklist:
      'Offers that promise easy money from home, lucky draws or "paise wapas" are common scams. Ignore them.',
    patterns: [
      /\bghar\s+baith(?:e|kar)\s+(?:kamao|paise|earn|kaam)\b/gi,
      /\b(?:lucky\s+draw|lottery|jackpot|kbc)\b/gi,
      /\b(?:paise\s+)?wapas\s+mil\s+jay(?:ega|enge)\b/gi,
      /\bpaise\s+kamao\b/gi,
    ],
  },
];

// General advice that is always shown, whatever the score.
const GENERAL_CHECKLIST = [
  'Ask your college placement cell if they know this company.',
  'Search the company name with the word "scam" or "reviews".',
  'Check that the company exists in the official company registry (MCA).',
  'If you have already paid money, report it at cybercrime.gov.in or call 1930.',
];
const LOW_RISK_NOTE =
  'Low risk does not mean safe. Always verify the offer with the official company.';

// Compile every pattern once with the "g" flag.
for (const rule of RULES) {
  if (rule.patterns) rule.patterns = rule.patterns.map(globalRegex);
}

// ---------------------------------------------------------------------------
// 5. ANALYZE
// ---------------------------------------------------------------------------

function levelFor(score) {
  if (score >= THRESHOLDS.high) return 'High';
  if (score >= THRESHOLDS.medium) return 'Medium';
  return 'Low';
}

function cleanField(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * analyze({ text, link, company, sender })
 * Only `text` is required. Throws ValidationError for unusable input.
 * Positions (start/end) in matches refer to `analyzedText`, so the frontend
 * should highlight that string.
 */
function analyze(input) {
  const source = input && typeof input === 'object' ? input : {};
  const trimmed = typeof source.text === 'string' ? source.text.trim() : '';

  if (!trimmed) {
    throw new ValidationError('EMPTY_TEXT', 'Please paste the offer text first.');
  }
  if (trimmed.length < MIN_TEXT_LENGTH) {
    throw new ValidationError('TEXT_TOO_SHORT', 'The text is too short to analyse. Paste the full offer.');
  }

  const warnings = [];
  const truncated = trimmed.length > MAX_TEXT_LENGTH;
  if (truncated) {
    warnings.push('The text was very long, so only the first ' + MAX_TEXT_LENGTH + ' characters were checked.');
  }

  const ctx = {
    text: trimmed.slice(0, MAX_TEXT_LENGTH),
    link: cleanField(source.link, 300),
    company: cleanField(source.company, 150),
    sender: cleanField(source.sender, 150),
    warnings,
  };

  const flags = [];
  for (const rule of RULES) {
    const matches = rule.detect ? rule.detect(ctx) : findPatternMatches(rule, ctx);
    if (matches.length > 0) {
      flags.push({
        id: rule.id,
        name: rule.name,
        weight: rule.weight,
        severity: rule.severity,
        explanation: rule.explanation,
        matches,
      });
    }
  }
  flags.sort((a, b) => b.weight - a.weight);

  const score = Math.min(100, flags.reduce((sum, f) => sum + f.weight, 0));
  const level = levelFor(score);

  const checklist = [];
  for (const flag of flags) {
    const rule = RULES.find((r) => r.id === flag.id);
    checklist.push(rule.checklist);
  }
  checklist.push(...GENERAL_CHECKLIST);
  if (level === 'Low') checklist.push(LOW_RISK_NOTE);

  return { score, level, flags, checklist, analyzedText: ctx.text, truncated, warnings };
}

module.exports = {
  analyze,
  levelFor,
  RULES,
  THRESHOLDS,
  MAX_TEXT_LENGTH,
  MIN_TEXT_LENGTH,
  ValidationError,
};
