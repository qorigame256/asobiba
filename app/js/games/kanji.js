// 難読漢字の読み当て。全員に同じ漢字が出て、ひらがなで読みを打ち込む。いちばん速く正解した人に1点。10問。
// 何度でも答え直せる。誰かが正解したら、少し待って締め切る（ほかの人の正解が通信で遅れて届く分を待つ）。
// 速さは各自の端末で「画面に出てから正解を送るまで」を測る（party.js の since）。
//
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open →（正解が出たら1.5秒 / 制限時間）→ close → shown → next …
// 詳細設定「ヒント」（2026-10-06 本人の決定。最初はなし）: 制限時間の4割（25秒なら10秒）がたつと、読みの1文字目を見せる。
//   見せるだけなので手の一覧には入れず、各自の端末で「画面に出てから」の時間で出す（Claude の判断）。読みが2つ以上あるときは最初の読みの1文字目。
// 詳細設定「答え方」（2026-10-06 本人の決定。最初は 打ち込む）: 4つから選ぶ では、読みを打たずに4つのボタンから1つ選ぶ。
//   正しい読み（最初の読み）のほかの3つは、同じ難しさのほかの問題の読みから文字数の近いものを選ぶ（choicesOf。種と何問目かから作るので全員同じ）。
//   答えられるのは1問に1回だけ（何度も試せると当てずっぽうで取れるため）。全員が答えたら、正解がいなくても1.5秒待って締め切る。
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'try', q: 問題番号, text: 答え, ms, n: その問題で何回目の答えか }

import { mulberry32, shuffle } from './util.js';
import { since, kana, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { KANJI } from './kanji-data.js';

const TOTAL = 10;
const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 1500;
const HINT_AT = 0.4; // ヒント（詳細設定）を出すのは、制限時間のこの割合がたったとき
const LEVELS = { easy: 'ふつう', hard: 'むずかしい', expert: '超むずかしい', mix: 'ぜんぶまぜる' };
const CPU_RATE = { easy: 0.55, hard: 0.4, expert: 0.3, mix: 0.4 };
const CHOICES = 4; // 答え方「4つから選ぶ」のボタンの数

const limitOf = (s) => Number(s.rules.time) * 1000;
const qKey = (s, q = s.q) => `kanji:${s.seed}:${q}`;
const poolOf = (level) => (level === 'mix' ? [...KANJI.easy, ...KANJI.hard, ...KANJI.expert] : KANJI[level] ?? KANJI.easy);
export const isRight = (yomis, text) => yomis.includes(kana(text));

// 答え方「4つから選ぶ」の4つの読み。正しい読みは最初の読み。ほかの3つは、その漢字と同じ難しさのほかの問題の最初の読みから、
// 答えと同じ読み・同じ読みどうしを除いて、文字数の近いものを選ぶ。並べ方とまちがいの選び方は種と何問目かだけで決まる
export function choicesOf(seed, q, [word, yomis]) {
  const rnd = mulberry32((Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(q + 1, 0x85ebca6b)) >>> 0);
  const level = Object.keys(KANJI).find((l) => KANJI[l].some(([w]) => w === word)) ?? 'easy';
  const ans = yomis[0];
  const len = [...ans].length;
  const used = new Set(yomis);
  const others = [];
  for (const [w, ys] of shuffle(KANJI[level], rnd)) {
    if (w === word || used.has(ys[0])) continue;
    used.add(ys[0]);
    others.push(ys[0]);
  }
  // 文字数の差が小さい順（同じ差の中はまぜた順のまま）
  others.sort((a, b) => Math.abs([...a].length - len) - Math.abs([...b].length - len));
  return shuffle([ans, ...others.slice(0, CHOICES - 1)], rnd);
}

const clone = (s) => ({ ...s, scores: s.scores.slice(), tries: s.tries.slice(), solved: s.solved.slice(), said: s.said.slice() });

/* ---------- 画面 ---------- */

// 答えを打っている途中に描き直しが来ても入力欄を作り直さない（作り直すとスマホのキーボードが閉じる）
let ui = null; // { mount, wrap, form, input, note, chips, card, n }
const cpuPlan = new Map();

export default {
  id: 'kanji',
  name: '難読漢字',
  icon: '🈂️',
  desc: '読めそうで読めない漢字の読みを、いちばん先に当てた人が1点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: '難しさ', desc: '出る漢字の難しさ', def: 'easy', choices: Object.entries(LEVELS) },
    { key: 'time', label: '制限時間', desc: '1問あたりの時間', def: '25', choices: [['15', '15秒'], ['25', '25秒'], ['40', '40秒']] },
    { key: 'hint', label: 'ヒント', desc: '制限時間の4割（25秒なら10秒）がたつと、読みの1文字目を見せる', def: false },
    { key: 'choice', label: '答え方', desc: '読みを打ち込むか、4つの読みから選ぶか（選ぶときは1問に1回だけ）', def: false, choices: [[false, '打ち込む'], [true, '4つから選ぶ']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { level: 'easy', time: '25', hint: false, choice: false, ...rules };
    const qs = shuffle(poolOf(r.level), mulberry32(seed)).slice(0, TOTAL);
    return {
      n, seed, rules: r, qs, q: -1, phase: 'ready',
      tries: Array(n).fill(0), solved: Array(n).fill(null), said: Array(n).fill(''), scores: Array(n).fill(0), last: null, step: 0,
      ...(r.choice ? { opts: qs.map((x, i) => choicesOf(seed, i, x)) } : {}), // 4つから選ぶときの各問題の4つの読み
    };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  // 効果音（sound.js の名前）。a = 前の局面、b = 今の局面、m = 打たれた手、me = 自分の番号
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : b.last.winners.includes(me) ? 'correct' : 'pop';
    if (m.p === me) return b.solved[me] !== null ? 'correct' : 'wrong';
    return b.solved[m.p] !== null ? 'pop' : null; // ほかの人が正解したときだけ
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `第${s.q + 1}問 / ${TOTAL}`;
    return `第${s.q + 1}問の答え`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.solved.some((v) => v !== null)) return { key: 'solved' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      if (s.opts && s.tries.every((v) => v > 0)) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } }; // 4つから選ぶ: 全員が答えた
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
        if (s.q + 1 >= TOTAL) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.tries = Array(s.n).fill(0);
        s.solved = Array(s.n).fill(null);
        s.said = Array(s.n).fill('');
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const times = s.solved.filter((v) => v !== null);
        const best = times.length ? Math.min(...times) : null;
        const winners = best === null ? [] : s.solved.map((v, p) => (v === best ? p : -1)).filter((p) => p >= 0);
        for (const p of winners) s.scores[p] += 1;
        s.last = { winners, best };
        return s;
      }
      return null;
    }
    if (m.t !== 'try' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (typeof m.text !== 'string' || !m.text || m.text.length > 30) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > limitOf(s0) + 500) return null;
    if (m.n !== s0.tries[m.p] + 1 || s0.solved[m.p] !== null) return null;
    if (s0.opts && (s0.tries[m.p] > 0 || !s0.opts[s0.q].includes(m.text))) return null; // 4つから選ぶ: 1回だけ・4つのどれか
    const s = clone(s0);
    s.step += 1;
    s.tries[m.p] = m.n;
    s.said[m.p] = m.text;
    if (isRight(s.qs[s.q][1], m.text)) s.solved[m.p] = m.ms;
    return s;
  },

  // CPU: 難しさに応じた確率で、4秒〜制限時間の7割のあいだに正解する。正解しないときは何も答えない
  // （4つから選ぶときは、正解しない分は同じ時刻に4つから適当に選ぶ。たまたま当たることもある）
  cpuDelay(s) { return s.phase === 'open' ? 250 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.solved[p] !== null) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      plan = { at: 4000 + Math.random() * (limitOf(s) * 0.7 - 4000), ok: Math.random() < (CPU_RATE[s.rules.level] ?? 0.4), done: false };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    if (plan.done || t < plan.at) return null;
    plan.done = true;
    const ms = Math.round(t);
    if (s.opts) {
      if (s.tries[p]) return null;
      const opts = s.opts[s.q];
      return { t: 'try', q: s.q, text: plan.ok ? s.qs[s.q][1][0] : opts[Math.floor(Math.random() * opts.length)], ms, n: 1 };
    }
    if (!plan.ok) return null;
    return { t: 'try', q: s.q, text: s.qs[s.q][1][0], ms, n: s.tries[p] + 1 };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    // 4つから選ぶときは、自分が答えたら（○×を付けるため）作り直す
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && s.solved[me] !== null}${s.opts && me !== null ? ':' + s.tries[me] : ''}`;
    const shown = s.phase === 'shown' || s.phase === 'end';
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? '<span class="pt-ok">正解！</span>' : '';
      if (!shown || !s.last || s.q < 0) return '';
      if (s.last.winners.includes(p)) return `<span class="pt-ok">○ ${secText(s.solved[p])} +1</span>`;
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])}</span>`;
      return s.tries[p] ? '<span class="pt-ng">×</span>' : '<span class="pt-ng">―</span>';
    };
    const chips = scoreChips(o, s.scores, { won, extra });

    // 同じ問題・同じ場面なら、点数の札と案内だけ差し替える
    if (ui?.mount === mount && root.contains(ui.wrap)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      this.note(s, me);
      return;
    }

    root.innerHTML = '';
    root.className = 'board kj';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    ui = { mount, wrap, chips, n: 0 };
    wrap.append(chips);

    const card = document.createElement('div');
    card.className = 'kj-card';
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">難しさ: ${LEVELS[s.rules.level] ?? ''}・1問 ${s.rules.time}秒</div>`;
      wrap.append(card);
      root.append(wrap);
      return;
    }
    const [word, yomis] = s.qs[s.q];
    const key = qKey(s);
    const limit = limitOf(s);
    card.innerHTML = `<div class="kj-num">第${s.q + 1}問 / ${TOTAL}</div><div class="kj-word"></div>`;
    card.querySelector('.kj-word').textContent = word;
    if (s.phase === 'open') {
      since(key); // 画面に出た時刻を覚える
      card.append(timeBar(key, limit));
      if (s.rules.hint) {
        const hint = document.createElement('div');
        hint.className = 'kj-hint';
        card.append(hint);
        setTimeout(() => {
          if (hint.isConnected) hint.textContent = `ヒント: 「${[...yomis[0]][0]}」から始まる`;
        }, Math.max(0, limit * HINT_AT - since(key)));
      }
    } else {
      const ans = document.createElement('div');
      ans.className = 'kj-answer';
      ans.textContent = `読み: ${yomis.join('／')}`;
      card.append(ans);
    }
    wrap.append(card);

    const note = document.createElement('p');
    note.className = 'cc-log';
    ui.note = note;

    if (s.opts && s.q >= 0) {
      wrap.append(this.choiceGrid(s, me, o, key, limit, note));
    } else if (s.phase === 'open' && me !== null && s.solved[me] === null) {
      const form = document.createElement('form');
      form.className = 'kj-form';
      form.innerHTML = '<input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send" maxlength="30" placeholder="ひらがなで（送りがなも）"><button type="submit" class="btn primary">答える</button>';
      const input = form.querySelector('input');
      form.onsubmit = (e) => {
        e.preventDefault();
        const text = input.value.trim();
        const ms = Math.round(since(key));
        if (!text || ms >= limit) return;
        const now = Math.max(ui.n, s.tries[me]) + 1;
        ui.n = now;
        ui.sent = text;
        input.value = '';
        o.onMove({ t: 'try', q: s.q, text, ms, n: now });
      };
      ui.form = form;
      ui.input = input;
      wrap.append(form);
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
    // スマホは勝手にキーボードを出さない。「ゲームを変える」の一覧を開いているときも取り上げない（一覧が閉じる）
    if (ui.input && !matchMedia('(pointer: coarse)').matches && document.activeElement?.tagName !== 'SELECT') ui.input.focus();
  },

  // 答え方「4つから選ぶ」の4つのボタン（2×2）。答えたあと・答えを見せる場面では押せない形にして、○×を付ける
  choiceGrid(s, me, o, key, limit, note) {
    const grid = document.createElement('div');
    grid.className = 'kj-choices';
    grid.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 10px; touch-action: manipulation;';
    const right = s.qs[s.q][1][0];
    const shown = s.phase !== 'open';
    const mine = me !== null && s.tries[me] ? s.said[me] : null;
    const canPick = s.phase === 'open' && me !== null && !s.tries[me];
    const btns = s.opts[s.q].map((text) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn secondary kj-choice';
      // .board button.btn は丸い小さめのボタンなので、押しやすい大きさの四角にする
      b.style.cssText = 'min-height: 64px; padding: 10px 6px; border-radius: 12px; font-size: 1.2rem; overflow-wrap: anywhere; line-height: 1.3;';
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

  // 入力欄の下の案内
  note(s, me) {
    const note = ui?.note;
    if (!note) return;
    if (s.phase === 'open') {
      const someone = s.solved.some((v) => v !== null);
      if (me !== null && s.solved[me] !== null) note.textContent = `正解！（${secText(s.solved[me])}）ほかの人を待っています`;
      else if (me !== null && s.tries[me] && s.said[me]) note.textContent = `${s.opts ? '× ' : ''}「${s.said[me]}」はちがいます${s.opts ? '（この問題はもう答えられません）' : ''}${someone ? '（ほかの人が正解しました。まもなく締め切り）' : ''}`;
      else if (someone) note.textContent = 'ほかの人が正解しました。まもなく締め切り！';
      else if (me === null) note.textContent = '観戦中';
      else note.textContent = s.opts ? '4つから1つ選んでください（答えられるのは1回だけ）' : 'カタカナで打っても大丈夫です';
    } else if (s.phase === 'shown' && s.last) {
      note.textContent = s.last.winners.length ? '' : '正解した人はいませんでした';
    } else {
      note.textContent = '';
    }
  },
};
