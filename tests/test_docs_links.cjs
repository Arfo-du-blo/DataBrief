#!/usr/bin/env node
/* The relative links and the #anchors of README.md and docs/**/*.md all point somewhere (GitHub's heading slugs).   node tests/test_docs_links.cjs */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const files = ['README.md'];
const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) walk(p); else if (/\.md$/.test(e.name)) files.push(p); } };
walk('docs');
const slug = (h) => h.trim().toLowerCase().replace(/<[^>]*>/g, '').replace(/[`*_~]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
const anchors = new Map();
const anchorsOf = (f) => {
  if (anchors.has(f)) return anchors.get(f);
  const set = new Set(), seen = {};
  let fence = false;
  for (const line of fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/)) {
    if (/^```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!m) continue;
    let s = slug(m[2]); const n = seen[s] || 0; seen[s] = n + 1; if (n) s += '-' + n;
    set.add(s);
  }
  anchors.set(f, set); return set;
};
let bad = 0, total = 0;
for (const f of files) {
  let fence = false;
  fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (/^```/.test(line)) { fence = !fence; return; }
    if (fence) return;
    for (const m of line.replace(/`[^`]*`/g, '').matchAll(/\]\(([^)\s]+)\)/g)) {
      const url = m[1];
      if (/^(https?:|mailto:)/.test(url)) continue;
      total++;
      const [p, a] = url.split('#');
      const target = p ? path.posix.normalize(path.posix.join(path.posix.dirname(f), p)) : f;
      if (!fs.existsSync(path.join(ROOT, target))) { console.log(f + ':' + (i + 1) + ' missing file ' + url); bad++; continue; }
      if (a && /\.md$/.test(target) && !anchorsOf(target).has(a)) { console.log(f + ':' + (i + 1) + ' missing anchor ' + url); bad++; }
    }
  });
}
console.log(total + ' links checked, ' + bad + ' problems');
process.exit(bad ? 1 : 0);
