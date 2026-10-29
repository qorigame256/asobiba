// 色ちがい早押し。色の名前の字（「赤」など）が別の色で出るので、4つの色のボタンから「字の色」を押す。2〜10人・足りない分は CPU。
// 2026-10-29 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 4つの色のボタンから「字の色」を押す。
//   - 10問。正解した速い順に 3・2・1点。まちがえたらその問題はもう押せないが、点は減らない。
//   - 詳細設定「あまのじゃく」（なし（最初）・あり）: ときどき「字の意味のほうを答えて」の問題が混じる。
// Claude の判断:
//   - 色は 赤・青・黄・緑 の4つ。字と色はいつもちがう組み合わせ。ボタンの並びは毎回同じ（並びが変わると色を探す時間の勝負になるため）。
//   - あまのじゃくありでは、10問のうち3問（種から選ぶ）に「👿 字の意味を答えて！」の印を付ける。
//   - 1問の制限時間は5秒。全員が答えたら0.8秒で締め切る。結果を見せる間は2秒。速さは各自の画面に字が出てから押すまで。
//   - CPU は0.7〜1.6秒で押し、85%（あまのじゃくの問題は70%）当てる。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: 色の番号, ms }

import { mulberry32, shuffle } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { pointsOf } from './make10.js';

export const COLORS = [['赤', '#e04b3c', 'あか'], ['青', '#2f6fb3', 'あお'], ['黄', '#e8a913', 'きいろ'], ['緑', '#3a9d55', 'みどり']];
const ROUNDS = 10;
const REV = 3;
const LIMIT = 5000;
const READY_MS = 3000;
const SHOWN_MS = 2000;
const GRACE_MS = 800;

const qKey = (s, q = s.q) => `iroji:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];
export const answerOf = (x) => (x.rev ? x.word : x.ink);
const cpuPlan = new Map();

export default {
  id: 'iroji',
  name: '色ちがい早押し',
  icon: '🎨',
  desc: '「赤」が青い字で出たら「青」。字の色を早く押すほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'rev', label: 'あまのじゃく', desc: 'ときどき「字の意味のほう」を答える問題が混じる', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rev: false, ...rules };
    const rnd = mulberry32(seed);
    const qs = Array.from({ length: ROUNDS }, () => {
      const word = Math.floor(rnd() * 4);
      const ink = (word + 1 + Math.floor(rnd() * 3)) % 4;
      return { word, ink, rev: false };
    });
    if (r.rev) for (const q of shuffle([...Array(ROUNDS).keys()].slice(1), rnd).slice(0, REV)) qs[q].rev = true; // 1問目はふつう
    return {
      n, seed, rules: r, qs, q: -1, phase: 'ready',
      solved: Array(n).fill(null), miss: Array(n).fill(false), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : null;
    if (m.p !== me) return null; // ほかの人が押した音は鳴らさない（旗揚げと同じ。にぎやかすぎるため）
    return b.solved[me] !== null ? 'correct' : 'wrong';
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `第${s.q + 1}問 / ${s.qs.length}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: LIMIT + 1000, move: { t: 'close' } };
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
        if (s.q + 1 >= s.qs.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.solved = Array(s.n).fill(null);
        s.miss = Array(s.n).fill(false);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pts = pointsOf(s.solved);
        pts.forEach((v, p) => { s.scores[p] += v; });
        const best = Math.min(...s.solved.filter((v) => v !== null));
        const winners = s.solved.map((v, p) => (v !== null && v === best ? p : -1)).filter((p) => p >= 0);
        s.last = { pts, winners };
        s.log = [...s0.log, { solved: s.solved.slice(), miss: s.miss.slice(), winners }];
        return s;
      }
      return null;
    }
    if (m.t !== 'ans' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (!Number.isInteger(m.c) || m.c < 0 || m.c > 3 || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > LIMIT + 300) return null;
    const s = clone(s0);
    s.step += 1;
    if (m.c === answerOf(s.qs[s.q])) s.solved[m.p] = Math.round(m.ms);
    else s.miss[m.p] = true;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 150 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const x = s.qs[s.q];
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const ok = Math.random() < (x.rev ? 0.7 : 0.85);
      plan = { at: 700 + Math.random() * 900, c: ok ? answerOf(x) : [0, 1, 2, 3].filter((c) => c !== answerOf(x))[Math.floor(Math.random() * 3)] };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at ? { t: 'ans', q: s.q, c: plan.c, ms: Math.round(t) } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return doneOf(s, p) ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return s.miss[p] ? '<span class="pt-ng">×</span>' : '<span class="pt-ng">―</span>';
    };
    root.innerHTML = '';
    root.className = 'board kj ir';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">字の「色」を押そう・全${s.qs.length}問${s.rules.rev ? '・👿 の問題は字の「意味」' : ''}</div>`;
      return;
    }
    const x = s.qs[s.q];
    const key = qKey(s);
    card.insertAdjacentHTML('beforeend', `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div>`
      + `<div class="ir-ask${x.rev ? ' rev' : ''}">${x.rev ? '👿 字の「意味」を答えて！' : '字の「色」はどれ？'}</div>`);
    const word = document.createElement('div');
    word.className = 'ir-word';
    word.textContent = COLORS[x.word][0];
    word.style.color = COLORS[x.ink][1];
    card.append(word);
    if (s.phase === 'open') { since(key); card.append(timeBar(key, LIMIT)); }
    else {
      const ans = COLORS[answerOf(x)];
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = `正解は「${ans[0]}」${fast ? `・いちばん速かったのは ${fast}` : '・だれも正解できませんでした'}`;
      card.append(t);
    }
    const can = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < LIMIT;
    const pad = document.createElement('div');
    pad.className = 'ir-pad';
    COLORS.forEach(([name, col], c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ir-btn' + (s.phase === 'shown' && c === answerOf(x) ? ' ans' : '');
      b.style.background = col;
      b.textContent = name;
      b.disabled = !can;
      const hit = (e) => {
        if (!can || b.dataset.sent) return;
        e.preventDefault();
        const ms = Math.round(since(key));
        if (ms >= LIMIT) return;
        pad.querySelectorAll('button').forEach((y) => { y.disabled = true; y.dataset.sent = '1'; });
        o.onMove({ t: 'ans', q: s.q, c, ms });
      };
      b.onpointerdown = hit; // 押した瞬間に測る（指を離すまで待たない）
      b.onclick = hit; // キーボードで押したとき
      pad.append(b);
    });
    wrap.append(pad);
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (s.phase === 'open' && s.solved[me] !== null) note.textContent = `⭕ 正解！（${secText(s.solved[me])}）`;
    else if (s.phase === 'open' && s.miss[me]) note.textContent = '❌ ざんねん。次の問題を待とう';
    wrap.append(note);
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}問）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const qq = s.qs[q];
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span><b style="color:${COLORS[qq.ink][1]}">${COLORS[qq.word][0]}</b>${qq.rev ? '👿' : ''}</span><span>${mine}</span>`;
      const who = document.createElement('span');
      who.className = 'mk-rv-who';
      who.textContent = fast.length ? '⚡' + fast.join('・') : '―';
      li.append(who);
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
