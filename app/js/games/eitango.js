// 英単語クイズ（2026-10-31 本人の依頼で追加）。全員に同じ問題が出る。詳細設定「出し方」で2通り（どちらも1つのゲームの中。本人が推奨を承認）:
//   意味当て（最初）: 英単語が出て、4つの日本語の意味から1つ選ぶ。答えられるのは1問に1回だけ（難読漢字の「4つから選ぶ」と同じ）。
//   スペル打ち: 日本語の意味が出て、英単語を打ち込む。何度でも打ち直せる。つづりの文字数を「_ _ _ _」で見せ、制限時間の4割がたつと1文字目も見せる（本人が推奨を承認）。
// 点と進め方は難読漢字と同じ（本人が推奨を承認）: 正解した人は速い順に 3点・2点・それ以降は1点、パスあり、10問（詳細設定で15・20問）。
// 難しさは 中学（最初）・高校・むずかしい・ぜんぶまぜる（本人が推奨を承認）。単語は eitango-data.js（Claude が書いた）。
// 進行と時間の測り方は kanji.js と同じ（ホストが p = -1 の手を足す。速さは各自の端末で画面に出てから答えるまで）。
// Claude の判断:
//   意味当てのまちがいの3つは、同じ難しさのほかの単語の意味から選ぶ（choicesOf。種と何問目かから作るので全員同じ）。
//   スペル打ちは大文字・小文字・全角・空白を区別しない。米と英でつづりが違う単語はどちらでも正解。1文字目のヒントは詳細設定にせずいつも出す。
//   スペル打ちでは、1回の入力で3文字以上増えたら予測変換（候補から選んだ）と見て戻す（タイピング早打ちと同じ。つづりを覚えていなくても打てるため）。
//   CPU は難しさに応じた確率（中学 6割・高校 45%・むずかしい 3割・まぜる 45%）で、4秒〜制限時間の7割のあいだに正解する。
//   正解しないときは、意味当てでは同じ時刻に4つから適当に選び、スペル打ちではパスする。
//   「出し方」はおまかせで抽選しない（難読漢字の「答え方」と同じく好みのため。main.js の KEEP_KEYS の ask）。
//   ふりかえり（出た単語と意味・自分の正誤・いちばん速く正解した人）は難読漢字と同じく、対局が終わった画面にいつも出す。
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'try', q: 問題番号, text: 答え, ms, n: その問題で何回目の答えか } / { p, t: 'pass', q }

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { EITANGO } from './eitango-data.js';
import { REVIEW_CSS } from './kanji.js';

const ROUNDS = [[10, '10問'], [15, '15問'], [20, '20問']];
const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 1500;
const AFTER_MS = 5000; // 誰かが正解してから締め切るまで
const PTS = [3, 2]; // 速い順の点。それより後ろは1点
const HINT_AT = 0.4; // スペル打ちで1文字目を見せるのは、制限時間のこの割合がたったとき
const PREDICT_JUMP = 3; // スペル打ちで、1回の入力でこれだけ増えたら予測変換と見る
const LEVELS = { easy: '中学', mid: '高校', hard: 'むずかしい', mix: 'ぜんぶまぜる' };
const ASKS = { meaning: '意味当て（4つから選ぶ）', spell: 'スペル打ち' };
const CPU_RATE = { easy: 0.6, mid: 0.45, hard: 0.3, mix: 0.45 };
const CHOICES = 4;

const limitOf = (s) => Number(s.rules.time) * 1000;
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
const qKey = (s, q = s.q) => `eitango:${s.seed}:${q}`;
const poolOf = (level) => (level === 'mix' ? [...EITANGO.easy, ...EITANGO.mid, ...EITANGO.hard] : EITANGO[level] ?? EITANGO.easy);
// 打った英単語のそろえ方（全角→半角・大文字→小文字・空白を取る）
export const norm = (text) => String(text).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
// 正解か。意味当ては意味の文字列が同じか、スペル打ちはつづりのどれかと同じか
export const isRight = (s, q, text) => {
  const [words, mean] = s.qs[q];
  return s.opts ? text === mean : words.includes(norm(text));
};

// 意味当ての4つの意味。正しい意味のほかの3つは、その単語と同じ難しさのほかの単語の意味から選ぶ。並べ方は種と何問目かだけで決まる
export function choicesOf(seed, q, [words, mean]) {
  const rnd = mulberry32((Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(q + 1, 0x85ebca6b)) >>> 0);
  const level = Object.keys(EITANGO).find((l) => EITANGO[l].some(([w]) => w[0] === words[0])) ?? 'easy';
  const others = [...new Set(shuffle(EITANGO[level], rnd).map(([, m]) => m).filter((m) => m !== mean))];
  return shuffle([mean, ...others.slice(0, CHOICES - 1)], rnd);
}

const clone = (s) => ({ ...s, scores: s.scores.slice(), tries: s.tries.slice(), solved: s.solved.slice(), said: s.said.slice(), passed: s.passed.slice() });
// その問題でもう答えない人（正解・パス・意味当てで答えた）
const doneOf = (s, p) => s.solved[p] !== null || s.passed[p] || (!!s.opts && s.tries[p] > 0);
// 締め切りのとき、正解した人の点（速い順に PTS、それより後ろは1点。同じ速さは同じ点）
export function pointsOf(solved) {
  return solved.map((v) => {
    if (v === null) return 0;
    const rank = solved.filter((x) => x !== null && x < v).length;
    return PTS[rank] ?? 1;
  });
}

// 「ふりかえり」の中身。出た順に { n, word, mean, mark: ⭕・❌・''（観戦）, fast: いちばん速く正解した人の番号の一覧, ms }
export function reviewOf(s, me = null) {
  return (s.log ?? []).map((x, q) => {
    const [words, mean] = s.qs[q];
    const mark = me === null || me < 0 || me >= s.n ? '' : x.solved[me] !== null ? '⭕' : '❌';
    return { n: q + 1, word: words[0], mean, mark, fast: x.winners.slice(), ms: x.winners.length ? x.solved[x.winners[0]] : null };
  });
}

// スペル打ちの文字数の線（「_ _ _ _」）。first なら1文字目を見せる
export const blanksOf = (word, first = false) => [...word].map((c, i) => (i === 0 && first ? c : '_')).join(' ');

/* ---------- 画面 ---------- */

function passButton(s, o) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ghost kj-pass';
  b.textContent = 'パス（この問題をとばす）';
  b.onclick = () => { b.disabled = true; o.onMove({ t: 'pass', q: s.q }); };
  return b;
}

// 答えを打っている途中に描き直しが来ても入力欄を作り直さない（作り直すとスマホのキーボードが閉じる）
let ui = null;
const cpuPlan = new Map();

export default {
  id: 'eitango',
  name: '英単語クイズ',
  icon: '🔤',
  desc: '英単語の意味を当てるか、意味から英単語を打つ。正解すれば点、速いほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'ask', label: '出し方', desc: '意味当て: 英単語を見て4つの意味から選ぶ（1問に1回だけ）／スペル打ち: 意味を見て英単語を打つ', def: 'meaning', choices: Object.entries(ASKS) },
    { key: 'level', label: '難しさ', desc: '出る英単語の難しさ', def: 'easy', choices: Object.entries(LEVELS) },
    { key: 'time', label: '制限時間', desc: '1問あたりの時間', def: '25', choices: [['15', '15秒'], ['25', '25秒'], ['40', '40秒']] },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 10, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { ask: 'meaning', level: 'easy', time: '25', ...rules };
    const qs = shuffle(poolOf(r.level), mulberry32(seed)).slice(0, roundsOf(r));
    return {
      n, seed, rules: r, qs, q: -1, phase: 'ready',
      tries: Array(n).fill(0), solved: Array(n).fill(null), said: Array(n).fill(''), passed: Array(n).fill(false), scores: Array(n).fill(0), last: null, step: 0,
      ...(r.ask === 'spell' ? {} : { opts: qs.map((x, i) => choicesOf(seed, i, x)) }), // 意味当ての各問題の4つの意味
    };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : b.last.winners.includes(me) ? 'correct' : 'pop';
    if (m.t === 'pass') return m.p === me ? 'pop' : null;
    if (m.p === me) return b.solved[me] !== null ? 'correct' : 'wrong';
    return b.solved[m.p] !== null ? 'pop' : null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `第${s.q + 1}問 / ${s.qs.length}`;
    return `第${s.q + 1}問の答え`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      if (s.solved.some((v) => v !== null)) return { key: 'solved' + s.q, ms: AFTER_MS, move: { t: 'close' } };
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
        if (s.q + 1 >= s.qs.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.tries = Array(s.n).fill(0);
        s.solved = Array(s.n).fill(null);
        s.said = Array(s.n).fill('');
        s.passed = Array(s.n).fill(false);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const times = s.solved.filter((v) => v !== null);
        const best = times.length ? Math.min(...times) : null;
        const winners = best === null ? [] : s.solved.map((v, p) => (v === best ? p : -1)).filter((p) => p >= 0);
        const pts = pointsOf(s.solved);
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { winners, best, pts };
        s.log = [...(s0.log ?? []), { solved: s.solved.slice(), winners }];
        return s;
      }
      return null;
    }
    if (m.t === 'pass') {
      if (s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
      const s = clone(s0);
      s.step += 1;
      s.passed[m.p] = true;
      return s;
    }
    if (m.t !== 'try' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (typeof m.text !== 'string' || !m.text || m.text.length > 30) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > limitOf(s0) + 500) return null;
    if (m.n !== s0.tries[m.p] + 1 || doneOf(s0, m.p)) return null;
    if (s0.opts && !s0.opts[s0.q].includes(m.text)) return null; // 意味当て: 4つのどれか
    const s = clone(s0);
    s.step += 1;
    s.tries[m.p] = m.n;
    s.said[m.p] = m.text;
    if (isRight(s, s.q, m.text)) s.solved[m.p] = m.ms;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 250 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      plan = { at: 4000 + Math.random() * (limitOf(s) * 0.7 - 4000), ok: Math.random() < (CPU_RATE[s.rules.level] ?? 0.45), done: false };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    if (plan.done || t < plan.at) return null;
    plan.done = true;
    const ms = Math.round(t);
    const [words, mean] = s.qs[s.q];
    if (s.opts) {
      const opts = s.opts[s.q];
      return { t: 'try', q: s.q, text: plan.ok ? mean : opts[Math.floor(Math.random() * opts.length)], ms, n: 1 };
    }
    if (!plan.ok) return { t: 'pass', q: s.q };
    return { t: 'try', q: s.q, text: words[0], ms, n: s.tries[p] + 1 };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && s.solved[me] !== null}:${me !== null && s.passed[me]}${s.opts && me !== null ? ':' + s.tries[me] : ''}`;
    const shown = s.phase === 'shown' || s.phase === 'end';
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? '<span class="pt-ok">正解！</span>' : s.passed[p] ? '<span class="pt-ng">パス</span>' : '';
      if (!shown || !s.last || s.q < 0) return '';
      const got = s.last.pts[p];
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])}${got ? ` +${got}` : ''}</span>`;
      if (s.passed[p]) return '<span class="pt-ng">パス</span>';
      return s.tries[p] ? '<span class="pt-ng">×</span>' : '<span class="pt-ng">―</span>';
    };
    const chips = scoreChips(o, s.scores, { won, extra });

    if (ui?.mount === mount && root.contains(ui.wrap)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      this.note(s, me);
      return;
    }

    root.innerHTML = '';
    root.className = 'board kj et';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    ui = { mount, wrap, chips, n: 0, last: '' };
    wrap.append(chips);
    if (s.phase === 'end') {
      wrap.append(this.review(s, me, o));
      root.append(wrap);
      return;
    }

    const card = document.createElement('div');
    card.className = 'kj-card';
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${ASKS[s.opts ? 'meaning' : 'spell']}・難しさ: ${LEVELS[s.rules.level] ?? ''}・全${s.qs.length}問・1問 ${s.rules.time}秒</div>`;
      wrap.append(card);
      root.append(wrap);
      return;
    }
    const [words, mean] = s.qs[s.q];
    const key = qKey(s);
    const limit = limitOf(s);
    card.innerHTML = `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div><div class="kj-word et-word"></div>`;
    // 意味当ては英単語を、スペル打ちは意味を大きく出す
    card.querySelector('.kj-word').textContent = s.opts ? words[0] : mean;
    if (s.phase === 'open') {
      since(key);
      card.append(timeBar(key, limit, { secs: true }));
      if (!s.opts) {
        const hint = document.createElement('div');
        hint.className = 'kj-hint et-blanks';
        hint.textContent = blanksOf(words[0]) + `（${[...words[0]].length}文字）`;
        card.append(hint);
        setTimeout(() => {
          if (hint.isConnected) hint.textContent = blanksOf(words[0], true) + `（${[...words[0]].length}文字）`;
        }, Math.max(0, limit * HINT_AT - since(key)));
      }
    } else {
      const ans = document.createElement('div');
      ans.className = 'kj-answer';
      ans.textContent = s.opts ? `意味: ${mean}` : `答え: ${words.join('／')}`;
      card.append(ans);
    }
    wrap.append(card);

    const note = document.createElement('p');
    note.className = 'cc-log';
    ui.note = note;

    if (s.opts) {
      wrap.append(this.choiceGrid(s, me, o, key, limit, note));
      if (s.phase === 'open' && me !== null && !doneOf(s, me)) wrap.append(passButton(s, o));
    } else if (s.phase === 'open' && me !== null && !doneOf(s, me)) {
      const form = document.createElement('form');
      form.className = 'kj-form';
      form.innerHTML = '<input type="text" lang="en" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" maxlength="30" placeholder="英単語を打つ"><button type="submit" class="btn primary">答える</button>';
      const input = form.querySelector('input');
      input.oninput = () => {
        const grew = [...input.value].length - [...ui.last].length;
        if (grew >= PREDICT_JUMP) {
          input.value = ui.last;
          note.textContent = '予測変換（候補から選ぶ）は使えません。1文字ずつ打ってください';
          return;
        }
        ui.last = input.value;
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        const text = input.value.trim();
        const ms = Math.round(since(key));
        if (!text || ms >= limit) return;
        const now = Math.max(ui.n, s.tries[me]) + 1;
        ui.n = now;
        input.value = '';
        ui.last = '';
        o.onMove({ t: 'try', q: s.q, text, ms, n: now });
      };
      ui.input = input;
      wrap.append(form, passButton(s, o));
      setTimeout(() => {
        if (!form.isConnected) return;
        input.disabled = true;
        form.querySelector('button').disabled = true;
        note.textContent = '時間切れ！';
      }, Math.max(0, limit - since(key)));
    }
    wrap.append(note);
    root.append(wrap);
    this.note(s, me);
    // スマホは勝手にキーボードを出さない。「ゲームを変える」の一覧を開いているときも取り上げない
    if (ui.input && !matchMedia('(pointer: coarse)').matches && document.activeElement?.tagName !== 'SELECT') ui.input.focus();
  },

  // ふりかえり（難読漢字と同じ見た目。kanji.js の REVIEW_CSS を使う）
  review(s, me, o) {
    if (!document.getElementById('kj-review-css')) {
      const st = document.createElement('style');
      st.id = 'kj-review-css';
      st.textContent = REVIEW_CSS;
      document.head.append(st);
    }
    const rows = reviewOf(s, me);
    const box = document.createElement('details');
    box.className = 'kj-review et-review' + (me === null ? ' watch' : '');
    box.open = true;
    const right = rows.filter((r) => r.mark === '⭕').length;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${rows.length}問${me !== null ? `・あなたの正解 ${right}問` : ''}）`;
    const list = document.createElement('ol');
    for (const r of rows) {
      const li = document.createElement('li');
      const who = r.fast.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? `プレイヤー${p + 1}`));
      const title = who.length ? `いちばん速く正解: ${who.join('・')}（${secText(r.ms)}）` : '正解した人はいませんでした';
      li.innerHTML = `<span class="kj-rv-n">${r.n}</span>`
        + (me !== null ? `<span class="kj-rv-mark" aria-label="${r.mark === '⭕' ? '正解' : 'まちがい'}">${r.mark}</span>` : '')
        + `<span class="kj-rv-word">${esc(r.word)}</span><span class="kj-rv-yomi">${esc(r.mean)}</span>`
        + `<span class="kj-rv-who" title="${esc(title)}">${who.length ? '⚡' + esc(who.join('・')) : '―'}</span>`;
      list.append(li);
    }
    box.append(sum, list);
    return box;
  },

  // 意味当ての4つのボタン（2×2）。答えたあと・答えを見せる場面では押せない形にして、○×を付ける
  choiceGrid(s, me, o, key, limit, note) {
    const grid = document.createElement('div');
    grid.className = 'kj-choices';
    grid.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 10px; touch-action: manipulation;';
    const right = s.qs[s.q][1];
    const shown = s.phase !== 'open';
    const mine = me !== null && s.tries[me] ? s.said[me] : null;
    const canPick = s.phase === 'open' && me !== null && !doneOf(s, me);
    const btns = s.opts[s.q].map((text) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn secondary kj-choice';
      b.style.cssText = 'min-height: 64px; padding: 10px 6px; border-radius: 12px; font-size: 1.1rem; overflow-wrap: anywhere; line-height: 1.3;';
      const ok = text === right && (shown || mine === right);
      const ng = text === mine && text !== right;
      b.textContent = (ok ? '○ ' : ng ? '× ' : '') + text;
      if (ok) b.style.cssText += 'background: #2f8a4a; border-color: #2f8a4a; color: #fff;';
      else if (ng) b.style.cssText += 'background: #d9534f; border-color: #d9534f; color: #fff;';
      else if (!canPick) b.style.cssText += 'opacity: .55;';
      b.disabled = !canPick;
      b.onclick = () => {
        const ms = Math.round(since(key));
        if (ui.sent || ms >= limit) return;
        ui.sent = text;
        for (const x of btns) x.disabled = true;
        o.onMove({ t: 'try', q: s.q, text, ms, n: 1 });
      };
      return b;
    });
    grid.append(...btns);
    if (canPick) {
      setTimeout(() => {
        if (!grid.isConnected) return;
        for (const x of btns) x.disabled = true;
        note.textContent = '時間切れ！';
      }, Math.max(0, limit - since(key)));
    }
    return grid;
  },

  note(s, me) {
    const note = ui?.note;
    if (!note) return;
    if (s.phase === 'open') {
      const someone = s.solved.some((v) => v !== null);
      if (me !== null && s.solved[me] !== null) note.textContent = `正解！（${secText(s.solved[me])}）ほかの人を待っています`;
      else if (me !== null && s.passed[me]) note.textContent = 'パスしました。ほかの人を待っています';
      else if (me !== null && s.tries[me] && s.said[me]) note.textContent = `${s.opts ? '× ' : ''}「${s.said[me]}」はちがいます${s.opts ? '（この問題はもう答えられません）' : ''}${someone ? '（ほかの人が正解しました。5秒で締め切り）' : ''}`;
      else if (someone) note.textContent = 'ほかの人が正解しました。5秒で締め切り！ 正解すれば点がもらえます';
      else if (me === null) note.textContent = '観戦中';
      else note.textContent = s.opts ? '4つから1つ選んでください（答えられるのは1回だけ）' : '大文字・小文字はどちらでも大丈夫です';
    } else if (s.phase === 'shown' && s.last) {
      note.textContent = s.last.winners.length ? '' : '正解した人はいませんでした';
    } else {
      note.textContent = '';
    }
  },
};
