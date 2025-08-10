const dns = require("dns").promises;
const validator = require("validator");

const COMMON_DOMAINS = [
  "gmail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com",
  "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com"
];

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com","tempmail.com","10minutemail.com","guerrillamail.com","yopmail.com"
]);

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array(b.length + 1).fill(0).map((_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function suggestDomain(domain) {
  let best = null;
  let bestDist = Infinity;
  for (const cand of COMMON_DOMAINS) {
    const dist = levenshtein(domain, cand);
    if (dist < bestDist) {
      best = cand;
      bestDist = dist;
    }
  }
  return bestDist <= 2 ? best : null;
}

module.exports = async function validateEmailDeliverability(emailInput) {
  const normalized = validator.normalizeEmail(String(emailInput || ""), {
    gmail_remove_dots: false
  });

  if (!normalized || !validator.isEmail(normalized)) {
    return { ok: false, reason: "invalid_format" };
  }

  const [_, domain] = normalized.split("@");
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { ok: false, reason: "disposable_domain" };
  }

  try {
    const mx = await dns.resolveMx(domain);
    if (!mx.length) {
      const suggestion = suggestDomain(domain);
      return { ok: false, reason: "no_mx", didYouMean: suggestion ? `${_[0]}@${suggestion}` : undefined };
    }
  } catch {
    return { ok: false, reason: "no_mx" };
  }

  // If it's a big known domain, trust it without provider API
  if (COMMON_DOMAINS.includes(domain)) {
    return { ok: true, reason: "trusted_domain", email: normalized };
  }

  // For custom domains without verification API, pass if MX exists
  return { ok: true, reason: "mx_found", email: normalized };
};
