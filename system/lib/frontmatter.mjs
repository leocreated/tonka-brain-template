// Parser for TONKA's constrained frontmatter format (see system/docs/record-format.md).
//
// Supported, one entry per line between `---` delimiters:
//   key: bare value            # trailing comment (needs whitespace before #)
//   key: "double quoted"       # escapes: \" \\ \n \t
//   key: 'single quoted'       # '' is a literal quote
//   key: [a, "b c", 'd']       # flat inline list
//   # full line comment
// Anything else (nested maps, block scalars, anchors, multi-line values) is
// rejected with a line number instead of being guessed at.

const KEY_LINE = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/;
const UNSUPPORTED_START = /^[{|>&*!%@`]/;

function trailingOk(rest) {
  if (rest === '') return true;
  return /^[ \t]+(#.*)?$/.test(rest);
}

function parseDouble(raw) {
  let out = '';
  for (let i = 1; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\') {
      const n = raw[i + 1];
      const map = { '"': '"', '\\': '\\', n: '\n', t: '\t', '/': '/' };
      if (!(n in map)) return { error: `unsupported escape "\\${n ?? ''}" in double-quoted value` };
      out += map[n];
      i++;
    } else if (c === '"') {
      return { value: out, rest: raw.slice(i + 1) };
    } else {
      out += c;
    }
  }
  return { error: 'unterminated double-quoted value' };
}

function parseSingle(raw) {
  let out = '';
  for (let i = 1; i < raw.length; i++) {
    const c = raw[i];
    if (c === "'") {
      if (raw[i + 1] === "'") {
        out += "'";
        i++;
      } else {
        return { value: out, rest: raw.slice(i + 1) };
      }
    } else {
      out += c;
    }
  }
  return { error: 'unterminated single-quoted value' };
}

function parseQuoted(raw) {
  return raw[0] === '"' ? parseDouble(raw) : parseSingle(raw);
}

function parseList(raw) {
  const items = [];
  let i = 1;
  const skipWs = () => {
    while (raw[i] === ' ' || raw[i] === '\t') i++;
  };
  skipWs();
  if (raw[i] === ']') return { value: items, rest: raw.slice(i + 1) };
  for (;;) {
    skipWs();
    const c = raw[i];
    if (c === undefined) return { error: 'unterminated list (missing "]")' };
    if (c === '"' || c === "'") {
      const q = parseQuoted(raw.slice(i));
      if (q.error) return q;
      items.push(q.value);
      i = raw.length - q.rest.length;
    } else {
      let j = i;
      while (j < raw.length && raw[j] !== ',' && raw[j] !== ']') j++;
      const item = raw.slice(i, j).trim();
      if (item === '') return { error: 'empty item in list' };
      if (/[[\]{}"'#]/.test(item)) return { error: `unsupported character in list item "${item}"; quote it` };
      items.push(item);
      i = j;
    }
    skipWs();
    if (raw[i] === ',') {
      i++;
      continue;
    }
    if (raw[i] === ']') return { value: items, rest: raw.slice(i + 1) };
    return { error: 'expected "," or "]" in list' };
  }
}

function parseValue(raw) {
  if (raw === undefined || raw === '') return { value: '' };
  if (raw.startsWith('#')) return { value: '' };
  const first = raw[0];
  if (first === '"' || first === "'") {
    const q = parseQuoted(raw);
    if (q.error) return q;
    if (!trailingOk(q.rest)) return { error: 'unexpected text after quoted value' };
    return { value: q.value };
  }
  if (first === '[') {
    const l = parseList(raw);
    if (l.error) return l;
    if (!trailingOk(l.rest)) return { error: 'unexpected text after list' };
    return { value: l.value };
  }
  if (UNSUPPORTED_START.test(raw) || raw.startsWith('- ') || raw === '-') {
    return { error: `unsupported YAML syntax "${raw.slice(0, 12)}"; use a quoted string or [a, b] list` };
  }
  const m = /[ \t]#/.exec(raw);
  const value = (m ? raw.slice(0, m.index) : raw).trim();
  if (/:([ \t]|$)/.test(value)) return { error: 'quote values that contain ": "' };
  return { value };
}

// Parse the frontmatter block of a Markdown file. The body is never read for
// metadata, so a line like "status: done" in prose has no effect.
export function parseFrontmatter(text) {
  const src = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const lines = src.split(/\r?\n/);
  const data = Object.create(null);
  const errors = [];
  if (lines[0].replace(/[ \t]+$/, '') !== '---') {
    return { hasFrontmatter: false, data, errors, bodyStartLine: 1 };
  }
  let closed = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].replace(/[ \t]+$/, '') === '---') {
      closed = i;
      break;
    }
  }
  if (closed < 0) {
    errors.push({ line: 1, message: 'frontmatter is not closed with a "---" line' });
    return { hasFrontmatter: true, data, errors, bodyStartLine: lines.length + 1 };
  }
  for (let i = 1; i < closed; i++) {
    const lineNo = i + 1;
    const line = lines[i].replace(/[ \t]+$/, '');
    if (line.trim() === '' || /^[ \t]*#/.test(line)) continue;
    if (/^[ \t]/.test(line)) {
      errors.push({ line: lineNo, message: 'indented lines (nested values) are not supported' });
      continue;
    }
    const m = KEY_LINE.exec(line);
    if (!m) {
      errors.push({ line: lineNo, message: 'expected "key: value"' });
      continue;
    }
    const key = m[1];
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      errors.push({ line: lineNo, message: `duplicate key "${key}"` });
      continue;
    }
    const v = parseValue(m[2]);
    if (v.error) {
      errors.push({ line: lineNo, message: `${key}: ${v.error}` });
      continue;
    }
    data[key] = v.value;
  }
  return { hasFrontmatter: true, data, errors, bodyStartLine: closed + 2 };
}

export function formatValue(value) {
  if (Array.isArray(value)) return `[${value.map((v) => formatValue(String(v))).join(', ')}]`;
  const s = String(value);
  if (/^[A-Za-z0-9][A-Za-z0-9 ._/()+-]*$/.test(s) && !/[ ]$/.test(s)) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`;
}

// Set or insert one top-level key, leaving every other line untouched.
export function setFrontmatterField(text, key, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const line = `${key}: ${formatValue(value)}`;
  if (lines[0].replace(/^\uFEFF/, '').trim() !== '---') {
    return ['---', line, '---', ...lines].join(eol);
  }
  let closed = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closed = i;
      break;
    }
  }
  if (closed < 0) throw new Error('frontmatter is not closed');
  const keyRe = new RegExp(`^${key.replace(/[-]/g, '\\-')}:([ \\t]|$)`);
  for (let i = 1; i < closed; i++) {
    if (keyRe.test(lines[i])) {
      lines[i] = line;
      return lines.join(eol);
    }
  }
  lines.splice(closed, 0, line);
  return lines.join(eol);
}
