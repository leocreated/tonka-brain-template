// Heuristic credential detection. Findings carry a rule id and line number
// only; matched content is never returned, logged or printed.
import path from 'node:path';
import { looksUtf16 } from './util.mjs';

const PLACEHOLDER = /(example|sample|placeholder|changeme|dummy|your[_-]?|xxxx|redacted|<|>|\$\{)/i;

export const SECRET_RULES = [
  { id: 'private-key-block', re: /-----BEGIN[ A-Z0-9]*PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { id: 'github-fine-grained-token', re: /\bgithub_pat_[A-Za-z0-9_]{50,255}\b/g },
  { id: 'anthropic-api-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'openai-style-api-key', re: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g },
  { id: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { id: 'slack-webhook', re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/]{20,}/g },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g },
  { id: 'stripe-live-key', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/g },
  { id: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    id: 'url-embedded-password',
    re: /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s:@/<>{}$]+:([^\s@/<>{}$]{6,})@[A-Za-z0-9.-]+/gi,
    check: (m) => !PLACEHOLDER.test(m[1]),
  },
  {
    id: 'generic-secret-assignment',
    re: /\b(?:api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|secret|token|password|passwd)["']?[ \t]*[:=][ \t]*["']?([A-Za-z0-9+/_\-.=]{20,})/gi,
    check: (m) => looksRandom(m[1]),
  },
];

function entropy(s) {
  const counts = new Map();
  for (const c of s) counts.set(c, (counts.get(c) || 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function looksRandom(s) {
  if (PLACEHOLDER.test(s)) return false;
  if (!/[0-9]/.test(s) || !/[A-Za-z]/.test(s)) return false;
  return entropy(s) >= 3.5;
}

function swap16(buf) {
  const out = Buffer.from(buf.subarray(0, buf.length - (buf.length % 2)));
  out.swap16();
  return out;
}

// Decode bytes into one or more text views for scanning.
export function decodeForScan(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { encoding: 'utf8', binary: false, texts: [buf.subarray(3).toString('utf8')] };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { encoding: 'utf16le', binary: false, texts: [buf.subarray(2).toString('utf16le')] };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { encoding: 'utf16be', binary: false, texts: [swap16(buf.subarray(2)).toString('utf16le')] };
  }
  if (looksUtf16(buf)) {
    const n = Math.min(buf.length, 4096);
    let oddNul = 0;
    for (let i = 1; i < n; i += 2) if (buf[i] === 0) oddNul++;
    const le = oddNul > n / 4;
    return { encoding: le ? 'utf16le' : 'utf16be', binary: false, texts: [le ? buf.toString('utf16le') : swap16(buf).toString('utf16le')] };
  }
  if (buf.includes(0)) {
    // Binary: scan the raw bytes as Latin-1 plus both UTF-16 views so ASCII
    // or wide-character secrets embedded in binary blobs are still found.
    return {
      encoding: 'binary',
      binary: true,
      texts: [buf.toString('latin1'), buf.toString('utf16le'), swap16(buf).toString('utf16le')],
    };
  }
  return { encoding: 'utf8', binary: false, texts: [buf.toString('utf8')] };
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export function scanText(text) {
  const findings = [];
  const seen = new Set();
  for (const rule of SECRET_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text))) {
      if (rule.check && !rule.check(m)) continue;
      const line = lineAt(text, m.index);
      const key = `${rule.id}:${line}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({ rule: rule.id, line });
      }
    }
  }
  return findings;
}

export function scanBuffer(buf) {
  const dec = decodeForScan(buf);
  const findings = [];
  const seen = new Set();
  for (const [i, text] of dec.texts.entries()) {
    for (const f of scanText(text)) {
      // Line numbers are only meaningful for the primary text view.
      const line = i === 0 ? f.line : null;
      const key = `${f.rule}:${line}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({ rule: f.rule, line });
      }
    }
  }
  return { encoding: dec.encoding, binary: dec.binary, findings };
}

const ALLOWED_ENV = new Set(['.env.example', '.env.sample', '.env.template']);
const SECRET_EXT = /\.(pem|key|p8|p12|pfx|jks|keystore|kdbx|ppk|ovpn|tfstate)$/i;
const SECRET_NAMES = new Set([
  '.npmrc', '.netrc', '_netrc', '.pypirc', '.git-credentials', '.htpasswd', '.pgpass',
  'credentials', 'credentials.json', 'secrets.json', 'secrets.yaml', 'secrets.yml',
  'service-account.json', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
]);

// Returns a reason string when the file name itself suggests a secret store.
export function forbiddenFilename(rel) {
  const base = path.posix.basename(rel).toLowerCase();
  if (base === '.env' || (base.startsWith('.env.') && !ALLOWED_ENV.has(base))) return 'environment file';
  if (SECRET_NAMES.has(base)) return 'credential file name';
  if (SECRET_EXT.test(base)) return 'key or credential file type';
  return null;
}
