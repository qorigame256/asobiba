// 大喜利。お題に全員が答えを書き、名前を隠して並べた答えに自分以外へ1票入れる。1票1点。3〜10人・CPU は入れない。
// 2026-11-03 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - CPU は入れない（CPU に面白い答えは作れないため。お絵描き当てと同じ）。お題は Claude が書いた一覧（oogiri-data.js）からくじで選ぶ。
//   - 答えを書く時間は60秒。名前を隠して答えを並べ、自分以外の答えに1票。1票1点。結果のときに名前を出す。
//   - 回数は 5回（最初）・3回・8回（詳細設定）。自由に打つ言葉なので、汚い言葉のふるいを通す（main.js の FREE_TEXT と filter.js の shown）。
// Claude の判断:
//   - 答えは1回だけ送れる（40字まで）。全員が書いたら1秒で投票へ。書かなかった人の答えは並ばないが、投票はできる。
//   - 投票は30秒。全員が入れたら1秒で結果へ。結果を見せる間は7秒。答えの並びは種と回から決めるので全員同じ。
//   - 答えが1つも無い回は、投票をとばして結果へ（だれも点なし）。
//   - 部屋を出た人の席は、書く場面では何もせず、投票では自分以外の答えにくじで入れる（noCpu のゲームで cpu() が動くのは部屋を出た人の席だけ）。
// 詳細設定「審査員が選ぶ」（2026-11-03 の33回目の案。分かれ目は Claude の推奨を本人が承認）:
//   - 席順に1人ずつ審査員になり、回数の設定は使わず全員が1回ずつ審査員になったら終わり（審査員の回は点が取れないので、回数がずれると不公平になるため）。
//   - 審査員は答えを書かず、並んだ答えから1つ選ぶ。選ばれた答えに1点（1票1点と同じ重み）。
//   Claude の判断: 審査員の回の席は q % 人数。選ぶ時間は投票と同じ30秒で、選ばなかったらだれも点なし。審査員が部屋を出た人の席ならくじで選ぶ。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → write → close → vote → tally → shown → next …
// 手: { p: -1, t: 'next' | 'close' | 'tally' } / { p, t: 'ans', q, text } / { p, t: 'vote', q, to: 答えた人の席 }

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar } from './party.js';
import { shown as filterShown } from '../filter.js';
import { OOGIRI } from './oogiri-data.js';

const ROUNDS = [[3, '3回'], [5, '5回'], [8, '8回']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 5);
// 審査員の席（審査員が選ぶ でなければ null）
export const judgeOf = (s, q = s.q) => (s.rules.judge ? q % s.n : null);
const MAX_TEXT = 40;
const WRITE_MS = 60000;
const VOTE_MS = 30000;
const READY_MS = 3000;
const SHOWN_MS = 7000;
const GRACE_MS = 1000;

const qKey = (s, q = s.q) => `oogiri:${s.seed}:${q}:${s.phase}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), said: s.said.slice(), votes: s.votes.slice() });
// 投票の場面に並べる答え（書いた人の席の並び）。種と回から決める
export const orderOf = (s) => shuffle(s.said.map((t, p) => (t ? p : -1)).filter((p) => p >= 0), mulberry32((s.seed * 97 + s.q * 13 + 5) >>> 0));
// p が票を入れられる相手（審査員が選ぶ では審査員だけが選べる）
const targetsOf = (s, p) => (judgeOf(s) !== null && p !== judgeOf(s) ? [] : orderOf(s).filter((x) => x !== p));
// 答えを書く人（審査員は書かない）
const writersOf = (s) => [...Array(s.n).keys()].filter((p) => p !== judgeOf(s));

// 票を数えて結果の場面へ（s は書き換えてよい写し）
function tally(s, s0) {
  s.phase = 'shown';
  const got = Array(s.n).fill(0);
  s.votes.forEach((to) => { if (to !== null) got[to] += 1; });
  got.forEach((v, p) => { s.scores[p] += v; });
  s.last = { got };
  s.log = [...s0.log, { said: s.said.slice(), got }];
  return s;
}

let ui = null;

export default {
  id: 'oogiri',
  name: '大喜利',
  icon: '🎤',
  desc: 'お題に面白い答えを書いて、名前を隠したまま投票。票の多い人が勝ち',
  ready: true,
  multi: true,
  realtime: true,
  noCpu: true,
  minPlayers: 3,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: '回数', desc: '1回の対局で出るお題の数（審査員が選ぶ ときは使わず、全員が1回ずつ審査員になったら終わり）', def: 5, choices: ROUNDS },
    { key: 'judge', label: '審査員が選ぶ', desc: '投票の代わりに、順番に1人が審査員になっていちばん面白い答えを1つ選ぶ（選ばれた答えに1点）。全員が1回ずつ審査員になったら終わり', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 5, ...rules };
    const qs = shuffle([...OOGIRI.keys()], mulberry32(seed)).slice(0, r.judge ? n : roundsOf(r));
    return { n, seed, rules: r, qs, q: -1, phase: 'ready', said: Array(n).fill(null), votes: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'write' || s.phase === 'vote'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'tally' ? 'correct' : m.t === 'next' || m.t === 'close' ? 'question' : null;
    return m.p === me ? 'pop' : null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'write') return `第${s.q + 1}回 / ${s.qs.length}・答えを書こう`;
    if (s.phase === 'vote') return `第${s.q + 1}回 / ${s.qs.length}・${judgeOf(s) !== null ? '審査員が選んでいます' : '投票しよう'}`;
    return `第${s.q + 1}回の結果`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'write') {
      if (writersOf(s).every((p) => s.said[p])) return { key: 'allw' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'write' + s.q, ms: WRITE_MS + GRACE_MS, move: { t: 'close' } };
    }
    if (s.phase === 'vote') {
      const need = [...Array(s.n).keys()].filter((p) => targetsOf(s, p).length);
      if (need.every((p) => s.votes[p] !== null)) return { key: 'allv' + s.q, ms: GRACE_MS, move: { t: 'tally' } };
      return { key: 'vote' + s.q, ms: VOTE_MS + GRACE_MS, move: { t: 'tally' } };
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
        s.phase = 'write';
        s.said = Array(s.n).fill(null);
        s.votes = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'write') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'vote';
        return s.said.some((t) => t) ? s : tally(s, s0); // 答えが1つも無ければ投票をとばす
      }
      if (m.t === 'tally' && s0.phase === 'vote') {
        const s = clone(s0);
        s.step += 1;
        return tally(s, s0);
      }
      return null;
    }
    if (!Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || m.q !== s0.q) return null;
    if (m.t === 'ans') {
      if (s0.phase !== 'write' || s0.said[m.p] || m.p === judgeOf(s0) || typeof m.text !== 'string') return null;
      const text = m.text.trim().slice(0, MAX_TEXT);
      if (!text) return null;
      const s = clone(s0);
      s.step += 1;
      s.said[m.p] = text;
      return s;
    }
    if (m.t === 'vote') {
      if (s0.phase !== 'vote' || s0.votes[m.p] !== null || !targetsOf(s0, m.p).includes(m.to)) return null;
      const s = clone(s0);
      s.step += 1;
      s.votes[m.p] = m.to;
      return s;
    }
    return null;
  },

  // 部屋を出た人の席だけ動く: 投票ではくじで入れる
  cpuDelay() { return 1500; },
  cpu(s, p) {
    if (s.phase !== 'vote' || s.votes[p] !== null) return null;
    const ts = targetsOf(s, p);
    return ts.length ? { t: 'vote', q: s.q, to: ts[Math.floor(Math.random() * ts.length)] } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const text = (p) => filterShown(s.said[p] ?? '', o.hidden?.[p], 'sentence');
    const judge = s.phase === 'end' || s.phase === 'ready' ? null : judgeOf(s);
    const judgeName = judge === null ? '' : judge === me ? 'あなた' : o.names[judge] ?? '';
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && (s.phase === 'write' ? !!s.said[me] : s.votes[me] !== null)}:${s.phase === 'write' ? '' : (o.hidden ?? []).join()}`;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (p === judge && s.phase !== 'shown') return '<span class="pt-ok">👑審査員</span>';
      if (s.phase === 'write') return s.said[p] ? '<span class="pt-ok">書いた</span>' : '';
      if (s.phase === 'vote') return s.votes[p] !== null ? '<span class="pt-ok">投票した</span>' : '';
      if (s.phase === 'shown' && s.last) return s.last.got[p] ? `<span class="pt-ok">+${s.last.got[p]}</span>` : '<span class="pt-ng">―</span>';
      return '';
    };
    const chips = scoreChips(o, s.scores, { won, extra, steady: true });
    if (ui?.mount === mount && root.contains(ui.wrap)) { ui.chips.replaceWith(chips); ui.chips = chips; return; }

    root.innerHTML = '';
    root.className = 'board kj og';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    ui = { mount, wrap, chips };
    wrap.append(chips);
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${s.rules.judge ? 'お題に答えを書いて、審査員がいちばん面白い答えを選ぶ・全員が1回ずつ審査員' : 'お題に答えを書いて、名前を隠したまま投票'}・全${s.qs.length}回</div>`;
      return;
    }
    const key = qKey(s);
    card.innerHTML = `<div class="kj-num">第${s.q + 1}回 / ${s.qs.length}</div><div class="og-topic"></div>`;
    card.querySelector('.og-topic').textContent = OOGIRI[s.qs[s.q]];
    if (judge !== null) {
      const j = document.createElement('div');
      j.className = 'kj-sub';
      j.textContent = `👑 審査員: ${judgeName}`;
      card.append(j);
    }
    const note = document.createElement('p');
    note.className = 'cc-log';

    if (s.phase === 'write') {
      since(key);
      card.append(timeBar(key, WRITE_MS, { secs: true }));
      if (me !== null && me === judge) note.textContent = 'あなたは審査員です。みんなの答えがそろったら、いちばん面白い答えを1つ選んでね';
      else if (me !== null && !s.said[me] && o.canMove) {
        const form = document.createElement('form');
        form.className = 'kj-form';
        form.innerHTML = `<input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send" maxlength="${MAX_TEXT}" placeholder="面白い答えを書こう（${MAX_TEXT}字まで）"><button type="submit" class="btn primary">出す</button>`;
        const input = form.querySelector('input');
        form.onsubmit = (e) => {
          e.preventDefault();
          const t = input.value.trim();
          if (!t || since(key) >= WRITE_MS) return;
          o.onMove({ t: 'ans', q: s.q, text: t });
        };
        wrap.append(form);
        setTimeout(() => {
          if (!form.isConnected) return;
          input.disabled = true;
          form.querySelector('button').disabled = true;
          note.textContent = '時間切れ！';
        }, Math.max(0, WRITE_MS - since(key)));
        if (!matchMedia('(pointer: coarse)').matches && document.activeElement?.tagName !== 'SELECT') setTimeout(() => input.isConnected && input.focus(), 0);
        note.textContent = '答えは1回だけ出せます。名前は投票が終わるまで隠れます';
      } else note.textContent = me === null ? '観戦中' : s.said[me] ? `あなたの答え: ${text(me)}（ほかの人を待っています）` : '';
      wrap.append(note);
      return;
    }

    if (s.phase === 'vote') { since(key); card.append(timeBar(key, VOTE_MS, { secs: true })); }
    const list = document.createElement('div');
    list.className = 'og-list';
    const order = orderOf(s);
    const can = s.phase === 'vote' && me !== null && o.canMove && s.votes[me] === null && targetsOf(s, me).length > 0;
    const top = s.phase === 'shown' && s.last ? Math.max(...s.last.got) : 0;
    order.forEach((p, i) => {
      const item = document.createElement(can && p !== me ? 'button' : 'div');
      item.className = 'og-ans' + (p === me ? ' mine' : '') + (me !== null && s.votes[me] === p ? ' voted' : '') + (top > 0 && s.last.got[p] === top ? ' top' : '');
      if (item.tagName === 'BUTTON') item.type = 'button';
      const body = document.createElement('span');
      body.className = 'og-text';
      body.textContent = text(p);
      const tag = document.createElement('span');
      tag.className = 'og-who';
      if (s.phase === 'shown') tag.textContent = judge !== null ? `${p === me ? 'あなた' : o.names[p]}${s.last.got[p] ? '・👑 選ばれた！' : ''}` : `${p === me ? 'あなた' : o.names[p]}・${s.last.got[p]}票`;
      else tag.textContent = p === me ? 'あなたの答え' : String.fromCharCode(65 + i);
      item.append(body, tag);
      if (item.tagName === 'BUTTON') item.onclick = () => { list.querySelectorAll('button').forEach((b) => { b.disabled = true; }); o.onMove({ t: 'vote', q: s.q, to: p }); };
      list.append(item);
    });
    if (!order.length) list.textContent = 'だれも答えを書きませんでした';
    wrap.append(list);
    if (s.phase === 'vote') {
      if (judge !== null) note.textContent = me === judge ? (s.votes[me] !== null ? '選びました' : 'いちばん面白いと思う答えを1つ押そう') : `審査員の${judgeName}が選んでいます`;
      else note.textContent = me === null ? '観戦中' : s.votes[me] !== null ? '投票しました。ほかの人を待っています' : targetsOf(s, me).length ? 'いちばん面白いと思う答えを1つ押そう（自分の答えには入れられません）' : '';
    }
    wrap.append(note);
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const li = document.createElement('li');
      const top = Math.max(...x.got);
      const best = top > 0 ? x.got.map((v, p) => (v === top ? p : -1)).filter((p) => p >= 0) : [];
      const bestText = best.map((p) => `「${esc(filterShown(x.said[p] ?? '', o.hidden?.[p], 'sentence'))}」（${esc(p === me ? 'あなた' : o.names?.[p] ?? '')}${s.rules.judge ? '・👑' : `・${top}票`}）`).join(' ');
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span class="ox-rv">${esc(OOGIRI[s.qs[q]])}<br>${bestText || '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
