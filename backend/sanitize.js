'use strict';

/**
 * Privacy helper for the "Report this scam" feature.
 * Before anything is saved we remove personal data from the text:
 * emails, phone numbers, Aadhaar-style numbers, PAN numbers and long
 * digit strings (bank accounts, OTP-like codes).
 *
 * Names cannot be removed automatically, so the UI also warns users not to
 * paste personal details.
 */

const MAX_SNIPPET_LENGTH = 200;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const AADHAAR_SPACED = /\b\d{4}[\s-]\d{4}[\s-]\d{4}\b/g;
const PHONE = /(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g;
const LONG_DIGITS = /\b\d{9,}\b/g;

function sanitizeSnippet(raw) {
  let s = String(raw).replace(/\s+/g, ' ').trim();
  s = s.replace(EMAIL, '[email removed]');
  s = s.replace(PAN, '[id removed]');
  s = s.replace(AADHAAR_SPACED, '[number removed]');
  s = s.replace(PHONE, '[phone removed]');
  s = s.replace(LONG_DIGITS, '[number removed]');
  return s.slice(0, MAX_SNIPPET_LENGTH);
}

module.exports = { sanitizeSnippet, MAX_SNIPPET_LENGTH };
