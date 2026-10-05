// タイピング早打ち。全員に同じお題（漢字まじりの文と、その読み）が出て、いちばん速く正しく打った人から 3・2・1点。10問。
// 正解になるのは、読みをひらがな・カタカナで打ったもの、または表示どおりの漢字まじり（空白・記号は無視。party.js の kana）。
// 打っている途中で正しくなったら自動で送る（送るのは正解だけ。まちがいは手元で知らせるだけで、何度でも打ち直せる）。
// 1〜3問目は短い言葉、4〜7問目はことわざなど、8〜10問目は長い文（typing-data.js）。
// 制限時間は読みの長さで決める: 8秒 ＋ 1文字 0.8秒 を、詳細設定の倍率（短め 0.7・ふつう 1・長め 1.5）でのばす。
// 締め切り: 全員か3人が正解したら1.5秒待って（通信で遅れて届く、もっと速い正解を待つ）、だれも届かなければ制限時間で。
//
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'type', q: 問題番号, text, ms }（1問に1人1度だけ。2回目は反則）

import { mulberry32, shuffle } from './util.js';
import { since, kana, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { TYPING } from './typing-data.js';

const TOTAL = 10;
const READY_MS = 3000;
const SHOWN_MS = 4000;
const GRACE_MS = 1500;
const LEVEL_OF = (q) => (q < 3 ? 'short' : q < 7 ? 'mid' : 'long');
const COUNT = { short: 3, mid: 4, long: 3 };
const SPEED = { short: 0.7, normal: 1, long: 1.5 };

const qKey = (s, q = s.q) => `typing:${s.seed}:${q}`;
const len = (yomis) => Math.min(...yomis.map((y) => y.length));
export const limitOf = (s, q = s.q) => Math.round((8000 + 800 * len(s.qs[q][1])) * (SPEED[s.rules.time] ?? 1));
export const isRight = ([word, yomis], text) => {
  const t = kana(text);
  return !!t && (t === kana(word) || yomis.some((y) => kana(y) === t));
};
// 打った文字が読みの先頭から何文字合っているか（読みの色付けに使う）
const matched = (yomi, text) => {
  const t = kana(text);
  let i = 0;
  while (i < t.length && i < yomi.length && t[i] === yomi[i]) i++;
  return i;
};

// 速さの順の点（1位3点・2位2点・3位1点。同じ時間は同じ順位。正解しなかった人は0点）
export function pointsOf(times) {
  return times.map((t) => (t === null ? 0 : Math.max(0, 3 - times.filter((u) => u !== null && u < t).length)));
}

const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice() });

const cpuPlan = new Map();
let ui = null; // { mount, wrap, chips, note, input, yomi }

export default {
  id: 'typing',
  name: 'タイピング早打ち',
  icon: '⌨️',
  desc: '出てきた言葉をいちばん速く正しく打った人から 3・2・1点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'time', label: '制限時間', desc: '1問あたりの時間（長い文ほど長くなる）', def: 'normal', choices: [['short', '短め'], ['normal', 'ふつう'], ['long', '長め']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { time: 'normal', ...rules };
    const rnd = mulberry32(seed);
    const qs = ['short', 'mid', 'long'].flatMap((lv) => shuffle(TYPING[lv], rnd).slice(0, COUNT[lv]));
    return { n, seed, rules: r, qs, q: -1, phase: 'ready', solved: Array(n).fill(null), scores: Array(n).fill(0), last: null, step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && s.solved[p] === null; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : (b.last.pts[me] ?? 0) === 3 ? 'correct' : 'pop';
    if (m.p === me) return 'correct';
    return null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `第${s.q + 1}問 / ${TOTAL}`;
    return `第${s.q + 1}問の結果`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      const done = s.solved.filter((v) => v !== null).length;
      if (done >= Math.min(3, s.n)) return { key: 'done' + s.q, ms: GRACE_MS, move: { t: 'close' } };
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
        s.solved = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pts = pointsOf(s.solved);
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { pts };
        return s;
      }
      return null;
    }
    if (m.t !== 'type' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (typeof m.text !== 'string' || m.text.length > 80 || !isRight(s0.qs[s0.q], m.text)) return null;
    if (typeof m.ms !== 'number' || !(m.ms > 0) || m.ms > limitOf(s0) + 500 || s0.solved[m.p] !== null) return null;
    const s = clone(s0);
    s.step += 1;
    s.solved[m.p] = Math.round(m.ms);
    return s;
  },

  // CPU: 85% の確率で、1.5〜2.5秒 ＋ 読み1文字 0.45〜0.7秒 で打ち終わる（制限時間の9割まで）。打てないときは何もしない
  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.solved[p] !== null) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const at = 1500 + Math.random() * 1000 + len(s.qs[s.q][1]) * (450 + Math.random() * 250);
      plan = { at: Math.min(at, limitOf(s) * 0.9), ok: Math.random() < 0.85 };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    if (!plan.ok || since(qKey(s)) < plan.at) return null;
    return { t: 'type', q: s.q, text: s.qs[s.q][1][0], ms: Math.round(plan.at) };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const shown = s.phase === 'shown' || s.phase === 'end';
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? '<span class="pt-ok">正解！</span>' : '';
      if (!shown || !s.last || s.q < 0) return '';
      if (s.solved[p] === null) return '<span class="pt-ng">―</span>';
      const pt = s.last.pts[p];
      return `<span class="pt-ok">${secText(s.solved[p])}${pt ? ' +' + pt : ''}</span>`;
    };
    const chips = scoreChips(o, s.scores, { won, extra });
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && s.solved[me] !== null}`;
    // 同じ問題・同じ場面なら、点数の札だけ差し替える（入力欄を作り直すとスマホのキーボードが閉じる）
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
    wrap.append(chips);
    ui = { mount, wrap, chips };
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    root.append(wrap);

    if (s.phase === 'ready') {
      card.innerHTML = '<div class="kj-word small">よーい…</div><div class="kj-sub">ひらがなでも漢字でも、正しく打てたら自動で送られます</div>';
      return;
    }
    const [word, yomis] = s.qs[s.q];
    const key = qKey(s);
    const limit = limitOf(s);
    card.innerHTML = `<div class="kj-num">第${s.q + 1}問 / ${TOTAL}</div><div class="ty-word"></div><div class="ty-yomi"></div>`;
    card.querySelector('.ty-word').textContent = word;
    const yomiEl = card.querySelector('.ty-yomi');
    const yomi = yomis[0];
    if (kana(word) === kana(yomi)) yomiEl.hidden = true; // ひらがなだけのお題は読みを出さない
    const paintYomi = (text) => {
      const k = matched(kana(yomi), text);
      yomiEl.innerHTML = '';
      const ok = document.createElement('span');
      ok.className = 'ty-ok';
      ok.textContent = yomi.slice(0, k);
      yomiEl.append(ok, yomi.slice(k));
    };
    paintYomi('');
    if (s.phase === 'open') {
      since(key); // 画面に出た時刻を覚える
      card.append(timeBar(key, limit));
    }

    const note = document.createElement('p');
    note.className = 'cc-log';
    ui.note = note;

    if (s.phase === 'open' && me !== null && s.solved[me] === null) {
      const form = document.createElement('form');
      form.className = 'kj-form';
      form.innerHTML = '<input type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" maxlength="80" placeholder="ここに打つ"><button type="submit" class="btn primary">送る</button>';
      const input = form.querySelector('input');
      let sent = false;
      const trySend = (byEnter) => {
        if (sent) return;
        const text = input.value;
        const ms = Math.round(since(key));
        if (ms > limit) return;
        if (isRight(s.qs[s.q], text)) {
          sent = true;
          input.disabled = true;
          o.onMove({ t: 'type', q: s.q, text: text.slice(0, 80), ms });
        } else if (byEnter && text.trim()) {
          note.textContent = 'ちがうところがあります。直してください';
        }
      };
      input.oninput = () => { paintYomi(input.value); trySend(false); };
      form.onsubmit = (e) => { e.preventDefault(); trySend(true); };
      ui.input = input;
      wrap.append(form);
      setTimeout(() => {
        if (!form.isConnected || sent) return;
        input.disabled = true;
        form.querySelector('button').disabled = true;
        note.textContent = '時間切れ！';
      }, Math.max(0, limit - since(key)));
    }
    wrap.append(note);
    this.note(s, me);
    // スマホは勝手にキーボードを出さない。「ゲームを変える」の一覧を開いているときも取り上げない（一覧が閉じる）
    if (ui.input && !matchMedia('(pointer: coarse)').matches && document.activeElement?.tagName !== 'SELECT') ui.input.focus();
  },

  // 入力欄の下の案内
  note(s, me) {
    const note = ui?.note;
    if (!note) return;
    if (s.phase === 'open') {
      if (me !== null && s.solved[me] !== null) note.textContent = `正解！（${secText(s.solved[me])}）ほかの人を待っています`;
      else if (me === null) note.textContent = '観戦中';
      else if (!note.textContent) note.textContent = 'ひらがな・カタカナ・漢字のどれで打っても大丈夫です';
    } else if (s.phase === 'shown' && s.last) {
      note.textContent = s.last.pts.some((v) => v > 0) ? '' : '正解した人はいませんでした';
    } else {
      note.textContent = '';
    }
  },
};
