// お絵描き当て。2〜10人。CPU は入らない（絵を描いたり当てたりできないため）。
// 1人ずつ順番に描く人になり、お題の絵を描く。ほかの人は答えを文字で打ち込む。全員が1回ずつ描いたら終わり（2026-10-05 本人承認）。
// 答えはひらがなにそろえて自動で答え合わせする（カタカナ・漢字の書き方もお題ごとに正解にしてある）。外れた答えは全員に見える。
// 早く当てた人ほど点が高く、描いた人にも当てた人の数だけ点が入る（2026-10-05 本人承認）。
// 点数（Claude の判断）: 当てた人は 1番目 10点・2番目 8点・3番目 6点・それより後 5点。描いた人は当てた人1人につき3点。
// 1回の制限時間は詳細設定で 60／80（最初）／120秒。全員が当てるか時間が来たら、答えを5秒見せて次の人へ。描く人は「あきらめる」で早く終われる。
// お題は oekaki-data.js から対局の種で選ぶ（同じ対局で同じお題は出ない）。
// 詳細設定「お題を選ぶ」（2026-10-06 本人の決定。最初はなし）: 描く人の番の始めに3つのお題が出て、描く人が1つ選んでから描く
//   （場面 pick。ほかの人には「選んでいます」とだけ出す）。Claude の判断: 15秒で選ばなければ1つ目。選んでから制限時間が始まる。
//
// 描いた線は、ペンを動かしている間 0.5秒ごとに区切って「線」の手として送る（離れていても描いている途中が見えるように）。
// 座標は 0〜999（絵の左上が 0）を2文字ずつに縮めて送る（ENC）。手の一覧を毎回まるごと送る作りなので、送る量を小さくしたい。
// 手: { p, t: 'line', k, g: ひと筆の番号, c: 色, w: 太さ, d: 座標の文字列 } / { p, t: 'undo', k } / { p, t: 'clear', k } / { p, t: 'giveup', k }
//     （k = 描く人のこの回の手の数。同じ手が2回届いても2回目は反則になる）
//     { p, t: 'guess', n: その人のこの回の答えの数, text } / 進行役（p = -1）: { t: 'end', turn } / { t: 'next', turn }
//     { p: 描く人, t: 'pick', i: 0〜2 } / 進行役 { p: -1, t: 'pick', turn, i: 0 }（お題を選ぶ。詳細設定）

import { mulberry32, shuffle, esc } from './util.js';
import { kana, scoreChips, leaders, ranks, winnersText, timeBar } from './party.js';
import { TOPICS } from './oekaki-data.js';

export const COLORS = ['#2d2a26', '#e04b3c', '#2f6fb3', '#3a9d55', '#e8a913', '#8a5a35', '#ffffff'];
const COLOR_NAMES = ['黒', '赤', '青', '緑', '黄', '茶', '消しゴム'];
const WIDTHS = [6, 14, 34];
const SHOW_MS = 5000;
const MAX_TEXT = 20;
const MAX_D = 2400; // 1つの線の手の座標の文字数の上限（0.5秒ぶんには十分）
const GUESS_PT = [10, 8, 6];
const DRAWER_PT = 3;
const PICK_N = 3; // お題を選ぶ（詳細設定）ときの候補の数
const PICK_MS = 15000; // 選ぶ時間。過ぎたら1つ目

const ENC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function encode(pts) {
  return pts.map(([x, y]) => [x, y].map((v) => ENC[v >> 6] + ENC[v & 63]).join('')).join('');
}
export function decode(d) {
  const out = [];
  for (let i = 0; i + 3 < d.length; i += 4) {
    const v = (j) => ENC.indexOf(d[i + j]) * 64 + ENC.indexOf(d[i + j + 1]);
    out.push([v(0), v(2)]);
  }
  return out;
}
const validD = (d) => typeof d === 'string' && d.length >= 4 && d.length <= MAX_D && d.length % 4 === 0
  && [...d].every((ch) => ENC.includes(ch)) && decode(d).every(([x, y]) => x < 1000 && y < 1000);

// 答えの読み（ひらがなだけの書き方）。文字数のヒントに使う
function readingOf(topic) {
  for (const x of topic) {
    const k = kana(x);
    if (/^[ぁ-ゖー]+$/.test(k)) return k;
  }
  return kana(topic[0]);
}

const clone = (s) => ({ ...s, strokes: s.strokes.slice(), scores: s.scores.slice(), correct: s.correct.slice(), chat: s.chat.slice(), gn: s.gn.slice() });

function newTurn(s) {
  s.phase = s.cands ? 'pick' : 'draw';
  s.strokes = [];
  s.dn = 0;
  s.ver += 1;
  s.correct = [];
  s.chat = [];
  s.gn = Array(s.n).fill(0);
}

// お題を選んで描き始める（s は写し）
function pickTopic(s, i) {
  s.topics = s.topics.slice();
  s.topics[s.turn] = s.cands[s.turn][i];
  s.phase = 'draw';
  return s;
}

function endTurn(s, why) {
  s.phase = 'show';
  s.why = why;
  s.history.push({ drawer: s.turn, topic: s.topics[s.turn], correct: s.correct.slice() });
}

export default {
  id: 'oekaki',
  name: 'お絵描き当て',
  icon: '🎨',
  desc: '1人が絵を描き、ほかの人が何の絵かを当てる。早く当てるほど高い点。2人から',
  ready: true,
  multi: true,
  realtime: true,
  noCpu: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'pick', label: 'お題を選ぶ', desc: '描く人に3つのお題が出て、描きやすいものを選んでから描く（15秒で選ばなければ1つ目）', def: false },
    { key: 'time', label: '1回の制限時間', desc: '全員が当てたら、時間の前でも次へ進む', def: 80, choices: [[60, '60秒'], [80, '80秒'], [120, '120秒']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const order = shuffle(TOPICS.map((_, i) => i), mulberry32(seed));
    // お題を選ぶ（詳細設定）: 1回ごとに3つずつ（同じ対局で同じお題は出ない）。選ぶまでは1つ目
    const cands = rules.pick === true ? Array.from({ length: n }, (_, k) => order.slice(k * PICK_N, k * PICK_N + PICK_N)) : null;
    const s = {
      n, seed, cands, topics: cands ? cands.map((c) => c[0]) : order.slice(0, n), turn: 0, limit: [60, 80, 120].includes(rules.time) ? rules.time : 80,
      scores: Array(n).fill(0), history: [], ver: 0, why: null, step: 0,
    };
    newTurn(s);
    return s;
  },

  topic(s) { return TOPICS[s.topics[s.turn]]; },
  ended(s) { return s.turn >= s.n; },
  turn() { return null; },
  canAct(s, p) {
    if (this.ended(s) || p < 0 || p >= s.n) return false;
    if (s.phase === 'pick') return p === s.turn;
    if (s.phase !== 'draw') return false;
    return p === s.turn || !s.correct.includes(p);
  },
  referee(s) {
    if (this.ended(s)) return null;
    if (s.phase === 'pick') return { key: `pick:${s.turn}`, ms: PICK_MS, move: { t: 'pick', turn: s.turn, i: 0 } };
    if (s.phase === 'draw') return { key: `draw:${s.turn}`, ms: s.limit * 1000, move: { t: 'end', turn: s.turn } };
    return { key: `show:${s.turn}`, ms: SHOW_MS, move: { t: 'next', turn: s.turn } };
  },
  cpuDelay() { return 1500; },
  // CPU は入らないので、ここに来るのは部屋を出た人の席だけ。描く人が出たら、その回を終える
  cpu(s, p) {
    if (p !== s.turn) return null;
    if (s.phase === 'pick') return { t: 'pick', i: 0 };
    return s.phase === 'draw' ? { t: 'giveup', k: s.dn } : null;
  },
  sound(a, b, m, me) {
    if (m.t === 'guess') return b.correct.length > a.correct.length ? 'correct' : m.p === me ? 'wrong' : null;
    if (m.t === 'next') return b.turn === me ? 'turn' : 'pop';
    if (b.phase === 'show' && a.phase === 'draw') return 'question';
    return null;
  },

  result(s) {
    if (!this.ended(s)) return null;
    const winners = leaders(s.scores);
    const rk = ranks(s.scores);
    return { winner: winners[0], winners, ranking: Array.from({ length: s.n }, (_, p) => p).sort((a, b) => rk[a] - rk[b]) };
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s, me, pn) {
    const who = s.turn === me ? 'あなた' : pn(s.turn);
    if (s.phase === 'show') return `答え合わせ（${s.turn + 1}/${s.n}回目）`;
    if (s.phase === 'pick') return s.turn === me ? `お題を選んでください（${s.turn + 1}/${s.n}回目）` : `<b>${who}</b>がお題を選んでいます（${s.turn + 1}/${s.n}回目）`;
    if (s.turn === me) return `<b>あなた</b>が描く番です（${s.turn + 1}/${s.n}回目）`;
    return `<b>${who}</b>が描いています。何の絵か当ててください（${s.turn + 1}/${s.n}回目）`;
  },

  apply(s0, m) {
    if (!m || this.ended(s0)) return null;
    if (m.p === -1) {
      if (m.turn !== s0.turn) return null;
      const s = clone(s0);
      s.step += 1;
      if (m.t === 'end' && s.phase === 'draw') { endTurn(s, 'time'); return s; }
      if (m.t === 'pick' && s.phase === 'pick' && m.i === 0) return pickTopic(s, 0);
      if (m.t === 'next' && s.phase === 'show') {
        s.turn += 1;
        if (!this.ended(s)) newTurn(s);
        return s;
      }
      return null;
    }
    if (!Number.isInteger(m.p) || !this.canAct(s0, m.p)) return null;
    if (s0.phase === 'pick') {
      if (m.t !== 'pick' || !Number.isInteger(m.i) || m.i < 0 || m.i >= PICK_N) return null;
      const s = clone(s0);
      s.step += 1;
      return pickTopic(s, m.i);
    }
    const s = clone(s0);
    s.step += 1;
    const drawer = m.p === s.turn;
    if (drawer) {
      if (m.k !== s.dn) return null;
      if (m.t === 'line') {
        if (!Number.isInteger(m.c) || m.c < 0 || m.c >= COLORS.length || !Number.isInteger(m.w) || m.w < 0 || m.w >= WIDTHS.length) return null;
        if (!Number.isInteger(m.g) || !validD(m.d)) return null;
        s.strokes.push({ g: m.g, c: m.c, w: m.w, d: m.d });
      } else if (m.t === 'undo') {
        if (!s.strokes.length) return null;
        const g = s.strokes[s.strokes.length - 1].g;
        while (s.strokes.length && s.strokes[s.strokes.length - 1].g === g) s.strokes.pop();
        s.ver += 1;
      } else if (m.t === 'clear') {
        if (!s.strokes.length) return null;
        s.strokes = [];
        s.ver += 1;
      } else if (m.t === 'giveup') {
        endTurn(s, 'giveup');
      } else {
        return null;
      }
      s.dn += 1;
      return s;
    }
    if (m.t !== 'guess' || m.n !== s.gn[m.p] || typeof m.text !== 'string') return null;
    const text = m.text.trim().slice(0, MAX_TEXT);
    if (!text) return null;
    s.gn[m.p] += 1;
    const ok = this.topic(s).some((x) => kana(x) === kana(text));
    if (ok) {
      const rank = s.correct.length;
      s.correct.push(m.p);
      s.scores[m.p] += GUESS_PT[rank] ?? 5;
      s.scores[s.turn] += DRAWER_PT;
      s.chat.push({ p: m.p, ok: true });
      if (s.correct.length >= s.n - 1) endTurn(s, 'all');
    } else {
      s.chat.push({ p: m.p, text });
    }
    return s;
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const res = this.result(s);
    const key = res ? `${s.seed}:end` : `${s.seed}:${s.turn}`;
    if (ui.key !== key || ui.root !== root || !root.contains(ui.topic)) build(root, s, key, res);
    ui.s = s;
    ui.o = o;
    const isDrawer = !res && me === s.turn && s.phase === 'draw';

    // 参加者と点数
    const chips = scoreChips({ ...o, me }, s.scores, {
      won: res ? res.winners : [],
      turn: res ? null : s.turn,
      extra: (p) => (res ? '' : p === s.turn ? '✏️ 描く人' : s.correct.includes(p) ? `<span class="pt-ok">正解 ${s.correct.indexOf(p) + 1}番</span>` : ''),
    });
    ui.chips.replaceWith(chips);
    ui.chips = chips;

    // お題・ヒント・答え
    const t = this.topic(s);
    let html;
    if (res) {
      html = '<div class="um-label">おしまい</div>' + s.history.map((h) => `${esc(nameP(h.drawer))}: <b>${esc(TOPICS[h.topic][0])}</b>（${h.correct.length}人が正解）`).join('<br>');
    } else if (s.phase === 'show') {
      const why = s.why === 'all' ? '全員が当てました！' : s.why === 'giveup' ? '描く人があきらめました' : '時間切れ';
      html = `<div class="um-label">${why}</div><div class="oe-word">答えは「${esc(t[0])}」</div>`;
    } else if (s.phase === 'pick') {
      html = me === s.turn
        ? `<div class="um-label">描くお題を選んでください（ほかの人には見えません）</div><div class="oe-picks">${s.cands[s.turn].map((ti, i) => `<button type="button" class="btn secondary" data-pick="${i}">${esc(TOPICS[ti][0])}</button>`).join('')}</div>`
        : `<div class="um-label">${esc(nameP(s.turn))}がお題を選んでいます…</div>`;
    } else if (isDrawer) {
      html = `<div class="um-label">あなたが描くお題（ほかの人には見えません）</div><div class="oe-word">${esc(t[0])}</div><small>文字は書かないでください</small>`;
    } else {
      const n = [...readingOf(t)].length;
      html = `<div class="um-label">${esc(nameP(s.turn))}が描いています</div><div class="oe-hint">${'○'.repeat(n)}</div><small>ひらがなで${n}文字</small>`;
    }
    if (ui.topicHtml !== html) { ui.topic.innerHTML = html; ui.topicHtml = html; }

    // 残り時間の帯（場面が替わったら作り直す）
    const barKey = res ? '' : `oe:${s.seed}:${s.turn}:${s.phase}`;
    if (ui.barKey !== barKey) {
      ui.barKey = barKey;
      const bar = barKey ? timeBar(barKey, s.phase === 'draw' ? s.limit * 1000 : s.phase === 'pick' ? PICK_MS : SHOW_MS) : document.createElement('div');
      ui.bar.replaceWith(bar);
      ui.bar = bar;
    }

    paint(s);
    ui.canvas.classList.toggle('drawing', isDrawer && o.canMove);
    ui.tools.hidden = !(isDrawer && o.canMove);
    if (!ui.tools.hidden) syncTools();

    // 答えの記録
    const log = document.createElement('div');
    log.className = 'oe-chat';
    for (const c of s.chat.slice(-30)) {
      const line = document.createElement('div');
      line.className = c.ok ? 'ok' : '';
      line.innerHTML = c.ok ? `🎉 <b>${esc(nameP(c.p))}</b>が正解！` : `<b>${esc(nameP(c.p))}</b>: ${esc(c.text)}`;
      log.append(line);
    }
    if (!s.chat.length && !res) log.innerHTML = '<div class="um-muted">ここに答えが出ます</div>';
    ui.chat.replaceWith(log);
    ui.chat = log;
    log.scrollTop = log.scrollHeight;

    // 答えの入力欄（打っている途中の文字が消えないよう、作り直さずに出し入れだけする）
    const canGuess = !res && me !== null && me !== s.turn && s.phase === 'draw' && o.canMove;
    ui.form.hidden = !canGuess;
    if (!res && me !== null && me !== s.turn && s.correct.includes(me) && s.phase === 'draw') {
      ui.note.textContent = '正解！ ほかの人が当てるのを待っています';
    } else {
      ui.note.textContent = '';
    }
  },
};

/* ---------- 画面の部品（描き直しで消えないよう、回ごとに1回だけ作る） ---------- */

const ui = { key: null };

function build(root, s, key, res) {
  root.innerHTML = '';
  root.className = 'board oe';
  ui.key = key;
  ui.root = root;
  ui.topicHtml = null;
  ui.barKey = null;
  ui.drawn = 0;
  ui.ver = -1;
  ui.pts = [];
  ui.curG = null;
  ui.c = ui.c ?? 0;
  ui.w = ui.w ?? 1;

  ui.chips = document.createElement('div');
  ui.topic = document.createElement('div');
  ui.topic.className = 'oe-topic';
  ui.topic.addEventListener('click', (e) => { // お題を選ぶ（詳細設定）のボタン
    const b = e.target.closest?.('[data-pick]');
    if (b && ui.o?.canMove && ui.s?.phase === 'pick') ui.o.onMove({ t: 'pick', i: Number(b.dataset.pick) });
  });
  ui.bar = document.createElement('div');

  ui.wrap = document.createElement('div');
  ui.wrap.className = 'oe-wrap';
  ui.canvas = document.createElement('canvas');
  ui.canvas.width = 600;
  ui.canvas.height = 600;
  ui.canvas.className = 'oe-canvas';
  ui.ctx = ui.canvas.getContext('2d');
  ui.wrap.append(ui.canvas);
  hookPen(ui.canvas);

  ui.tools = document.createElement('div');
  ui.tools.className = 'oe-tools';
  ui.tools.hidden = true;
  const colors = document.createElement('div');
  colors.className = 'oe-colors';
  COLORS.forEach((col, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'oe-color' + (i === COLORS.length - 1 ? ' eraser' : '');
    b.style.setProperty('--c', col);
    b.title = COLOR_NAMES[i];
    b.setAttribute('aria-label', COLOR_NAMES[i]);
    if (i === COLORS.length - 1) b.textContent = '🧽';
    b.onclick = () => { ui.c = i; syncTools(); };
    colors.append(b);
  });
  const widths = document.createElement('div');
  widths.className = 'oe-widths';
  WIDTHS.forEach((w, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'oe-width';
    b.setAttribute('aria-label', ['細い', 'ふつう', '太い'][i]);
    const dot = document.createElement('i');
    dot.style.width = dot.style.height = Math.max(4, w * 0.6) + 'px';
    b.append(dot);
    b.onclick = () => { ui.w = i; syncTools(); };
    widths.append(b);
  });
  const acts = document.createElement('div');
  acts.className = 'oe-acts';
  const act = (text, cls, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small ' + cls;
    b.textContent = text;
    b.onclick = fn;
    acts.append(b);
  };
  act('1つ戻す', 'secondary', () => send({ t: 'undo' }));
  act('全部消す', 'secondary', () => { if (confirm('絵を全部消しますか？')) send({ t: 'clear' }); });
  act('あきらめる', 'ghost', () => { if (confirm('この回を終えて答えを見せますか？')) send({ t: 'giveup' }); });
  ui.tools.append(colors, widths, acts);

  ui.chat = document.createElement('div');
  ui.note = document.createElement('p');
  ui.note.className = 'cc-log';

  ui.form = document.createElement('form');
  ui.form.className = 'oe-form';
  ui.form.hidden = true;
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = MAX_TEXT;
  input.placeholder = '答えを入れる';
  input.className = 'um-input';
  input.autocomplete = 'off';
  input.enterKeyHint = 'send';
  const ok = document.createElement('button');
  ok.type = 'submit';
  ok.className = 'btn primary';
  ok.textContent = '答える';
  ui.form.append(input, ok);
  ui.form.onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !ui.o?.canMove) return;
    input.value = '';
    const me = ui.o.me;
    ui.o.onMove({ t: 'guess', n: ui.s.gn[me], text });
    input.focus();
  };

  if (res) root.append(ui.chips, ui.topic); // 終わったら点数とお題の一覧だけ
  else root.append(ui.chips, ui.topic, ui.bar, ui.wrap, ui.tools, ui.form, ui.note, ui.chat);
}

function syncTools() {
  ui.tools.querySelectorAll('.oe-color').forEach((b, i) => b.classList.toggle('on', i === ui.c));
  ui.tools.querySelectorAll('.oe-width').forEach((b, i) => b.classList.toggle('on', i === ui.w));
}

// 描く人の手を送る（k は送る時点の局面の手の数）
function send(m) {
  if (!ui.o?.canMove) return;
  ui.o.onMove({ ...m, k: ui.s.dn });
}

function strokeTo(ctx, pts, c, w) {
  const k = ctx.canvas.width / 1000;
  ctx.strokeStyle = COLORS[c];
  ctx.lineWidth = WIDTHS[w] * k;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * k, pts[0][1] * k);
  if (pts.length === 1) ctx.lineTo(pts[0][0] * k + 0.01, pts[0][1] * k);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x * k, y * k);
  ctx.stroke();
}

// 局面の線を描く。消した・戻したとき（ver が変わったとき）だけ全部描き直し、ふだんは新しい線だけ足す
function paint(s) {
  const ctx = ui.ctx;
  if (ui.ver !== s.ver || ui.drawn > s.strokes.length) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);
    ui.drawn = 0;
    ui.ver = s.ver;
  }
  for (const st of s.strokes.slice(ui.drawn)) strokeTo(ctx, decode(st.d), st.c, st.w);
  ui.drawn = s.strokes.length;
}

// ペンの動き。動かしている間は手元にすぐ描き、0.5秒ごとに区切って送る
function hookPen(canvas) {
  let timer = null;
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    const clamp = (v) => Math.max(0, Math.min(999, Math.round(v)));
    return [clamp(((e.clientX - r.left) / r.width) * 1000), clamp(((e.clientY - r.top) / r.height) * 1000)];
  };
  const flush = (final) => {
    if (ui.pts.length && (final || ui.pts.length >= 2)) {
      const pts = ui.pts.length === 1 ? [ui.pts[0], ui.pts[0]] : ui.pts;
      if (ui.curG === null) ui.curG = ui.s.dn;
      const last = pts[pts.length - 1];
      send({ t: 'line', g: ui.curG, c: ui.c, w: ui.w, d: encode(pts) });
      ui.pts = final ? [] : [last];
    }
    if (final) { ui.pts = []; ui.curG = null; }
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!canvas.classList.contains('drawing')) return;
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    ui.pts = [at(e)];
    ui.curG = null;
    strokeTo(ui.ctx, ui.pts, ui.c, ui.w);
    clearInterval(timer);
    timer = setInterval(() => flush(false), 500);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!ui.pts.length || !canvas.classList.contains('drawing')) return;
    e.preventDefault();
    const p = at(e);
    const q = ui.pts[ui.pts.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 6) return; // 細かすぎる点は送らない
    strokeTo(ui.ctx, [q, p], ui.c, ui.w);
    ui.pts.push(p);
  });
  const up = () => {
    if (!ui.pts.length) return;
    clearInterval(timer);
    flush(true);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
}
