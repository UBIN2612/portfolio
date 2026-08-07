#!/usr/bin/env node
/* case-studies/*.md -> *.html  (본문과 일관된 딥다이브 페이지, 외부 CDN 0) */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;

const KICK = { '01':'① 장애 진단', '02':'② 인증 설계', '03':'③ 신뢰성', '04':'④ 워크플로' };
const SHORT = {
  '01':'① 수면이 만든 가짜 장애',
  '02':'② 봇으로 안 몰리고 세션 지키기',
  '03':'③ 스크래퍼가 맞는지 아는 법',
  '04':'④ 혼자 9만 줄 운영하는 법',
};
const FILES = {
  '01':'01-sleep-guard-장애진단',
  '02':'02-antibot-인증자동복구',
  '03':'03-정확성감사-eval하네스',
  '04':'04-ai-native-워크플로',
};

// 코드 스팬 보호용 토큰 — 사설영역(PUA) 문자라 본문에 절대 없음, escapeHtml 도 안 건드림
const OPEN = String.fromCharCode(0xE000);
const CLOSE = String.fromCharCode(0xE001);
const RESTORE = new RegExp(OPEN + '(\\d+)' + CLOSE, 'g');

function escapeHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function inline(text){
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, function(_m, c){ codes.push(c); return OPEN + (codes.length-1) + CLOSE; });
  s = escapeHtml(s);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // 이탤릭: 단어경계에서만(내부 밑줄 식별자·경로는 그대로; 경로는 위에서 code 로 보호됨)
  s = s.replace(/(^|[\s(])_(?=\S)([^_]+?)_(?=[\s.,;:!?)\]]|$)/g, '$1<em>$2</em>');
  s = s.replace(RESTORE, function(_m, idx){ return '<code>' + escapeHtml(codes[+idx]) + '</code>'; });
  return s;
}

function splitRow(line){
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0,-1);
  return t.split('|').map(function(c){ return c.trim(); });
}
function isBlockStart(l){
  const t = l.trimStart();
  return /^#{1,4}\s/.test(t) || t === '---' || t.startsWith('```') ||
         t.startsWith('>') || /^[-*]\s+/.test(t) || /^\d+\.\s+/.test(t) || t.startsWith('|');
}

function mdToHtml(md){
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length){
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    if (line.trimStart().startsWith('```')){
      i++; const buf = [];
      while (i < lines.length && !lines[i].trimStart().startsWith('```')){ buf.push(lines[i]); i++; }
      i++;
      out.push('<pre class="code"><code>' + escapeHtml(buf.join('\n')) + '</code></pre>');
      continue;
    }
    if (line.trim() === '---'){ out.push('<hr>'); i++; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h){ const lv = h[1].length; out.push('<h'+lv+'>' + inline(h[2].trim()) + '</h'+lv+'>'); i++; continue; }
    if (line.trim().startsWith('|') && i+1 < lines.length &&
        /-/.test(lines[i+1]) && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i+1])){
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')){ rows.push(splitRow(lines[i])); i++; }
      const thead = '<thead><tr>' + header.map(function(c){ return '<th>'+inline(c)+'</th>'; }).join('') + '</tr></thead>';
      const tbody = '<tbody>' + rows.map(function(r){ return '<tr>'+r.map(function(c){ return '<td>'+inline(c)+'</td>'; }).join('')+'</tr>'; }).join('') + '</tbody>';
      out.push('<div class="tbl"><table>' + thead + tbody + '</table></div>');
      continue;
    }
    if (line.trimStart().startsWith('>')){
      const buf = [];
      while (i < lines.length && lines[i].trimStart().startsWith('>')){ buf.push(lines[i].replace(/^\s*>\s?/,'')); i++; }
      // 줄바꿈으로 감싼 한 문단 콜아웃 — 먼저 이어붙인 뒤 inline 1회(줄 넘는 **bold** 보존)
      out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)){
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])){
        let item = lines[i].replace(/^\s*[-*]\s+/, ''); i++;
        while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])){ item += ' ' + lines[i].trim(); i++; }
        items.push(item);
      }
      out.push('<ul>' + items.map(function(it){ return '<li>'+inline(it)+'</li>'; }).join('') + '</ul>');
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)){
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])){
        let item = lines[i].replace(/^\s*\d+\.\s+/, ''); i++;
        while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])){ item += ' ' + lines[i].trim(); i++; }
        items.push(item);
      }
      out.push('<ol>' + items.map(function(it){ return '<li>'+inline(it)+'</li>'; }).join('') + '</ol>');
      continue;
    }
    const buf = [line]; i++;
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])){ buf.push(lines[i]); i++; }
    out.push('<p>' + inline(buf.join(' ')) + '</p>');
  }
  return out.join('\n');
}

function parse(md){
  const lines = md.split('\n');
  const ti = lines.findIndex(function(l){ return /^#\s+/.test(l); });
  const title = lines[ti].replace(/^#\s+/, '').trim();
  let j = ti + 1;
  while (j < lines.length && lines[j].trim() === '') j++;
  const meta = [];
  while (j < lines.length && lines[j].trimStart().startsWith('>')){ meta.push(lines[j].replace(/^\s*>\s?/,'').trim()); j++; }
  const body = lines.slice(j).join('\n');
  return { title: title, meta: meta, body: body };
}

function footerNav(curKey){
  return Object.keys(FILES).map(function(k){
    const href = k === curKey ? '#' : (FILES[k] + '.html');
    const cur = k === curKey ? ' aria-current="page"' : '';
    return '<a href="' + href + '"' + cur + '>' + SHORT[k] + '</a>';
  }).join('\n      ');
}

function page(key, parsed){
  const bodyHtml = mdToHtml(parsed.body);
  const kicker = KICK[key];
  const provParts = parsed.meta.slice();
  if (provParts[0]) provParts[0] = provParts[0].replace(/^케이스 스터디\s*[①②③④⑤⑥]\s*·\s*/, '');
  const prov = provParts.map(inline).join('&nbsp;&nbsp;·&nbsp;&nbsp;');
  const plainTitle = parsed.title.replace(/[`*_]/g,'');
  return '<!DOCTYPE html>\n<html lang="ko">\n<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'<title>' + escapeHtml(plainTitle) + ' — 황유빈 케이스 스터디</title>\n' +
'<meta name="description" content="' + escapeHtml(plainTitle) + ' — K-pop 이벤트 스크래퍼 케이스 스터디. 모든 수치·커밋은 저장소에서 재확인.">\n' +
'<link rel="icon" type="image/svg+xml" href="../assets/favicon.svg">\n' +
'<link rel="stylesheet" href="case.css">\n' +
'</head>\n<body>\n' +
'<div class="rail" aria-hidden="true"></div>\n' +
'<div class="topbar">\n' +
'  <a class="back" href="../index.html#deep-dives"><span class="ar">←</span> 포트폴리오</a>\n' +
'  <span class="brand"><img src="../assets/favicon.svg" alt="">HWANG YUBIN · DEEP DIVE</span>\n' +
'</div>\n\n' +
'<header class="cs-head"><div class="wrap">\n' +
'  <div class="cs-kicker">케이스 스터디 · ' + kicker + '</div>\n' +
'  <h1>' + inline(parsed.title) + '</h1>\n' +
'  <p class="cs-prov">' + prov + '</p>\n' +
'</div></header>\n\n' +
'<main><article class="wrap">\n' + bodyHtml + '\n</article></main>\n\n' +
'<footer>\n  <div class="wrap">\n' +
'    <nav class="nav-dives" aria-label="다른 케이스 스터디">\n      ' + footerNav(key) + '\n    </nav>\n' +
'    <a class="back" href="../index.html#deep-dives"><span class="ar">←</span> 포트폴리오로 돌아가기</a>\n' +
'    <p class="copy" style="margin-top:18px">© 2026 HWANG YUBIN — BUILT BY HAND, RUN IN PRODUCTION</p>\n' +
'  </div>\n</footer>\n\n' +
'<script>\n(function(){\n  var rail=document.querySelector(".rail");\n' +
'  addEventListener("scroll",function(){\n    var h=document.documentElement;\n' +
'    rail.style.width=(h.scrollTop/(h.scrollHeight-h.clientHeight)*100||0)+"%";\n  },{passive:true});\n})();\n</script>\n' +
'</body>\n</html>\n';
}

const built = [];
for (const key of Object.keys(FILES)){
  const md = fs.readFileSync(path.join(DIR, FILES[key] + '.md'), 'utf8');
  const parsed = parse(md);
  const html = page(key, parsed);
  const nulls = (html.match(new RegExp('[' + OPEN + CLOSE + '\\x00]', 'g')) || []).length;
  fs.writeFileSync(path.join(DIR, FILES[key] + '.html'), html);
  built.push(FILES[key] + '.html  (' + html.length + 'B, 잔여토큰=' + nulls + ')');
}
console.log('BUILT:\n' + built.join('\n'));
