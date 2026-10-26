// ウミガメのスープ。部屋の1人が出題者になり、ほかの人は順番に「はい・いいえ」で答えられる質問をして、話の真相を当てる。
// 自分の番には「質問」「解答」「パス」のどれか1つ。出題者は質問に「はい・いいえ・関係ない」で答え、解答の正誤を決める。
// 外しても続けられ、いちばん先に当てた人の勝ち。出題者は「答えを明かして終わる」こともできる。
// 出題者は対局ごとに交代（これまで出題者をした回数がいちばん少ない人。同じ顔ぶれで続けたときに引き継ぐ）。
// CPU は回答者には入れない（質問ができないため）。部屋を出た人の番は自動でパス、出題者が出たら答えを明かして終わる。
// 手: { p, t: 'pick', idx } / { p, t: 'custom', q, a } / { p, t: 'ask' | 'guess', text } / { p, t: 'pass' }
//     / { p, t: 'reply', r: 'yes' | 'no' | 'na' | 'part'（部分的にはい。詳細設定があるときだけ） } / { p, t: 'judge', ok } / { p, t: 'reveal' }
//     / { p, t: 'hand', to }（問題を選ぶ前に、出題者をほかの人に代わる） / { p, t: 'fix', i, r }（出題者が前の答えを直す）
//
// 2026-10-26 本人の依頼で足したもの（作りは Claude の判断）:
//   詳細設定「出題者」（setter）: 人（順番に交代。最初）／CPU。CPU にすると CPU が1人だけ入って出題者になる（fixedCpus。main.js の lineup）。
//     CPU の席は init の cpus（main.js が渡す）で知る。CPU の出題者は CPU_KEYS（umigame-data.js）のある問題からくじで選び、
//     質問には言葉の手がかりで答え、解答も手がかりの言葉の組で正誤を決める（cpuReply・cpuJudge）。CPU が出題者のときは、回答者も自分の番に「降参して答えを見る」ができる。
//   出題者を選ぶ: 問題を選ぶ前に、出題者が「出題者を代わる」でほかの人（CPU の席は除く）に渡せる（hand）。代わった人が問題を選ぶ。
//   答えを直す: 出題者は、やりとりの欄の質問の答え（はい・いいえ・関係ありません・部分的にはい）をあとから直せる（fix。直した印 fixed を付ける）。
//   考えた時間: 各人の札に、いまの番の人が考えている秒数と、これまでの合計を出す。手の一覧に時刻は入れられないので、
//     各端末が局面の変わった時刻で数える（再読み込みすると0から。端末ごとに少しずれる）。
//   部分的にはい: 最初を「あり」にした。

import { esc } from './util.js';
import { since, kana } from './party.js';
import { shown } from '../filter.js';
import { PUZZLES, CPU_KEYS } from './umigame-data.js';

// 詳細設定「質問の数」（2026-10-06 本人の決定。最初は「決めない」＝今までどおり）: 20回・30回にすると、全員で合わせてその回数まで質問できる
//   （数えるのは出題者が答えた質問だけ。解答・パスは数えない）。使い切ったら、回答者が1人1回ずつ順に最後の解答（パスも可）をして、
//   だれも当てられなければ出題者の勝ち（Claude の判断。案では「使い切ったら出題者の勝ち」だったが、最後の質問をした人以外が解答できないまま終わらないように）。
const LIMITS = [[0, '決めない'], [20, '20回'], [30, '30回']];
// 詳細設定「制限時間」（2026-10-22。27回目の案）: 5分・10分にすると、問題が決まってからその時間がたったら、質問を使い切ったときと同じく
//   回答者が1人1回ずつ最後の解答をして、だれも当てられなければ出題者の勝ち（Claude の判断。質問の数と同じ終わり方にそろえた）。
//   時間はホストの端末で計り、{ p: -1, t: 'timeup' } を足す（main.js の scheduleReferee）。返事待ちの質問・解答があれば、それを片付けてから最後の解答に入る。
//   ホストが再読み込みすると、その時から計り直しになる。画面の残り時間は各端末で問題が出た時から数える（少しずれる）。質問の数と一緒に使え、先に来た方で最後の解答に入る。
const TIMES = [[0, '決めない'], [300, '5分'], [600, '10分']];
const MAX_TEXT = 120;
const MAX_PUZZLE = 300;
export const REPLY = { yes: 'はい', no: 'いいえ', na: '関係ありません', part: '部分的にはい' };
// 詳細設定「部分的にはい」（2026-10-07 本人の決定。21回目の案。2026-10-26 から最初は あり）: 出題者の答えに「部分的にはい」（質問の一部は合っている）を足す。
//   Claude の判断: ボタンは「はい」と「いいえ」の間に置く。ありのときだけ局面に partial: true を持つ（なしでは part の答えは反則）。

// CPU の出題者が使える問題（手がかりのあるもの）の番号
const CPU_PICKS = PUZZLES.map((x, i) => (CPU_KEYS[x.title] ? i : -1)).filter((i) => i >= 0);
const has = (text, words) => words.some((w) => text.includes(kana(w)));
// 質問への CPU の答え。「〜ない？」「〜ませんか？」で終わる質問は、はい・いいえを入れ替える
export function cpuReply(puzzle, text, partial) {
  const k = CPU_KEYS[puzzle.title];
  if (!k) return 'na';
  const t = kana(text);
  const yes = has(t, k.yes);
  const no = has(t, k.no);
  if (!yes && !no) return 'na';
  let r = yes && no ? (partial ? 'part' : 'yes') : yes ? 'yes' : 'no';
  if (r !== 'part' && /(ない|ません|ませんでした|なかった)(です)?(か|の)?[?？。!！]*$/.test(String(text).trim())) r = r === 'yes' ? 'no' : 'yes';
  return r;
}
// 解答の正誤。手がかりの言葉の組が全部入っていれば正解
export function cpuJudge(puzzle, text) {
  const k = CPU_KEYS[puzzle.title];
  if (!k) return false;
  const t = kana(text);
  return k.need.every((g) => has(t, g));
}

const okText = (t, max) => typeof t === 'string' && t.trim().length > 0 && t.length <= max;

function nextAsker(s, from) {
  let p = from;
  do { p = (p + 1) % s.n; } while (p === s.setter);
  return p;
}

const clone = (s) => ({ ...s, log: s.log.slice() });
const cpuSetter = (s) => !!s.cpus?.includes(s.setter);
const timeKey = (s) => `umigame:${s.seed}:time`;

// 質問を使い切ったか時間切れなら、最後の解答に入る（回答者が1人1回ずつ）
function startFinal(s) {
  if (s.final === null && ((s.limit && s.asked >= s.limit) || s.timeUp)) s.final = s.n - 1;
}

// 最後の解答の番を1つ使う。全員使い終わったら出題者の勝ちで終わり（終わったら true）
function finalStep(s) {
  if (s.final === null) return false;
  s.final -= 1;
  if (s.final > 0) return false;
  s.phase = 'end';
  s.winner = s.setter;
  return true;
}

/* ---------- 画面 ---------- */

// 文字を打っている途中に描き直しが来ても、入力欄は作り直さない（作り直すとスマホのキーボードが閉じる）
let ui = null; // { mount, wrap, top, act, actKey }
let draft = { ask: '', q: '', a: '' }; // 打ちかけの文字
let pickIdx = 0;

function button(text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ' + cls;
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

function textArea(key, placeholder, max, rows = 2) {
  const t = document.createElement('textarea');
  t.className = 'um-input';
  t.rows = rows;
  t.maxLength = max;
  t.placeholder = placeholder;
  t.value = draft[key];
  t.oninput = () => { draft[key] = t.value; };
  return t;
}

export default {
  id: 'umigame',
  name: 'ウミガメのスープ',
  icon: '🐢',
  desc: '出題者に「はい・いいえ」で答えられる質問を順番にして、ふしぎな話の真相を先に当てる',
  ready: true,
  multi: true,
  noCpu: true,
  fixedCpus: (rules) => (rules.setter === 'cpu' ? 1 : 0), // CPU の出題者だけ入る（main.js の lineup）
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'setter', label: '出題者', desc: 'CPU にすると、CPU が問題を出して質問に答えます（言葉の手がかりで答える簡単な CPU。手がかりを用意した14問から出します）', def: 'human', choices: [['human', '人（順番に交代）'], ['cpu', 'CPU']] },
    { key: 'partial', label: '部分的にはい', desc: '出題者の答えに「部分的にはい」（質問の一部は合っている）を足す。話が進みやすくなる', def: true },
    { key: 'limit', label: '質問の数', desc: '全員で合わせて何回まで質問できるか。使い切ったら1人1回ずつ最後の解答をして、だれも当てられなければ出題者の勝ち', def: 0, choices: LIMITS },
    { key: 'time', label: '制限時間', desc: '問題が出てからこの時間がたったら、1人1回ずつ最後の解答をして、だれも当てられなければ出題者の勝ち', def: 0, choices: TIMES },
  ],

  init(n, seed, { prev = null, rules = {}, cpus = [] } = {}) {
    const limit = LIMITS.some(([v]) => v && v === rules.limit) ? rules.limit : 0;
    const counts = Array.isArray(prev) && prev.length === n ? prev.slice() : Array(n).fill(0);
    const cpuSeats = Array.isArray(cpus) ? cpus.filter((i) => Number.isInteger(i) && i >= 0 && i < n) : [];
    const humanSeats = counts.map((_, i) => i).filter((i) => !cpuSeats.includes(i));
    const low = Math.min(...humanSeats.map((i) => counts[i]));
    // CPU の出題者（詳細設定）なら CPU の席。ふつうは出題者をした回数がいちばん少ない人（CPU の席は除く）
    const setter = rules.setter === 'cpu' && cpuSeats.length ? cpuSeats[0] : humanSeats.find((i) => counts[i] === low) ?? 0;
    // limit = 質問できる回数（0 は決めない）・asked = 答えた質問の数・final = 最後の解答の残りの番の数（使い切るまでは null）
    const s = { n, seed, counts, setter, limit, asked: 0, final: null, phase: 'pick', puzzle: null, turn: nextAsker({ n, setter }, setter), pending: null, log: [], winner: null, step: 0 };
    if (rules.partial) s.partial = true; // なしのときは局面に何も足さない
    if (cpuSeats.length) s.cpus = cpuSeats; // CPU の席（いるときだけ）
    if (TIMES.some(([v]) => v && v === rules.time)) { s.time = rules.time; s.timeUp = false; } // 制限時間（決めないなら足さない）
    return s;
  },

  // 制限時間: 問題が決まってから time 秒で時間切れ（最後の解答に入ったあとは計らない）
  referee(s) {
    if (!s.time || s.timeUp || s.final !== null || s.phase === 'pick' || s.phase === 'end') return null;
    return { key: 'time', ms: s.time * 1000, move: { t: 'timeup' } };
  },

  turn(s) {
    if (s.phase === 'ask') return s.turn;
    if (s.phase === 'pick' || s.phase === 'reply') return s.setter;
    return null;
  },
  canAct(s, p) {
    if (s.phase === 'end') return false;
    // CPU の出題者は、質問を待っている間は何もしない（main.js が何度も CPU を呼ばないように）
    if (p === s.setter) return s.phase !== 'ask' || !cpuSetter(s);
    return s.phase === 'ask' && p === s.turn;
  },
  result(s) { return s.phase === 'end' ? { winner: s.winner, setterWon: s.winner !== null && s.winner === s.setter } : null; },
  // 効果音（sound.js の名前）。a = 前の局面、b = 今の局面、m = 打たれた手、me = 自分の番号
  sound(a, b, m) { return m.t === 'pick' || m.t === 'custom' ? 'question' : m.t === 'judge' && !m.ok ? 'wrong' : 'pop'; },
  resultText(res, me, pn) {
    if (res.winner === null) return '出題者が答えを明かしました';
    if (res.setterWon) return res.winner === me ? 'だれも当てられなかった。出題者のあなたの勝ち！🎉' : `だれも当てられなかった。出題者の${pn(res.winner)}の勝ち！`;
    return res.winner === me ? 'あなたが真相を当てた！🎉' : `${pn(res.winner)}が真相を当てた！`;
  },
  carry(s, p) { return s.counts[p] + (p === s.setter ? 1 : 0); },

  apply(s0, m) {
    if (m?.p === -1) {
      if (m.t !== 'timeup' || !s0.time || s0.timeUp || s0.final !== null || s0.phase === 'pick' || s0.phase === 'end') return null;
      const s = clone(s0);
      s.step += 1;
      s.timeUp = true;
      if (s.phase === 'ask') startFinal(s); // 返事待ちなら、返事のあとで最後の解答に入る
      return s;
    }
    if (!m || !this.canAct(s0, m.p)) return null;
    const isSetter = m.p === s0.setter;
    const s = clone(s0);
    s.step += 1;
    switch (m.t) {
      case 'hand': // 問題を選ぶ前に出題者を代わる（CPU の席には渡さない）
        if (!isSetter || s.phase !== 'pick' || !Number.isInteger(m.to) || m.to < 0 || m.to >= s.n || m.to === s.setter || s.cpus?.includes(m.to)) return null;
        s.setter = m.to;
        s.turn = nextAsker(s, s.setter);
        return s;
      case 'fix': { // 出題者が前の答えを直す
        const e = s.log[m.i];
        if (!isSetter || !Number.isInteger(m.i) || !e || e.kind !== 'ask' || !Object.hasOwn(REPLY, m.r) || (m.r === 'part' && !s.partial) || e.r === m.r) return null;
        s.log[m.i] = { ...e, r: m.r, fixed: true };
        return s;
      }
      case 'pick':
        if (!isSetter || s.phase !== 'pick' || !PUZZLES[m.idx] || !Number.isInteger(m.idx)) return null;
        s.puzzle = { ...PUZZLES[m.idx] };
        s.phase = 'ask';
        return s;
      case 'custom':
        if (!isSetter || s.phase !== 'pick' || !okText(m.q, MAX_PUZZLE) || !okText(m.a, MAX_PUZZLE)) return null;
        s.puzzle = { title: '出題者の問題', q: m.q.trim(), a: m.a.trim() };
        s.phase = 'ask';
        return s;
      case 'ask':
      case 'guess':
        if (s.phase !== 'ask' || m.p !== s.turn || !okText(m.text, MAX_TEXT)) return null;
        if (m.t === 'ask' && s.final !== null) return null; // 質問を使い切った
        s.pending = { p: m.p, kind: m.t, text: m.text.trim() };
        s.phase = 'reply';
        return s;
      case 'pass':
        if (s.phase !== 'ask' || m.p !== s.turn) return null;
        s.log.push({ p: m.p, kind: 'pass' });
        if (finalStep(s)) return s;
        s.turn = nextAsker(s, s.turn);
        return s;
      case 'reply':
        if (!isSetter || s.phase !== 'reply' || s.pending.kind !== 'ask' || !Object.hasOwn(REPLY, m.r) || (m.r === 'part' && !s.partial)) return null;
        s.log.push({ ...s.pending, r: m.r });
        s.pending = null;
        s.phase = 'ask';
        s.turn = nextAsker(s, s.turn);
        s.asked += 1;
        startFinal(s); // 使い切った・時間切れ: 回答者が1人1回ずつ最後の解答
        return s;
      case 'judge':
        if (!isSetter || s.phase !== 'reply' || s.pending.kind !== 'guess' || typeof m.ok !== 'boolean') return null;
        s.log.push({ ...s.pending, ok: m.ok });
        s.pending = null;
        if (m.ok) { s.phase = 'end'; s.winner = s.log[s.log.length - 1].p; return s; }
        s.phase = 'ask';
        if (finalStep(s)) return s;
        startFinal(s); // 解答を待っている間に時間切れになっていた
        s.turn = nextAsker(s, s.turn);
        return s;
      case 'reveal': // CPU が出題者のときは、回答者も自分の番に降参できる
        if (!isSetter && !(cpuSetter(s) && s.phase === 'ask' && m.p === s.turn)) return null;
        s.phase = 'end';
        s.winner = null;
        return s;
      default:
        return null;
    }
  },

  // CPU の出題者（詳細設定）は問題を選び、質問と解答に手がかりで答える。それ以外（部屋を出た人の席・CPU の回答者）は今までどおり
  cpuDelay(s) { return cpuSetter(s) && s.phase === 'reply' ? 1500 : 1000; },
  cpu(s, p) {
    if (p === s.setter && cpuSetter(s)) {
      if (s.phase === 'pick') return { t: 'pick', idx: CPU_PICKS[Math.floor(Math.random() * CPU_PICKS.length)] };
      if (s.phase === 'reply' && s.pending.kind === 'ask') return { t: 'reply', r: cpuReply(s.puzzle, s.pending.text, !!s.partial) };
      if (s.phase === 'reply') return { t: 'judge', ok: cpuJudge(s.puzzle, s.pending.text) };
      return null;
    }
    return p === s.setter ? { t: 'reveal' } : { t: 'pass' };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const isSetter = me === s.setter;

    if (!(ui?.mount === s.seed && root.contains(ui.wrap))) {
      root.innerHTML = '';
      root.className = 'board um';
      const wrap = document.createElement('div');
      wrap.className = 'um-wrap';
      const top = document.createElement('div');
      const act = document.createElement('div');
      act.className = 'um-act';
      wrap.append(top, act);
      root.append(wrap);
      ui = { mount: s.seed, wrap, top, act, actKey: null };
      draft = { ask: '', q: '', a: '' };
    }

    // 考えた時間: 局面が変わったら、それまで番だった人の合計に足す（各端末の時計で数える）
    const turnNow = this.turn(s);
    if (!ui.clock || ui.clock.seed !== s.seed) ui.clock = { seed: s.seed, step: s.step, p: turnNow, at: performance.now(), sum: Array(s.n).fill(0) };
    if (ui.clock.step !== s.step) {
      const now = performance.now();
      if (ui.clock.p !== null && ui.clock.p !== undefined) ui.clock.sum[ui.clock.p] += now - ui.clock.at;
      ui.clock = { ...ui.clock, step: s.step, p: turnNow, at: now };
    }
    const clockText = (p) => {
      const cur = s.phase !== 'end' && ui.clock.p === p ? performance.now() - ui.clock.at : 0;
      const fmt = (ms) => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
      return cur ? `⏱ ${fmt(cur)}（計 ${fmt(ui.clock.sum[p] + cur)}）` : `⏱ 計 ${fmt(ui.clock.sum[p])}`;
    };

    /* 上の部分（参加者・問題・やりとり）は毎回描き直す */
    const top = document.createElement('div');
    const chips = document.createElement('div');
    chips.className = 'cc-opps';
    for (let p = 0; p < s.n; p++) {
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (this.turn(s) === p ? ' turn' : '') + (s.winner === p ? ' won' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = nameP(p);
      chip.append(name);
      const role = document.createElement('div');
      role.className = 'pt-extra';
      role.textContent = p === s.setter ? '出題者' : '回答者';
      chip.append(role);
      const clock = document.createElement('div');
      clock.className = 'pt-extra um-clock';
      clock.dataset.p = p;
      clock.textContent = clockText(p);
      chip.append(clock);
      if (o.away[p] || (o.sub?.[p])) {
        const t = document.createElement('span');
        t.className = 'cc-tag away';
        t.textContent = o.away[p] ? '応答なし' : '部屋を出ました';
        chip.append(t);
      }
      chips.append(chip);
    }
    top.append(chips);

    if (s.puzzle) {
      const card = document.createElement('div');
      card.className = 'um-card';
      card.innerHTML = `<div class="um-label">問題</div><p class="um-q">${esc(shown(s.puzzle.q, o.hidden?.[s.setter], 'sentence'))}</p>`;
      top.append(card);
      if (isSetter || s.phase === 'end') {
        const ans = document.createElement('details');
        ans.className = 'um-answer';
        ans.open = s.phase === 'end' || !!ui.answerOpen;
        ans.ontoggle = () => { ui.answerOpen = ans.open; };
        ans.innerHTML = `<summary>${s.phase === 'end' ? '真相' : '答え（あなただけに見えます）'}</summary><p>${esc(shown(s.puzzle.a, o.hidden?.[s.setter], 'sentence'))}</p>`;
        top.append(ans);
      }
    }

    if (s.log.length) {
      const list = document.createElement('ol');
      list.className = 'um-log';
      for (const e of s.log) {
        const li = document.createElement('li');
        const who = `<b>${esc(nameP(e.p))}</b>`;
        if (e.kind === 'pass') li.innerHTML = `${who}: <span class="um-muted">パス</span>`;
        else if (e.kind === 'ask') {
          li.innerHTML = `${who}: ${esc(shown(e.text, o.hidden?.[e.p], 'sentence'))} <span class="um-r ${e.r}">${REPLY[e.r]}</span>${e.fixed ? ' <small class="um-muted">（直した）</small>' : ''}`;
          // 出題者（人）は答えを直せる
          if (isSetter && !cpuSetter(s) && s.phase !== 'end') {
            const fix = document.createElement('select');
            fix.className = 'um-fix';
            fix.title = '答えを直す';
            fix.innerHTML = '<option value="">直す</option>' + Object.entries(REPLY).filter(([r]) => r !== e.r && (r !== 'part' || s.partial)).map(([r, t]) => `<option value="${r}">${t}</option>`).join('');
            const i = s.log.indexOf(e);
            fix.onchange = () => { if (fix.value) o.onMove({ t: 'fix', i, r: fix.value }); };
            li.append(' ', fix);
          }
        }
        else li.innerHTML = `${who}（解答）: ${esc(shown(e.text, o.hidden?.[e.p], 'sentence'))} <span class="um-r ${e.ok ? 'yes' : 'no'}">${e.ok ? '正解！' : 'ちがいます'}</span>`;
        list.append(li);
      }
      top.append(list);
    }
    clearInterval(ui.tick);
    clearInterval(ui.clockTick);
    ui.clockTick = setInterval(() => {
      if (!root.contains(top)) { clearInterval(ui.clockTick); return; }
      for (const el of top.querySelectorAll('.um-clock')) el.textContent = clockText(Number(el.dataset.p));
    }, 1000);
    if ((s.limit || s.time) && s.phase !== 'pick') {
      const left = document.createElement('p');
      left.className = 'um-left';
      const why = s.timeUp ? '時間切れです' : '質問を使い切りました';
      const mmss = () => {
        const sec = Math.max(0, s.time - Math.floor(since(timeKey(s)) / 1000));
        return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      };
      const text = () => {
        if (s.final !== null) return s.phase === 'end' ? why : `${why}。最後の解答（あと${s.final}人）`;
        if (s.timeUp) return s.phase === 'end' ? why : '時間切れです。この返事のあと、最後の解答に入ります';
        return [s.limit ? `残りの質問 ${s.limit - s.asked}回（全員で）` : '', s.time && s.phase !== 'end' ? `残り時間 ${mmss()}` : ''].filter(Boolean).join('・');
      };
      left.textContent = text();
      // 残り時間は1秒ごとに書き換える（描き直しが来なくても）
      if (s.time && !s.timeUp && s.final === null && s.phase !== 'end') ui.tick = setInterval(() => { if (root.contains(left)) left.textContent = text(); else clearInterval(ui.tick); }, 1000);
      top.append(left);
    }
    if (s.pending) {
      const p = document.createElement('p');
      p.className = 'um-pending';
      p.innerHTML = `<b>${esc(nameP(s.pending.p))}</b>${s.pending.kind === 'guess' ? 'の解答' : 'の質問'}: ${esc(shown(s.pending.text, o.hidden?.[s.pending.p], 'sentence'))}`;
      top.append(p);
    }
    ui.top.replaceWith(top);
    ui.top = top;

    /* 下の操作の部分は、場面が変わったときだけ作り直す */
    const actKey = `${s.phase}:${s.turn}:${me}:${o.canMove}:${s.pending?.text ?? ''}`;
    if (ui.actKey === actKey) return;
    ui.actKey = actKey;
    const act = document.createElement('div');
    act.className = 'um-act';
    const note = (text) => { const p = document.createElement('p'); p.className = 'cc-log'; p.textContent = text; act.append(p); };
    const row = (...els) => { const d = document.createElement('div'); d.className = 'cc-actions um-buttons'; d.append(...els); act.append(d); };

    if (s.phase === 'pick') {
      if (isSetter && o.canMove) {
        note('問題を選んでください。答えはあなたにだけ見えます。');
        const sel = document.createElement('select');
        sel.className = 'um-select';
        PUZZLES.forEach((x, i) => {
          const opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = `${i + 1}. ${x.title}`;
          opt.selected = i === pickIdx;
          sel.append(opt);
        });
        const preview = document.createElement('div');
        preview.className = 'um-card';
        const show = () => {
          const x = PUZZLES[pickIdx];
          preview.innerHTML = `<div class="um-label">問題</div><p class="um-q">${esc(x.q)}</p><div class="um-label">答え</div><p class="um-a">${esc(x.a)}</p>`;
        };
        sel.onchange = () => { pickIdx = Number(sel.value); show(); };
        show();
        act.append(sel, preview);
        row(button('ほかの問題をくじで', 'secondary', () => { pickIdx = Math.floor(Math.random() * PUZZLES.length); sel.value = String(pickIdx); show(); }),
          button('この問題で始める', 'primary', () => o.onMove({ t: 'pick', idx: pickIdx })));
        const own = document.createElement('details');
        own.className = 'um-own';
        own.innerHTML = '<summary>自分で問題を書く</summary>';
        const q = textArea('q', '問題（みんなに見せる文）', MAX_PUZZLE, 3);
        const a = textArea('a', '答え（真相。あなただけに見えます）', MAX_PUZZLE, 3);
        own.append(q, a, button('この問題で始める', 'primary', () => {
          if (!q.value.trim() || !a.value.trim()) return;
          o.onMove({ t: 'custom', q: q.value, a: a.value });
        }));
        act.append(own);
        // 出題者を代わる（CPU の席には渡さない）
        const others = Array.from({ length: s.n }, (_, p) => p).filter((p) => p !== s.setter && !s.cpus?.includes(p));
        if (others.length) {
          const hand = document.createElement('select');
          hand.className = 'um-select';
          hand.innerHTML = '<option value="">出題者を代わる…</option>' + others.map((p) => `<option value="${p}">${esc(nameP(p))}に代わってもらう</option>`).join('');
          hand.onchange = () => { if (hand.value !== '') o.onMove({ t: 'hand', to: Number(hand.value) }); };
          act.append(hand);
        }
      } else {
        note(`${nameP(s.setter)}が問題を選んでいます…`);
      }
    } else if (s.phase === 'ask') {
      if (me === s.turn && o.canMove) {
        const last = s.final !== null; // 質問を使い切った: 最後の解答だけ
        note(last ? '質問は使い切りました。最後の解答をするか、パス（あなたの番はこれが最後）' : '「はい・いいえ」で答えられる質問をするか、真相が分かったら「答えを言う」');
        const t = textArea('ask', last ? '真相を書いてください' : '例: 男は泣いていましたか？', MAX_TEXT);
        act.append(t);
        const send = (kind) => () => {
          if (!t.value.trim()) return;
          draft.ask = '';
          o.onMove({ t: kind, text: t.value });
        };
        if (last) row(button('パス', 'secondary', () => o.onMove({ t: 'pass' })), button('答えを言う', 'primary', send('guess')));
        else row(button('パス', 'secondary', () => o.onMove({ t: 'pass' })), button('答えを言う', 'secondary', send('guess')), button('質問する', 'primary', send('ask')));
        if (cpuSetter(s)) {
          note('CPU の出題者は、質問の言葉の手がかりで答えます（短くはっきり聞くと答えやすい）');
          row(button('降参して答えを見る', 'ghost', () => { if (confirm('降参して答えを見ますか？')) o.onMove({ t: 'reveal' }); }));
        }
      } else {
        note(`${nameP(s.turn)}が考えています…`);
      }
      if (isSetter) row(button('答えを明かして終わる', 'ghost', () => { if (confirm('答えを明かして終わりますか？')) o.onMove({ t: 'reveal' }); }));
    } else if (s.phase === 'reply') {
      if (isSetter) {
        if (s.pending.kind === 'ask') {
          note('質問に答えてください');
          row(button('はい', 'primary', () => o.onMove({ t: 'reply', r: 'yes' })),
            ...(s.partial ? [button('部分的にはい', 'primary', () => o.onMove({ t: 'reply', r: 'part' }))] : []),
            button('いいえ', 'primary', () => o.onMove({ t: 'reply', r: 'no' })),
            button('関係ありません', 'secondary', () => o.onMove({ t: 'reply', r: 'na' })));
        } else {
          note('解答は合っていますか？ 大事なところが合っていれば「正解」にしてください');
          row(button('ちがいます', 'secondary', () => o.onMove({ t: 'judge', ok: false })), button('正解！', 'primary', () => o.onMove({ t: 'judge', ok: true })));
        }
        row(button('答えを明かして終わる', 'ghost', () => { if (confirm('答えを明かして終わりますか？')) o.onMove({ t: 'reveal' }); }));
      } else {
        note(`${nameP(s.setter)}の返事を待っています…`);
      }
    }
    ui.act.replaceWith(act);
    ui.act = act;
  },
};
