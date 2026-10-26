// タイピング早打ち。全員に同じお題（漢字まじりの文と、その読み）が出て、いちばん速く正しく打った人から 3・2・1点。10問。
// 正解になるのは、読みをひらがな・カタカナで打ったもの、または表示どおりの漢字まじり（空白・記号は無視。party.js の kana）。
// 打っている途中で正しくなったら自動で送る（送るのは正解だけ。まちがいは手元で知らせるだけで、何度でも打ち直せる）。
// 1〜3問目は短い言葉、4〜7問目はことわざなど、8〜10問目は長い文（typing-data.js）。詳細設定「お題の種類」で1種類だけにもできる（KINDS）。
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
// 詳細設定「お題の種類」（2026-10-06 本人の決定。最初は「まぜる」＝今までどおり短い言葉3・短いことわざなど4・長い文3）。
// ほかを選ぶと、その種類だけから10問（短い言葉 40・短いことわざと早口言葉 35・長いことわざと早口言葉 19 の中から）。制限時間は今までどおり読みの長さで決まる。
const KINDS = [['mix', 'まぜる（短い → 長い）'], ['short', '短い言葉だけ'], ['mid', '短いことわざ・早口言葉だけ'], ['long', '長いことわざ・早口言葉だけ']];
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
let ui = null; // { base, wrap, chips, card, note, form, input, mount, cur, sentQ, last, paint }
const PREDICT_JUMP = 3; // 1回の入力でこれだけ増えたら予測変換と見る

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
    { key: 'kind', label: 'お題の種類', desc: '出るお題の長さ。打つのが速い人どうしなら長い文、子どもと遊ぶなら短い言葉', def: 'mix', choices: KINDS },
    { key: 'time', label: '制限時間', desc: '1問あたりの時間（長い文ほど長くなる）', def: 'normal', choices: [['short', '短め'], ['normal', 'ふつう'], ['long', '長め']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { time: 'normal', kind: 'mix', ...rules };
    const rnd = mulberry32(seed);
    const qs = TYPING[r.kind]
      ? shuffle(TYPING[r.kind], rnd).slice(0, TOTAL)
      : ['short', 'mid', 'long'].flatMap((lv) => shuffle(TYPING[lv], rnd).slice(0, COUNT[lv]));
    return { n, seed, rules: r, qs, q: -1, phase: 'ready', solved: Array(n).fill(null), scores: Array(n).fill(0), last: null, step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && s.solved[p] === null; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : (b.last.pts[me] ?? 0) === 3 ? 'correct' : 'pop';
    if (m.p === me) return 'correct';
    return 'pop'; // ほかの人の正解（2026-10-26 本人の依頼。前は鳴らさなかった）
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

  // 2026-10-26 本人の依頼で組み直した:
  //   キーボードを開きっぱなしに: 入力欄は対局の間ずっと同じものを使い、問題が変わっても作り直さない・隠さない・押せなくしない（正解のあとと締め切りのあとは readOnly）。
  //     スマホは入力欄が消えたり押せなくなったりするとキーボードが閉じるため。
  //   打ち終わりの秒数を正解したらすぐ出す（点数の札の「正解！ 2.34秒」）。
  //   予測変換が強すぎる: 1回の入力で3文字以上増えたら予測変換（候補から選んだ）と見て、入れる前に戻す（PREDICT_JUMP。Claude の判断。
  //     ふつうに打つと1回に増えるのは1〜2文字。漢字に変換すると文字は減るので引っかからない。貼り付けも同じく戻る）。
  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const shown = s.phase === 'shown' || s.phase === 'end';
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? `<span class="pt-ok">正解！ ${secText(s.solved[p])}</span>` : '';
      if (!shown || !s.last || s.q < 0) return '';
      if (s.solved[p] === null) return '<span class="pt-ng">―</span>';
      const pt = s.last.pts[p];
      return `<span class="pt-ok">${secText(s.solved[p])}${pt ? ' +' + pt : ''}</span>`;
    };
    const chips = scoreChips(o, s.scores, { won, extra });

    // 対局（種）と自分の席が同じなら、入れ物と入力欄はそのまま使う
    const base = `${s.seed}:${me}`;
    if (ui?.base === base && root.contains(ui.wrap)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
    } else {
      root.innerHTML = '';
      root.className = 'board kj';
      const wrap = document.createElement('div');
      wrap.className = 'kj-wrap';
      const card = document.createElement('div');
      card.className = 'kj-card';
      const note = document.createElement('p');
      note.className = 'cc-log';
      wrap.append(chips, card);
      ui = { base, wrap, chips, card, note, mount: null, form: null, input: null, cur: null, sentQ: -1, last: '' };
      if (me !== null) {
        const form = document.createElement('form');
        form.className = 'kj-form';
        form.innerHTML = '<input type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" maxlength="80" placeholder="ここに打つ"><button type="submit" class="btn primary">送る</button>';
        const input = form.querySelector('input');
        const btn = form.querySelector('button');
        btn.addEventListener('mousedown', (e) => e.preventDefault()); // 押しても入力欄から外れない（キーボードを閉じない）
        input.oninput = () => {
          const grew = [...input.value].length - [...ui.last].length;
          if (grew >= PREDICT_JUMP) {
            input.value = ui.last;
            ui.note.textContent = '予測変換（候補から選ぶ）は使えません。1文字ずつ打ってください';
            return;
          }
          ui.last = input.value;
          ui.paint?.(input.value);
          trySend(false);
        };
        form.onsubmit = (e) => { e.preventDefault(); trySend(true); };
        ui.form = form;
        ui.input = input;
        wrap.append(form);
      }
      wrap.append(note);
      root.append(wrap);
    }

    // 場面（何問目・どの段階・自分が正解したか）が変わったら、お題の札と入力欄の状態を替える
    const mine = me !== null && s.solved[me] !== null;
    const mount = `${s.q}:${s.phase}:${mine}`;
    ui.cur = { s, o, me };
    if (ui.mount !== mount) {
      const newQ = !ui.mount || ui.mount.split(':')[0] !== String(s.q);
      ui.mount = mount;
      this.card(s, me);
      if (ui.input) {
        if (newQ) { ui.input.value = ''; ui.last = ''; ui.note.textContent = ''; }
        ui.input.readOnly = !(s.phase === 'open' && !mine);
        ui.form.querySelector('button').disabled = ui.input.readOnly;
        ui.form.hidden = s.phase === 'end'; // 終わったら隠す（もうキーボードは要らない）
        if (s.phase === 'open' && !mine) {
          const q = s.q;
          const key = qKey(s);
          setTimeout(() => {
            if (!ui?.input || ui.cur.s.q !== q || ui.cur.s.phase !== 'open' || ui.sentQ === q) return;
            ui.input.readOnly = true;
            ui.form.querySelector('button').disabled = true;
            ui.note.textContent = '時間切れ！';
          }, Math.max(0, limitOf(s) - since(key)));
        }
      }
    }
    this.note(s, me);
    // スマホは勝手にキーボードを出さない（最初に入力欄を押してもらえば、そのあとは開いたまま）。「ゲームを変える」の一覧を開いているときも取り上げない（一覧が閉じる）
    if (ui.input && !ui.input.readOnly && !matchMedia('(pointer: coarse)').matches && document.activeElement?.tagName !== 'SELECT') ui.input.focus();

    function trySend(byEnter) {
      const { s: cur, o: co } = ui.cur;
      if (cur.phase !== 'open' || ui.sentQ === cur.q || ui.input.readOnly) return;
      const text = ui.input.value;
      const ms = Math.round(since(qKey(cur)));
      if (ms > limitOf(cur)) return;
      if (isRight(cur.qs[cur.q], text)) {
        ui.sentQ = cur.q;
        ui.input.readOnly = true;
        co.onMove({ t: 'type', q: cur.q, text: text.slice(0, 80), ms });
      } else if (byEnter && text.trim()) {
        ui.note.textContent = 'ちがうところがあります。直してください';
      }
    }
  },

  // お題の札（漢字まじりの文・読み・残り時間）
  card(s, me) {
    const card = ui.card;
    ui.paint = null;
    if (s.phase === 'ready') {
      card.innerHTML = '<div class="kj-word small">よーい…</div><div class="kj-sub">ひらがなでも漢字でも、正しく打てたら自動で送られます。入力欄を一度押しておくと、キーボードが出たままになります</div>';
      return;
    }
    const [word, yomis] = s.qs[s.q];
    const key = qKey(s);
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
    paintYomi(s.phase === 'open' && ui.input ? ui.input.value : '');
    if (s.phase === 'open') {
      ui.paint = paintYomi;
      since(key); // 画面に出た時刻を覚える
      card.append(timeBar(key, limitOf(s)));
    }
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
