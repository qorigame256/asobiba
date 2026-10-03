// ウミガメのスープ。部屋の1人が出題者になり、ほかの人は順番に「はい・いいえ」で答えられる質問をして、話の真相を当てる。
// 自分の番には「質問」「解答」「パス」のどれか1つ。出題者は質問に「はい・いいえ・関係ない」で答え、解答の正誤を決める。
// 外しても続けられ、いちばん先に当てた人の勝ち。出題者は「答えを明かして終わる」こともできる。
// 出題者は対局ごとに交代（これまで出題者をした回数がいちばん少ない人。同じ顔ぶれで続けたときに引き継ぐ）。
// CPU は入れない（質問も判定もできないため）。部屋を出た人の番は自動でパス、出題者が出たら答えを明かして終わる。
// 手: { p, t: 'pick', idx } / { p, t: 'custom', q, a } / { p, t: 'ask' | 'guess', text } / { p, t: 'pass' }
//     / { p, t: 'reply', r: 'yes' | 'no' | 'na' } / { p, t: 'judge', ok } / { p, t: 'reveal' }

import { esc } from './util.js';
import { PUZZLES } from './umigame-data.js';

const MAX_TEXT = 120;
const MAX_PUZZLE = 300;
export const REPLY = { yes: 'はい', no: 'いいえ', na: '関係ありません' };

const okText = (t, max) => typeof t === 'string' && t.trim().length > 0 && t.length <= max;

function nextAsker(s, from) {
  let p = from;
  do { p = (p + 1) % s.n; } while (p === s.setter);
  return p;
}

const clone = (s) => ({ ...s, log: s.log.slice() });

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
  minPlayers: 2,
  maxPlayers: 10,

  init(n, seed, { prev = null } = {}) {
    const counts = Array.isArray(prev) && prev.length === n ? prev.slice() : Array(n).fill(0);
    const low = Math.min(...counts);
    const setter = counts.indexOf(low);
    return { n, seed, counts, setter, phase: 'pick', puzzle: null, turn: nextAsker({ n, setter }, setter), pending: null, log: [], winner: null, step: 0 };
  },

  turn(s) {
    if (s.phase === 'ask') return s.turn;
    if (s.phase === 'pick' || s.phase === 'reply') return s.setter;
    return null;
  },
  canAct(s, p) {
    if (s.phase === 'end') return false;
    return p === s.setter || (s.phase === 'ask' && p === s.turn);
  },
  result(s) { return s.phase === 'end' ? { winner: s.winner } : null; },
  resultText(res, me, pn) {
    if (res.winner === null) return '出題者が答えを明かしました';
    return res.winner === me ? 'あなたが真相を当てた！🎉' : `${pn(res.winner)}が真相を当てた！`;
  },
  carry(s, p) { return s.counts[p] + (p === s.setter ? 1 : 0); },

  apply(s0, m) {
    if (!m || !this.canAct(s0, m.p)) return null;
    const isSetter = m.p === s0.setter;
    const s = clone(s0);
    s.step += 1;
    switch (m.t) {
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
        s.pending = { p: m.p, kind: m.t, text: m.text.trim() };
        s.phase = 'reply';
        return s;
      case 'pass':
        if (s.phase !== 'ask' || m.p !== s.turn) return null;
        s.log.push({ p: m.p, kind: 'pass' });
        s.turn = nextAsker(s, s.turn);
        return s;
      case 'reply':
        if (!isSetter || s.phase !== 'reply' || s.pending.kind !== 'ask' || !REPLY[m.r]) return null;
        s.log.push({ ...s.pending, r: m.r });
        s.pending = null;
        s.phase = 'ask';
        s.turn = nextAsker(s, s.turn);
        return s;
      case 'judge':
        if (!isSetter || s.phase !== 'reply' || s.pending.kind !== 'guess' || typeof m.ok !== 'boolean') return null;
        s.log.push({ ...s.pending, ok: m.ok });
        s.pending = null;
        if (m.ok) { s.phase = 'end'; s.winner = s.log[s.log.length - 1].p; return s; }
        s.phase = 'ask';
        s.turn = nextAsker(s, s.turn);
        return s;
      case 'reveal':
        if (!isSetter) return null;
        s.phase = 'end';
        s.winner = null;
        return s;
      default:
        return null;
    }
  },

  // CPU は入らないので、ここに来るのは部屋を出た人の席だけ
  cpuDelay() { return 1500; },
  cpu(s, p) { return p === s.setter ? { t: 'reveal' } : { t: 'pass' }; },

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
      if (o.away[p] || (o.cpu[p] && !o.names[p].startsWith('CPU'))) {
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
      card.innerHTML = `<div class="um-label">問題</div><p class="um-q">${esc(s.puzzle.q)}</p>`;
      top.append(card);
      if (isSetter || s.phase === 'end') {
        const ans = document.createElement('details');
        ans.className = 'um-answer';
        ans.open = s.phase === 'end' || !!ui.answerOpen;
        ans.ontoggle = () => { ui.answerOpen = ans.open; };
        ans.innerHTML = `<summary>${s.phase === 'end' ? '真相' : '答え（あなただけに見えます）'}</summary><p>${esc(s.puzzle.a)}</p>`;
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
        else if (e.kind === 'ask') li.innerHTML = `${who}: ${esc(e.text)} <span class="um-r ${e.r}">${REPLY[e.r]}</span>`;
        else li.innerHTML = `${who}（解答）: ${esc(e.text)} <span class="um-r ${e.ok ? 'yes' : 'no'}">${e.ok ? '正解！' : 'ちがいます'}</span>`;
        list.append(li);
      }
      top.append(list);
    }
    if (s.pending) {
      const p = document.createElement('p');
      p.className = 'um-pending';
      p.innerHTML = `<b>${esc(nameP(s.pending.p))}</b>${s.pending.kind === 'guess' ? 'の解答' : 'の質問'}: ${esc(s.pending.text)}`;
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
      } else {
        note(`${nameP(s.setter)}が問題を選んでいます…`);
      }
    } else if (s.phase === 'ask') {
      if (me === s.turn && o.canMove) {
        note('「はい・いいえ」で答えられる質問をするか、真相が分かったら「答えを言う」');
        const t = textArea('ask', '例: 男は泣いていましたか？', MAX_TEXT);
        act.append(t);
        const send = (kind) => () => {
          if (!t.value.trim()) return;
          draft.ask = '';
          o.onMove({ t: kind, text: t.value });
        };
        row(button('パス', 'secondary', () => o.onMove({ t: 'pass' })), button('答えを言う', 'secondary', send('guess')), button('質問する', 'primary', send('ask')));
      } else {
        note(`${nameP(s.turn)}が考えています…`);
      }
      if (isSetter) row(button('答えを明かして終わる', 'ghost', () => { if (confirm('答えを明かして終わりますか？')) o.onMove({ t: 'reveal' }); }));
    } else if (s.phase === 'reply') {
      if (isSetter) {
        if (s.pending.kind === 'ask') {
          note('質問に答えてください');
          row(button('はい', 'primary', () => o.onMove({ t: 'reply', r: 'yes' })),
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
