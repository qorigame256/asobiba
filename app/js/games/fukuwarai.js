// 福笑い。顔の輪郭だけがうっすら見える所に、まゆ・目・鼻・口を1つずつ置いていく。置いた部品は見えない。正しい位置に近いほど高い点。
// 2〜10人・足りない分は CPU（弱め）。
// 2026-11-03 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 顔の輪郭だけうっすら見え、置いた部品は見えない。
//   - 部品は まゆ2・目2・鼻・口 の6つが1つずつ出て、全員いっしょに置く。正しい位置に近いほど高い点。最後に全員の顔を並べて見せる。
//   - 3回遊び、顔は毎回変える（おかめ・ひょっとこ・おに）。
// Claude の判断:
//   - 顔は 1000×1000 の中に描く。部品1つの点は、正しい位置からのずれ d で 10 − ⌊d ÷ 30⌋（0より下は0）。1回で最大60点。
//     ずれは整数の座標から Math.sqrt で数える（Math.hypot を使わない。端末で末尾がずれると同期が崩れるため。お絵描き当てと同じ）。
//   - 1回の時間は40秒。時間までに置けなかった部品は0点（置いた分だけ自動で送る）。全員が置き終えたら1秒で結果へ。結果を見せる間は8秒。
//   - 「左の目」などの左右は、画面を見ている人から見た左右。
//   - CPU は8〜20秒で置き終え、1つずつ正しい位置から上下左右に ±150 ほどずらす。
// 2026-11-04 の34回目の案（本人が選んだ。案の名前は「はじめに正しい顔を見せる」。分かれ目は Claude の判断）:
//   - 詳細設定「はじめに顔を見せる」（鍵は hint）: なし（最初）・あり。各回の始めの3秒だけ、部品の入った正しい顔（お手本）を見せ、そのあいだは置けない。
//     40秒はお手本を見せる時間も含めて数える（置ける時間は37秒）。各自の画面だけのことで、手と点の付け方は同じ。CPU も変えない。
//     手助けなので、おまかせで抽選しない（KEEP_KEYS の hint）。なしのときの局面は前と全く同じ形（rules は {}）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'put', q, pts: [[x, y] | null ×6] }

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar } from './party.js';
import { play } from '../sound.js';

const ROUNDS = 3;
const LIMIT = 40000;
const READY_MS = 3000;
const SHOWN_MS = 8000;
const GRACE_MS = 1000;
const PEEK_MS = 3000;
const LABELS = ['左のまゆ', '右のまゆ', '左の目', '右の目', '鼻', '口'];

// 部品の絵（x, y が真ん中）
const brow = (x, y, tilt = 0, w = 14) => `<path d="M${x - 55} ${y + 10 + tilt} Q${x} ${y - 25} ${x + 55} ${y + 10 - tilt}" stroke="#2b2420" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
const FACES = [
  {
    name: 'おかめ',
    back: '<path d="M170 420 Q190 110 500 100 Q810 110 830 420 Z" fill="#1f1a18"/><ellipse cx="500" cy="540" rx="330" ry="400" fill="#fff4e8" stroke="#c9a98a" stroke-width="8"/>',
    at: [[385, 330], [615, 330], [385, 440], [615, 440], [500, 560], [500, 690]],
    draw: [
      (x, y) => brow(x, y, 0, 10), (x, y) => brow(x, y, 0, 10),
      (x, y) => `<path d="M${x - 45} ${y} Q${x} ${y + 25} ${x + 45} ${y}" stroke="#2b2420" stroke-width="10" fill="none" stroke-linecap="round"/>`,
      (x, y) => `<path d="M${x - 45} ${y} Q${x} ${y + 25} ${x + 45} ${y}" stroke="#2b2420" stroke-width="10" fill="none" stroke-linecap="round"/>`,
      (x, y) => `<path d="M${x - 18} ${y + 22} Q${x} ${y - 40} ${x + 18} ${y + 22}" stroke="#b07a5a" stroke-width="8" fill="none" stroke-linecap="round"/>`,
      (x, y) => `<ellipse cx="${x}" cy="${y}" rx="32" ry="18" fill="#d8323a"/>`,
    ],
  },
  {
    name: 'ひょっとこ',
    back: '<ellipse cx="500" cy="530" rx="320" ry="410" fill="#f3d29c" stroke="#b98d4d" stroke-width="8"/><path d="M175 300 Q500 150 825 300 L815 360 Q500 220 185 360 Z" fill="#3c6fb5"/>',
    at: [[370, 400], [625, 380], [370, 480], [625, 465], [500, 590], [610, 720]],
    draw: [
      (x, y) => brow(x, y, -12), (x, y) => brow(x, y, 12),
      (x, y) => `<circle cx="${x}" cy="${y}" r="22" fill="#2b2420"/>`,
      (x, y) => `<circle cx="${x}" cy="${y}" r="42" fill="#fff" stroke="#2b2420" stroke-width="8"/><circle cx="${x + 8}" cy="${y}" r="20" fill="#2b2420"/>`,
      (x, y) => `<ellipse cx="${x}" cy="${y}" rx="30" ry="44" fill="#e6b77a" stroke="#a87b41" stroke-width="6"/>`,
      (x, y) => `<circle cx="${x}" cy="${y}" r="46" fill="#e58d86" stroke="#2b2420" stroke-width="9"/><circle cx="${x}" cy="${y}" r="18" fill="#5a1f1c"/>`,
    ],
  },
  {
    name: 'おに',
    back: '<path d="M300 260 L250 70 L400 210 Z M700 260 L750 70 L600 210 Z" fill="#f2c94c" stroke="#a8862a" stroke-width="6"/><ellipse cx="500" cy="540" rx="340" ry="400" fill="#e8604c" stroke="#a83a2a" stroke-width="8"/><path d="M190 380 Q230 180 500 170 Q770 180 810 380 Q700 270 500 270 Q300 270 190 380 Z" fill="#2b2420"/>',
    at: [[375, 400], [625, 400], [380, 480], [620, 480], [500, 590], [500, 730]],
    draw: [
      (x, y) => `<path d="M${x - 60} ${y - 22} L${x + 55} ${y + 18}" stroke="#2b2420" stroke-width="22" stroke-linecap="round"/>`,
      (x, y) => `<path d="M${x + 60} ${y - 22} L${x - 55} ${y + 18}" stroke="#2b2420" stroke-width="22" stroke-linecap="round"/>`,
      (x, y) => `<circle cx="${x}" cy="${y}" r="40" fill="#ffe66b" stroke="#2b2420" stroke-width="7"/><circle cx="${x}" cy="${y}" r="15" fill="#2b2420"/>`,
      (x, y) => `<circle cx="${x}" cy="${y}" r="40" fill="#ffe66b" stroke="#2b2420" stroke-width="7"/><circle cx="${x}" cy="${y}" r="15" fill="#2b2420"/>`,
      (x, y) => `<circle cx="${x}" cy="${y}" r="42" fill="#c94a3a" stroke="#7a2a1f" stroke-width="6"/>`,
      (x, y) => `<path d="M${x - 95} ${y - 15} Q${x} ${y + 70} ${x + 95} ${y - 15} Z" fill="#5a1f1c" stroke="#2b2420" stroke-width="7"/><path d="M${x - 60} ${y - 8} l15 34 l15 -30 Z M${x + 60} ${y - 8} l-15 34 l-15 -30 Z" fill="#fff"/>`,
    ],
  },
];

// 部品1つの点（ずれ d で 10 − ⌊d ÷ 30⌋）
export function partPoints(at, pt) {
  if (!pt) return 0;
  const dx = pt[0] - at[0], dy = pt[1] - at[1];
  return Math.max(0, 10 - Math.floor(Math.sqrt(dx * dx + dy * dy) / 30));
}
export const roundPoints = (face, pts) => face.at.reduce((a, at, i) => a + partPoints(at, pts?.[i]), 0);
export { FACES };

const qKey = (s, q = s.q) => `fukuwarai:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), put: s.put.slice() });
const okPt = (v) => v === null || (Array.isArray(v) && v.length === 2 && v.every((c) => Number.isInteger(c) && c >= 0 && c <= 1000));

// 顔の SVG（parts: 席ごとの置いた位置。null なら部品なし。faint: 輪郭を薄く）
function faceSvg(face, pts, { faint = false, cls = 'fw-face' } = {}) {
  const body = (pts ?? []).map((pt, i) => (pt ? face.draw[i](pt[0], pt[1]) : '')).join('');
  return `<svg class="${cls}" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg"><g opacity="${faint ? 0.22 : 1}">${face.back}</g>${body}</svg>`;
}

const cpuPlan = new Map();
let loc = null; // この端末で置いている途中 { key, pts, sent }

export default {
  id: 'fukuwarai',
  name: '福笑い',
  icon: '😆',
  desc: '見えない顔に、まゆ・目・鼻・口を置いていく。正しい位置に近いほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'hint', label: 'はじめに顔を見せる', desc: '各回の始めの3秒だけ、部品の入った正しい顔を見せる（おぼえてから置く）', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const faces = shuffle([0, 1, 2], mulberry32(seed)).slice(0, ROUNDS);
    return { n, seed, rules: rules.hint === true ? { hint: true } : {}, faces, q: -1, phase: 'ready', put: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : m.t === 'close' ? 'pop' : null;
    return null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `第${s.q + 1}回 / ${s.faces.length}・${FACES[s.faces[s.q]].name}`;
    return `第${s.q + 1}回の結果`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.put.every((x) => x)) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: LIMIT + GRACE_MS + 500, move: { t: 'close' } };
    }
    if (s.phase === 'shown') return { key: 'shown' + s.q, ms: SHOWN_MS, move: { t: 'next' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'next' && (s0.phase === 'ready' || s0.phase === 'shown')) {
        const s = clone(s0);
        s.step += 1;
        if (s.q + 1 >= s.faces.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.put = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const face = FACES[s.faces[s.q]];
        const got = s.put.map((pts) => roundPoints(face, pts));
        got.forEach((v, p) => { s.scores[p] += v; });
        s.last = { got };
        s.log = [...s0.log, { put: s.put.slice(), got }];
        return s;
      }
      return null;
    }
    if (m.t !== 'put' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.put[m.p]) return null;
    if (!Array.isArray(m.pts) || m.pts.length !== LABELS.length || !m.pts.every(okPt)) return null;
    const s = clone(s0);
    s.step += 1;
    s.put[m.p] = m.pts.map((v) => (v ? v.slice() : null));
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 400 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.put[p]) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const off = () => Math.round((Math.random() + Math.random() + Math.random() - 1.5) * 200);
      const clamp = (v) => Math.max(0, Math.min(1000, v));
      plan = { at: 8000 + Math.random() * 12000, pts: FACES[s.faces[s.q]].at.map(([x, y]) => [clamp(x + off()), clamp(y + off())]) };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    return since(qKey(s)) >= plan.at ? { t: 'put', q: s.q, pts: plan.pts } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.put[p] ? '<span class="pt-ok">置いた</span>' : '';
      if (s.phase === 'shown' && s.last) return `<span class="pt-ok">+${s.last.got[p]}</span>`;
      return '';
    };
    root.innerHTML = '';
    root.className = 'board kj fw';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">まゆ・目・鼻・口を1つずつ置こう。置いた部品は見えません・全${s.faces.length}回</div>`;
      return;
    }
    const face = FACES[s.faces[s.q]];
    const key = qKey(s);
    card.innerHTML = `<div class="kj-num">第${s.q + 1}回 / ${s.faces.length}</div><div class="fw-name">${esc(face.name)}</div>`;

    if (s.phase === 'shown') {
      const grid = document.createElement('div');
      grid.className = 'fw-grid';
      const top = Math.max(...s.last.got);
      s.put.forEach((pts, p) => {
        const cell = document.createElement('div');
        cell.className = 'fw-cell' + (s.last.got[p] === top ? ' top' : '') + (p === me ? ' me' : '');
        cell.innerHTML = faceSvg(face, pts ?? []);
        const cap = document.createElement('div');
        cap.className = 'fw-cap';
        cap.textContent = `${p === me ? 'あなた' : o.names[p]}　${s.last.got[p]}点`;
        cell.append(cap);
        grid.append(cell);
      });
      const ans = document.createElement('div');
      ans.className = 'fw-cell ans';
      ans.innerHTML = faceSvg(face, face.at) + '<div class="fw-cap">お手本</div>';
      grid.append(ans);
      wrap.append(grid);
      return;
    }

    since(key);
    card.append(timeBar(key, LIMIT, { secs: true }));
    if (loc?.key !== key) loc = { key, pts: [], sent: false };
    const playing = me !== null && o.canMove && !s.put[me] && !loc.sent;
    const next = document.createElement('div');
    next.className = 'fw-next';
    const board = document.createElement('div');
    board.className = 'fw-board';
    const peekLeft = () => (s.rules.hint === true ? PEEK_MS - since(key) : 0); // お手本を見せる残り
    board.innerHTML = peekLeft() > 0 ? faceSvg(face, face.at) : faceSvg(face, [], { faint: true });
    const note = document.createElement('p');
    note.className = 'cc-log';
    const send = () => {
      if (loc.sent) return;
      loc.sent = true;
      const pts = LABELS.map((_, i) => loc.pts[i] ?? null);
      o.onMove({ t: 'put', q: s.q, pts });
    };
    const paint = () => {
      const i = loc.pts.length;
      if (me === null) { next.textContent = '観戦中'; return; }
      if (s.put[me] || loc.sent) { next.textContent = '置き終えました。ほかの人を待っています'; return; }
      if (peekLeft() > 0) { next.textContent = '👀 正しい顔をおぼえよう（3秒）'; return; }
      next.innerHTML = `つぎは <b>${LABELS[i]}</b>（${i + 1}/${LABELS.length}）`;
      const prev = document.createElement('span');
      prev.className = 'fw-prev';
      prev.innerHTML = `<svg viewBox="0 0 200 200">${face.draw[i](100, 100)}</svg>`;
      next.prepend(prev);
    };
    if (playing) {
      board.addEventListener('pointerdown', (e) => {
        if (loc.sent || loc.pts.length >= LABELS.length || peekLeft() > 0) return;
        e.preventDefault();
        const r = board.getBoundingClientRect();
        const x = Math.round(((e.clientX - r.left) / r.width) * 1000), y = Math.round(((e.clientY - r.top) / r.height) * 1000);
        if (x < 0 || y < 0 || x > 1000 || y > 1000) return;
        loc.pts.push([x, y]);
        play('place', 0.5);
        board.classList.remove('pop');
        void board.offsetWidth; // 押したことが分かるよう、少しだけ揺らす（部品は見せない）
        board.classList.add('pop');
        if (loc.pts.length >= LABELS.length) send();
        paint();
      });
      setTimeout(() => { if (board.isConnected && !loc.sent && loc.key === key) send(); }, Math.max(0, LIMIT - since(key) - 200)); // 時間までに置けた分だけ送る
      note.textContent = '顔のどこかを押すと、その場所に置きます（置いた部品は見えません）';
    }
    if (peekLeft() > 0) {
      setTimeout(() => {
        if (!board.isConnected) return;
        board.innerHTML = faceSvg(face, [], { faint: true });
        paint();
      }, peekLeft() + 20);
    }
    paint();
    wrap.append(next, board, note);
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const face = FACES[s.faces[q]];
      const li = document.createElement('li');
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span class="mk-rv-nums">${esc(face.name)}</span>`
        + (me === null ? '' : `<span class="fw-mini">${faceSvg(face, x.put[me] ?? [], { cls: 'fw-face mini' })}</span><span>あなた ${x.got[me]}点</span>`);
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
