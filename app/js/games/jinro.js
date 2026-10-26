// 人狼。4〜10人。2026-10-26 本人の依頼で足した新しいゲーム。話し合いは画面の文字だけ（本人の選択。通話はしない前提）。
// 役: 人狼（夜に1人を襲う）・占い師（夜に1人が人狼かどうか分かる）・騎士（夜に1人を襲撃から守る）・村人。
// 流れ: 1日目の昼から始まる → 昼に文字で話し合い（時間が来るか、だれかが「投票へ」）→ 投票でいちばん票の多い人を追放 →
//   夜（人狼が襲う・占い師が占う・騎士が守る。全員が選ぶか時間切れで朝）→ 朝に襲われた人が出る（守られたらだれも死なない）→ 2日目の昼 …
//   人狼が全員いなくなったら村人チームの勝ち。人狼の数が人狼以外の数と同じか多くなったら人狼チームの勝ち。
// 細かい決まり（どれも Claude の判断。変えるなら本人に確認）:
//   人狼の数は「おまかせ」で 4〜6人 1人・7〜9人 2人・10人 3人（詳細設定で1人・2人にもできる。人数の半分未満に抑える。6人で2人だと、1日目の投票を外すと次の夜で人狼の勝ちになり厳しすぎたため）。占い師は必ず1人。騎士は5人以上でありのとき1人。
//   占い師は始まったときに1人だけ「人狼ではない」人を知っている（よくある「初日の白」。人狼を当てて終わらないように）。
//   投票で並んだら、並んだ人だけでもう一度。それでも並んだら、その日はだれも追放しない。投票の時間は1分（過ぎたら入った票だけで決める）。
//   人狼が2人以上いて襲う相手が分かれたら、票の多い人。並んだら人狼の席の順で先の人が選んだ相手（全員の端末で同じになるように）。
//   騎士は自分を守れない（同じ人を続けて守るのはよい）。夜の時間は45秒（過ぎたら選んだ分だけで朝にする）。
//   追放・襲われた人の役は、終わるまで見せない。やられた人は話し合い・投票・夜の行動ができない（見ているだけ）。
//   手札と同じ簡易の隠し方（全員の端末が全員の役を知っている。開発用の道具で覗ける）。
//   CPU: 昼はたまに決まり文句を言うだけ（話し合いはできない）。投票は、人狼なら人狼以外から、占い師なら見つけた人狼、ほかは適当。夜の行動も適当。
// 手: { p, t: 'say', text, k: その人の何回目の発言か } / { p, t: 'tovote', d } / { p, t: 'vote', to, v: 何回目の投票か, d: 何日目か }
//   / { p, t: 'bite' | 'see' | 'guard', to, d } / { p: -1, t: 'tovote' | 'votetime' | 'dawn', d }（ホストの時間切れ）。
//   k・v・d で、同じ手が2回届いても2回目は反則になる（realtime。main.js の rebase）。

import { mulberry32, shuffle, esc } from './util.js';
import { timeBar } from './party.js';
import { shown } from '../filter.js';

const MAX_TEXT = 60;
const VOTE_MS = 60000;
const NIGHT_MS = 45000;
const GRACE_MS = 1500; // ゲストの手が届くのを待つ分
export const ROLE = { wolf: '人狼', seer: '占い師', knight: '騎士', villager: '村人' };
const ICON = { wolf: '🐺', seer: '🔮', knight: '🛡️', villager: '🧑‍🌾' };
const CPU_LINES = ['うーん、まだ分からないな', 'みんなの意見を聞きたい', 'ぼくは村人だよ', '怪しい人はいる？', 'よく考えよう', 'さっきの発言が気になる'];

const range = (n) => Array.from({ length: n }, (_, i) => i);
const aliveList = (s) => range(s.n).filter((p) => s.alive[p]);
const wolvesAlive = (s) => aliveList(s).filter((p) => s.roles[p] === 'wolf');
const clone = (s) => ({ ...s, alive: s.alive.slice(), said: s.said.slice(), chat: s.chat.slice(), votes: { ...s.votes }, night: { ...s.night, bite: { ...s.night.bite } }, seen: s.seen.slice(), log: s.log.slice() });
// 夜に行動する人（生きている人狼・占い師・騎士）
const nightActors = (s) => aliveList(s).filter((p) => s.roles[p] !== 'villager');
const acted = (s, p) => (s.roles[p] === 'wolf' ? p in s.night.bite : s.roles[p] === 'seer' ? s.night.see !== null : s.night.guard !== null);

export function wolfCount(n, choice) {
  const auto = n <= 6 ? 1 : n <= 9 ? 2 : 3;
  const want = choice === 1 || choice === 2 ? choice : auto;
  return Math.max(1, Math.min(want, Math.ceil(n / 2) - 1));
}

// 勝ち負けを見る（決まったら s.winner を入れて end にする）
function checkWin(s) {
  const w = wolvesAlive(s).length;
  const others = aliveList(s).length - w;
  if (w === 0) s.winner = 'village';
  else if (w >= others) s.winner = 'wolf';
  if (s.winner) s.phase = 'end';
  return !!s.winner;
}

function toNight(s) {
  s.phase = 'night';
  s.night = { bite: {}, see: null, guard: null };
}

// 投票の結果を出す
function settleVote(s) {
  const counts = new Map(s.cands.map((p) => [p, 0]));
  for (const to of Object.values(s.votes)) if (counts.has(to)) counts.set(to, counts.get(to) + 1);
  const top = Math.max(0, ...counts.values());
  const tied = top ? [...counts].filter(([, c]) => c === top).map(([p]) => p) : [];
  if (tied.length > 1 && s.vote === 1) { // 並んだ人だけでもう一度
    s.vote = 2;
    s.cands = tied;
    s.votes = {};
    return;
  }
  if (tied.length === 1) {
    s.alive[tied[0]] = false;
    s.log.push({ d: s.day, kind: 'exec', who: tied[0] });
  } else s.log.push({ d: s.day, kind: 'novote' });
  if (!checkWin(s)) toNight(s);
}

// 夜が明ける
function dawn(s) {
  const wolves = wolvesAlive(s);
  const counts = new Map();
  for (const w of wolves) { const to = s.night.bite[w]; if (Number.isInteger(to)) counts.set(to, (counts.get(to) ?? 0) + 1); }
  let target = null;
  if (counts.size) {
    const top = Math.max(...counts.values());
    target = wolves.map((w) => s.night.bite[w]).find((to) => counts.get(to) === top) ?? null; // 並んだら席の順で先の人狼が選んだ相手
  }
  if (target !== null && target === s.night.guard) s.log.push({ d: s.day, kind: 'peace' });
  else if (target !== null && s.alive[target]) { s.alive[target] = false; s.log.push({ d: s.day, kind: 'bite', who: target }); }
  else s.log.push({ d: s.day, kind: 'peace' });
  s.day += 1;
  if (checkWin(s)) return;
  s.phase = 'day';
  s.votes = {};
  s.vote = 1;
}

/* ---------- 画面 ---------- */

// 入力欄は対局の間ずっと同じものを使う（作り直すとスマホのキーボードが閉じる）
let ui = null;

function button(text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ' + cls;
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

export default {
  id: 'jinro',
  name: '人狼',
  icon: '🌕',
  desc: '村にまぎれた人狼を、文字の話し合いと投票で探す。夜には人狼が1人ずつ襲ってくる。4人から',
  ready: true,
  multi: true,
  realtime: true, // 話し合い・投票・夜の行動はみんなが同時に
  minPlayers: 4,
  maxPlayers: 10,
  settings: [
    { key: 'time', label: '話し合いの時間', desc: '昼の話し合いの長さ。時間が来たら投票に進む（その前に「投票へ」を押してもよい）', def: 3, choices: [[2, '2分'], [3, '3分'], [5, '5分']] },
    { key: 'wolves', label: '人狼の数', desc: 'おまかせは 4〜6人で1人・7〜9人で2人・10人で3人', def: 'auto', choices: [['auto', 'おまかせ'], [1, '1人'], [2, '2人']] },
    { key: 'knight', label: '騎士', desc: '夜に1人を人狼の襲撃から守れる役（5人以上のとき）', def: true },
  ],

  init(n, seed, { rules = {} } = {}) {
    const rng = mulberry32(seed >>> 0);
    const w = wolfCount(n, rules.wolves);
    const knight = rules.knight !== false && n >= 5;
    const deck = [...Array(w).fill('wolf'), 'seer', ...(knight ? ['knight'] : [])];
    while (deck.length < n) deck.push('villager');
    const roles = shuffle(deck, rng);
    // 占い師は始めに1人だけ「人狼ではない」人を知っている
    const seer = roles.indexOf('seer');
    const whites = range(n).filter((p) => p !== seer && roles[p] !== 'wolf');
    const first = whites[Math.floor(rng() * whites.length)];
    const minutes = [2, 3, 5].includes(rules.time) ? rules.time : 3;
    return {
      n, seed, minutes, roles, alive: Array(n).fill(true), day: 1, phase: 'day', said: Array(n).fill(0), chat: [],
      vote: 1, cands: [], votes: {}, night: { bite: {}, see: null, guard: null }, seen: [{ d: 0, to: first, wolf: false }], log: [], winner: null, step: 0,
    };
  },

  turn() { return null; },
  canAct(s, p) {
    if (s.phase === 'end' || !s.alive[p]) return false;
    if (s.phase === 'day') return true;
    if (s.phase === 'vote') return !(p in s.votes);
    return s.roles[p] !== 'villager' && !acted(s, p);
  },
  result(s) {
    if (s.phase !== 'end') return null;
    const winners = range(s.n).filter((p) => (s.winner === 'wolf') === (s.roles[p] === 'wolf'));
    return { winners, team: s.winner };
  },
  resultText(res, me) {
    const t = res.team === 'wolf' ? '人狼チームの勝ち！🐺' : '村人チームの勝ち！🎉';
    return me >= 0 && res.winners.includes(me) ? `${t}（あなたのチーム）` : t;
  },
  phaseText(s, me) {
    if (s.phase === 'day') return `${s.day}日目の昼。文字で話し合って、人狼を探しましょう`;
    if (s.phase === 'vote') return me >= 0 && s.alive[me] && !(me in s.votes) ? '追放する人に投票してください' : 'みんなの投票を待っています…';
    if (s.phase === 'night') return `${s.day}日目の夜。役のある人が行動しています…`;
    return '';
  },
  sound(a, b, m) {
    if (b.phase !== a.phase) return b.phase === 'night' ? 'question' : b.phase === 'vote' ? 'turn' : 'question';
    return m.t === 'say' ? 'pop' : null;
  },

  referee(s) {
    if (s.phase === 'day') return { key: 'day' + s.day, ms: s.minutes * 60000, move: { t: 'tovote', d: s.day } };
    if (s.phase === 'vote') return { key: `vote${s.day}-${s.vote}`, ms: VOTE_MS + GRACE_MS, move: { t: 'votetime', d: s.day, v: s.vote } };
    if (s.phase === 'night') return { key: 'night' + s.day, ms: NIGHT_MS + GRACE_MS, move: { t: 'dawn', d: s.day } };
    return null;
  },

  apply(s0, m) {
    if (!m || s0.phase === 'end') return null;
    if (m.p === -1) {
      if (m.d !== s0.day) return null;
      const s = clone(s0);
      s.step += 1;
      if (m.t === 'tovote' && s.phase === 'day') { s.phase = 'vote'; s.vote = 1; s.cands = aliveList(s); s.votes = {}; return s; }
      if (m.t === 'votetime' && s.phase === 'vote' && m.v === s.vote) { settleVote(s); return s; }
      if (m.t === 'dawn' && s.phase === 'night') { dawn(s); return s; }
      return null;
    }
    if (!Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || !this.canAct(s0, m.p)) return null;
    const p = m.p;
    const okTo = (to) => Number.isInteger(to) && to >= 0 && to < s0.n && s0.alive[to] && to !== p;
    switch (m.t) {
      case 'say': {
        if (s0.phase !== 'day' || typeof m.text !== 'string' || !m.text.trim() || m.text.length > MAX_TEXT || m.k !== s0.said[p] + 1) return null;
        const s = clone(s0);
        s.step += 1;
        s.said[p] = m.k;
        s.chat.push({ p, d: s.day, text: m.text.trim() });
        return s;
      }
      case 'tovote': {
        if (s0.phase !== 'day' || m.d !== s0.day) return null;
        const s = clone(s0);
        s.step += 1;
        s.phase = 'vote';
        s.vote = 1;
        s.cands = aliveList(s);
        s.votes = {};
        s.log.push({ d: s.day, kind: 'tovote', who: p });
        return s;
      }
      case 'vote': {
        if (s0.phase !== 'vote' || m.d !== s0.day || m.v !== s0.vote || !okTo(m.to) || !s0.cands.includes(m.to)) return null;
        const s = clone(s0);
        s.step += 1;
        s.votes[p] = m.to;
        if (aliveList(s).every((q) => q in s.votes)) settleVote(s);
        return s;
      }
      case 'bite':
      case 'see':
      case 'guard': {
        if (s0.phase !== 'night' || m.d !== s0.day || !okTo(m.to)) return null;
        const role = { bite: 'wolf', see: 'seer', guard: 'knight' }[m.t];
        if (s0.roles[p] !== role) return null;
        if (m.t === 'bite' && s0.roles[m.to] === 'wolf') return null; // 人狼は仲間を襲えない
        const s = clone(s0);
        s.step += 1;
        if (m.t === 'bite') s.night.bite[p] = m.to;
        else if (m.t === 'see') { s.night.see = m.to; s.seen.push({ d: s.day, to: m.to, wolf: s.roles[m.to] === 'wolf' }); }
        else s.night.guard = m.to;
        if (nightActors(s).every((q) => acted(s, q))) dawn(s);
        return s;
      }
      default:
        return null;
    }
  },

  // CPU: 昼はたまに決まり文句。投票と夜の行動は適当（人狼は仲間に入れない・占い師は見つけた人狼に入れる）
  cpuDelay(s) { return s.phase === 'day' ? 4000 : 1500; },
  cpu(s, p) {
    const pick = (a) => (a.length ? a[Math.floor(Math.random() * a.length)] : null);
    if (s.phase === 'day') {
      if (s.said[p] >= s.day * 2 || Math.random() > 0.25) return null; // 1日に2回まで・たまに
      return { t: 'say', text: pick(CPU_LINES), k: s.said[p] + 1 };
    }
    const others = aliveList(s).filter((q) => q !== p);
    if (s.phase === 'vote') {
      let c = s.cands.filter((q) => q !== p);
      if (s.roles[p] === 'wolf') c = c.filter((q) => s.roles[q] !== 'wolf').length ? c.filter((q) => s.roles[q] !== 'wolf') : c;
      if (s.roles[p] === 'seer') {
        const found = s.seen.filter((x) => x.wolf && c.includes(x.to)).map((x) => x.to);
        if (found.length) c = found;
      }
      const to = pick(c);
      return to === null ? null : { t: 'vote', to, v: s.vote, d: s.day };
    }
    if (s.phase === 'night') {
      if (s.roles[p] === 'wolf') { const to = pick(others.filter((q) => s.roles[q] !== 'wolf')); return to === null ? null : { t: 'bite', to, d: s.day }; }
      if (s.roles[p] === 'seer') {
        const unseen = others.filter((q) => !s.seen.some((x) => x.to === q));
        const to = pick(unseen.length ? unseen : others);
        return to === null ? null : { t: 'see', to, d: s.day };
      }
      if (s.roles[p] === 'knight') { const to = pick(others); return to === null ? null : { t: 'guard', to, d: s.day }; }
    }
    return null;
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const over = s.phase === 'end';

    if (!(ui?.seed === s.seed && ui.me === me && root.contains(ui.wrap))) {
      root.innerHTML = '';
      root.className = 'board jr';
      const wrap = document.createElement('div');
      wrap.className = 'jr-wrap';
      const top = document.createElement('div');
      const act = document.createElement('div');
      const form = document.createElement('form');
      form.className = 'kj-form jr-form';
      form.innerHTML = `<input type="text" autocomplete="off" enterkeyhint="send" maxlength="${MAX_TEXT}" placeholder="話す（${MAX_TEXT}文字まで）"><button type="submit" class="btn primary">送る</button>`;
      const input = form.querySelector('input');
      form.querySelector('button').addEventListener('mousedown', (e) => e.preventDefault()); // 押しても入力欄から外れない（キーボードを閉じない）
      form.onsubmit = (e) => {
        e.preventDefault();
        const { s: cur, o: co } = ui.cur;
        const text = input.value.trim();
        if (!text || cur.phase !== 'day' || !co.canMove) return;
        input.value = '';
        co.onMove({ t: 'say', text: text.slice(0, MAX_TEXT), k: cur.said[me] + 1 });
      };
      wrap.append(top, form, act);
      root.append(wrap);
      ui = { seed: s.seed, me, wrap, top, act, form, input, actKey: null, cur: null };
    }
    ui.cur = { s, o };

    /* 上: 自分の役・みんな・できごと・話し合い（毎回描き直す） */
    const top = document.createElement('div');
    if (me !== null) {
      const role = s.roles[me];
      const card = document.createElement('div');
      card.className = 'jr-role ' + role;
      let html = `<div class="jr-role-name">${ICON[role]} あなたは<b>${ROLE[role]}</b>${s.alive[me] ? '' : '（やられました）'}</div>`;
      if (role === 'wolf') {
        const mates = range(s.n).filter((q) => q !== me && s.roles[q] === 'wolf');
        html += `<div class="jr-role-sub">${mates.length ? `仲間の人狼: ${mates.map((q) => esc(nameP(q))).join('、')}` : '人狼はあなただけ'}。夜に1人を襲います。人狼だとばれないように話しましょう</div>`;
      } else if (role === 'seer') {
        html += `<div class="jr-role-sub">夜に1人を占って、人狼かどうかが分かります。<br>${s.seen.map((x) => `${x.d ? `${x.d}日目の夜` : '始め'}: ${esc(nameP(x.to))} は <b>${x.wolf ? '人狼 🐺' : '人狼ではない'}</b>`).join('<br>')}</div>`;
      } else if (role === 'knight') {
        html += '<div class="jr-role-sub">夜に1人を人狼の襲撃から守れます（自分は守れません）</div>';
      } else html += '<div class="jr-role-sub">特別な力はありません。話し合いで人狼を見つけましょう</div>';
      card.innerHTML = html;
      top.append(card);
    }

    const chips = document.createElement('div');
    chips.className = 'cc-opps';
    for (const p of range(s.n)) {
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (s.alive[p] ? '' : ' out') + (over && s.winner && (s.winner === 'wolf') === (s.roles[p] === 'wolf') ? ' won' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = nameP(p);
      chip.append(name);
      const sub = document.createElement('div');
      sub.className = 'pt-extra';
      sub.textContent = over ? `${ICON[s.roles[p]]} ${ROLE[s.roles[p]]}${s.alive[p] ? '' : '（やられた）'}` : s.alive[p] ? (s.phase === 'vote' ? (p in s.votes ? '投票ずみ' : '考え中') : '生きている') : 'やられた';
      chip.append(sub);
      if (o.away[p] || o.sub?.[p]) {
        const t = document.createElement('span');
        t.className = 'cc-tag away';
        t.textContent = o.away[p] ? '応答なし' : 'CPU が代わりに';
        chip.append(t);
      }
      chips.append(chip);
    }
    top.append(chips);

    // できごと（追放・襲撃）
    const logs = s.log.filter((e) => e.kind !== 'tovote');
    if (logs.length) {
      const ul = document.createElement('ul');
      ul.className = 'jr-log';
      for (const e of logs) {
        const li = document.createElement('li');
        if (e.kind === 'exec') li.innerHTML = `${e.d}日目の投票で <b>${esc(nameP(e.who))}</b> が追放された`;
        else if (e.kind === 'novote') li.textContent = `${e.d}日目の投票は票が並び、だれも追放されなかった`;
        else if (e.kind === 'bite') li.innerHTML = `${e.d}日目の夜、<b>${esc(nameP(e.who))}</b> が人狼に襲われた`;
        else li.textContent = `${e.d}日目の夜は、だれも襲われなかった`;
        ul.append(li);
      }
      top.append(ul);
    }

    // 話し合い（その日の分を下に。前の日の分は畳む）
    const chat = document.createElement('div');
    chat.className = 'jr-chat';
    const days = [...new Set(s.chat.map((c) => c.d))];
    for (const d of days) {
      const box = document.createElement(d === s.day && !over ? 'div' : 'details');
      if (box.tagName === 'DETAILS') box.innerHTML = `<summary>${d}日目の話し合い</summary>`;
      else { const h = document.createElement('div'); h.className = 'jr-day'; h.textContent = `${d}日目の話し合い`; box.append(h); }
      for (const c of s.chat.filter((x) => x.d === d)) {
        const line = document.createElement('div');
        line.className = 'jr-line' + (c.p === me ? ' mine' : '');
        line.innerHTML = `<b>${esc(nameP(c.p))}</b> ${esc(shown(c.text, o.hidden?.[c.p], 'sentence'))}`;
        box.append(line);
      }
      chat.append(box);
    }
    if (s.phase === 'day' && !s.chat.some((c) => c.d === s.day)) {
      const hint = document.createElement('p');
      hint.className = 'cc-log';
      hint.textContent = `${s.day}日目の昼です。だれが人狼だと思うか、下の欄に書いて話し合いましょう`;
      chat.append(hint);
    }
    top.append(chat);
    if (s.phase === 'day') top.append(timeBar(`jinro:${s.seed}:day${s.day}`, s.minutes * 60000, { secs: true }));
    if (s.phase === 'vote') top.append(timeBar(`jinro:${s.seed}:vote${s.day}-${s.vote}`, VOTE_MS, { secs: true }));
    if (s.phase === 'night') top.append(timeBar(`jinro:${s.seed}:night${s.day}`, NIGHT_MS, { secs: true }));
    ui.top.replaceWith(top);
    ui.top = top;
    if (s.phase === 'day') chat.lastElementChild?.lastElementChild?.scrollIntoView?.({ block: 'nearest' });

    // 話す欄は、昼に生きている人にだけ出す（隠すだけで作り直さない）
    ui.form.hidden = !(s.phase === 'day' && me !== null && o.canMove);

    /* 下: 投票・夜の行動（場面が変わったときだけ作り直す） */
    const actKey = `${s.phase}:${s.day}:${s.vote}:${me}:${o.canMove}:${s.cands.join()}`;
    if (ui.actKey === actKey) return;
    ui.actKey = actKey;
    const act = document.createElement('div');
    act.className = 'jr-act';
    const note = (text) => { const p = document.createElement('p'); p.className = 'cc-log'; p.textContent = text; act.append(p); };
    const row = (els) => { const d = document.createElement('div'); d.className = 'cc-actions um-buttons'; d.append(...els); act.append(d); };
    if (s.phase === 'day' && me !== null && o.canMove) {
      row([button('話し合いを終えて投票へ', 'secondary', () => { if (confirm('投票に進みますか？（全員の画面が投票に変わります）')) o.onMove({ t: 'tovote', d: s.day }); })]);
    } else if (s.phase === 'vote') {
      if (s.vote === 2) note(`票が並んだので、${s.cands.map((q) => nameP(q)).join('・')}の中からもう一度投票します`);
      if (me !== null && o.canMove) {
        note('追放する人に投票してください');
        row(s.cands.filter((q) => q !== me).map((q) => button(nameP(q), 'primary', () => o.onMove({ t: 'vote', to: q, v: s.vote, d: s.day }))));
      } else if (me !== null && s.alive[me]) note(me in s.votes ? `${nameP(s.votes[me])}に投票しました。みんなを待っています…` : '');
    } else if (s.phase === 'night') {
      const role = me !== null ? s.roles[me] : null;
      if (me !== null && o.canMove) {
        const others = aliveList(s).filter((q) => q !== me && (role !== 'wolf' || s.roles[q] !== 'wolf'));
        const t = { wolf: 'bite', seer: 'see', knight: 'guard' }[role];
        note({ wolf: '襲う人を選んでください', seer: '占う人を選んでください', knight: '守る人を選んでください' }[role]);
        row(others.map((q) => button(nameP(q), 'primary', () => o.onMove({ t, to: q, d: s.day }))));
      } else if (me !== null && s.alive[me] && role !== 'villager') {
        const done = role === 'wolf' ? s.night.bite[me] : role === 'seer' ? s.night.see : s.night.guard;
        note(`${nameP(done)}を${{ wolf: '襲う', seer: '占った', knight: '守る' }[role]}ことにしました。朝を待っています…`);
      } else note('夜です。朝になるのを待っています…');
    }
    ui.act.replaceWith(act);
    ui.act = act;
  },
};
