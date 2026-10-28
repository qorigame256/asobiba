// ことわざかるた。ことわざの前半を読み上げ（と文字）で出し、場に並んだ札（後半）から合う札を一番早く押した人がその札を取る。
// 2026-10-28 本人の決定（Claude が出した案から本人が選んだ。分かれ目は Claude の推奨を本人が承認）:
//   場に札を8枚並べ、1回の対局は札15枚。お手つき（ちがう札を押す）は、その問題で押せなくなるだけで点は減らない。
//   前半は読み上げに合わせて文字も1文字ずつ出す（声は端末ごとに違い、音を消している人もいるため）。
// Claude の判断:
//   - 速さは各自の画面で前半が出てから押すまで（ms）で比べる（難読漢字と同じ）。最初の正解から1.5秒待って締め切り、いちばん速い人が取る。
//   - 札は取られても取られなくても（だれも押さず時間切れでも）場から抜け、山から1枚足す。読む順と場の並びは種から前もって決めておく（apply が乱数を使わないように）。
//   - 詳細設定: 札の数（10・15・20枚）・読み上げ（あり・なし）。読み上げは 🔇 のときも鳴らない。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open →（正解が出たら1.5秒 / 全員済み0.8秒 / 制限時間）→ close → shown → next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'take', q: 何問目, c: 押した札の番号, ms }

import { mulberry32, shuffle, esc } from './util.js';
import { KOTOWAZA } from './karuta-data.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { speak } from '../sound.js';

const FIELD = 8;
const CHAR_MS = 220; // 前半の文字を1文字ずつ出す間
const READY_MS = 3000;
const SHOWN_MS = 3200;
const AFTER_MS = 1500; // 最初の正解から締め切るまで（もっと速い人の手が遅れて届くのを待つ）
const GRACE_MS = 800;
const OPEN_MS = 12000; // 前半が出きってからの時間
const CARDS = [[10, '10枚'], [15, '15枚'], [20, '20枚']];

const countOf = (r) => (CARDS.some(([v]) => v === r.rounds) ? r.rounds : 15);
const limitOf = (s, q = s.q) => KOTOWAZA[s.reads[q]][0].length * CHAR_MS + OPEN_MS;
const qKey = (s, q = s.q) => `karuta:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), got: s.got.slice(), miss: s.miss.slice() });
const doneOf = (s, p) => s.got[p] !== null || s.miss[p];

// 読む順と、各問の場の札（8枚）。札は読まれたら抜け、山の次の札が同じ場所に入る
// 山には読む札の数より7枚多く入れ、最後の札まで場が8枚のままにする（読まれない札も混ざる。前は読む札だけで、
// 後半は場が7枚・6枚…と減り、最後は残った1枚を押すだけになった。2026-10-28 Codex の点検の指摘）
export function deal(seed, count) {
  const rnd = mulberry32(seed);
  const deck = shuffle([...KOTOWAZA.keys()], rnd).slice(0, count + FIELD - 1);
  const field = deck.slice(0, FIELD);
  const pile = deck.slice(FIELD);
  const reads = [], fields = [];
  for (let q = 0; q < count; q++) {
    const live = field.filter((c) => c !== null);
    const c = live[Math.floor(rnd() * live.length)];
    reads.push(c);
    fields.push(field.slice());
    field[field.indexOf(c)] = pile.length ? pile.shift() : null;
  }
  return { reads, fields };
}

let cpuPlan = new Map();
let spoken = null;

export default {
  id: 'karuta',
  name: 'ことわざかるた',
  icon: '📜',
  desc: 'ことわざの前半を聞いて、後半の札を早取り',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: '札の数', desc: '1回の対局で読む札の数', def: 15, choices: CARDS },
    { key: 'voice', label: '読み上げ', desc: 'ことわざの前半を声でも読む（🔇 のときは読まない）', def: true },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 15, voice: true, ...rules };
    const { reads, fields } = deal(seed, countOf(r));
    return {
      n, seed, rules: r, reads, fields, q: -1, phase: 'ready',
      got: Array(n).fill(null), miss: Array(n).fill(false), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && !doneOf(s, p); },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : b.last?.taker === me ? 'correct' : 'pop';
    if (m.p !== me) return null;
    return b.got[me] !== null ? 'correct' : 'wrong';
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `${s.q + 1}枚目 / ${s.reads.length}`;
    return `${s.q + 1}枚目の答え`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      if (s.got.some((v) => v !== null)) return { key: 'got' + s.q, ms: AFTER_MS, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: limitOf(s) + GRACE_MS, move: { t: 'close' } };
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
        if (s.q + 1 >= s.reads.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.got = Array(s.n).fill(null);
        s.miss = Array(s.n).fill(false);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const times = s.got.filter((v) => v !== null);
        const best = times.length ? Math.min(...times) : null;
        const taker = best === null ? null : s.got.indexOf(best); // 同じ速さなら席の番号の小さい人（ms は整数なのでまず無い）
        if (taker !== null) s.scores[taker] += 1;
        s.last = { taker, best };
        s.log = [...s0.log, { taker, miss: s.miss.slice() }];
        return s;
      }
      return null;
    }
    if (s0.phase !== 'open' || m.t !== 'take' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (!s0.fields[s0.q].includes(m.c) || m.c === null) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > limitOf(s0) + 500) return null;
    const s = clone(s0);
    s.step += 1;
    if (m.c === s0.reads[s0.q]) s.got[m.p] = Math.round(m.ms);
    else s.miss[m.p] = true;
    return s;
  },

  // CPU: 前半が出きってから1.2〜5.2秒のあいだに押す（人が札を探す間をあける）。1割はお手つき
  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    const full = KOTOWAZA[s.reads[s.q]][0].length * CHAR_MS;
    if (!plan) {
      plan = { at: full + 1200 + Math.random() * 4000, ok: Math.random() < 0.9, done: false };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    if (plan.done || t < plan.at) return null;
    plan.done = true;
    const wrong = s.fields[s.q].filter((c) => c !== null && c !== s.reads[s.q]);
    const c = plan.ok || !wrong.length ? s.reads[s.q] : wrong[Math.floor(Math.random() * wrong.length)];
    return { t: 'take', q: s.q, c, ms: Math.round(t) };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.got[p] !== null ? '<span class="pt-ok">押した！</span>' : s.miss[p] ? '<span class="pt-ng">お手つき</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.last.taker === p) return `<span class="pt-ok">🎴 ${secText(s.last.best)}</span>`;
      return s.miss[p] ? '<span class="pt-ng">お手つき</span>' : '';
    };
    root.innerHTML = '';
    root.className = 'board kj kr';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }

    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">札 ${s.reads.length}枚。前半を聞いて、後半の札を早く押そう</div>`;
      return;
    }
    const key = qKey(s);
    const [top, bottom, yomi] = KOTOWAZA[s.reads[s.q]];
    card.innerHTML = `<div class="kj-num">${s.q + 1}枚目 / ${s.reads.length}</div>`;
    const line = document.createElement('div');
    line.className = 'kr-top';
    card.append(line);
    if (s.phase === 'open') {
      since(key);
      if (s.rules.voice && spoken !== key) { spoken = key; speak(yomi, 'karuta'); }
      // 前半を1文字ずつ（描き直しても、画面に出てからの時間で同じところから続く）
      const tick = () => {
        if (!line.isConnected && line.dataset.on) return;
        line.dataset.on = '1';
        const k = Math.min(top.length, Math.floor(since(key) / CHAR_MS) + 1);
        line.textContent = top.slice(0, k) + (k < top.length ? '…' : '');
        if (k < top.length) requestAnimationFrame(tick);
      };
      tick();
      card.append(timeBar(key, limitOf(s)));
    } else {
      line.textContent = top;
      const ans = document.createElement('div');
      ans.className = 'kj-answer';
      ans.textContent = `${top}${bottom}`;
      card.append(ans);
      const who = document.createElement('div');
      who.className = 'kj-sub';
      who.textContent = s.last.taker === null ? 'だれも取れませんでした' : `${s.last.taker === me ? 'あなた' : o.names[s.last.taker]}が取った！`;
      card.append(who);
    }

    // 場の札
    const grid = document.createElement('div');
    grid.className = 'kr-field';
    const mine = me !== null && s.phase === 'open' && !doneOf(s, me) && o.canMove;
    for (const c of s.fields[s.q]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'kr-card';
      if (c === null) { b.classList.add('empty'); b.disabled = true; grid.append(b); continue; }
      b.textContent = KOTOWAZA[c][1];
      if (s.phase === 'shown' && c === s.reads[s.q]) b.classList.add('hit');
      b.disabled = !mine;
      // 押した瞬間に取る（pointerdown）。CPU を待つ間ホストの画面は何度も描き直されるので、click だと押して離す間に札が作り直されて押せないことがあった
      // （2026-10-28 Codex の点検の指摘）。キーボード用に click も残し、2回目は disabled で弾く
      b.onpointerdown = (e) => { e.preventDefault(); take(); };
      b.onclick = (e) => { if (e.detail === 0) take(); };
      const take = () => {
        if (b.disabled) return;
        const ms = Math.round(since(key));
        if (ms >= limitOf(s)) return;
        grid.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        b.classList.add(c === s.reads[s.q] ? 'hit' : 'miss');
        o.onMove({ t: 'take', q: s.q, c, ms });
      };
      grid.append(b);
    }
    wrap.append(grid);
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (s.phase === 'open') {
      if (me === null) note.textContent = '観戦中';
      else if (s.got[me] !== null) note.textContent = `押した！（${secText(s.got[me])}）ほかの人より速ければあなたの札`;
      else if (s.miss[me]) note.textContent = 'お手つき！ この札はもう押せません';
      else note.textContent = '前半に合う後半の札を押そう';
    }
    wrap.append(note);
  },

  // ふりかえり: 読んだことわざと、取った人
  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const mineN = me === null ? 0 : s.log.filter((x) => x.taker === me).length;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}枚${me !== null ? `・あなたが取った札 ${mineN}枚` : ''}）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const [top, bottom] = KOTOWAZA[s.reads[q]];
      const li = document.createElement('li');
      const who = x.taker === null ? '―' : x.taker === me ? 'あなた' : o.names?.[x.taker] ?? '';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span class="mk-rv-ex">${esc(top)}<b>${esc(bottom)}</b></span><span class="mk-rv-who">🎴${esc(who)}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
