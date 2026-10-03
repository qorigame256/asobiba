// トランプの共通の道具（大富豪・ポーカー・スピードで使う）。
// 札は「マーク1文字 + 数字」: マーク s♠ h♥ d♦ c♣、数字 1(A)〜13(K)。例: 's1' = ♠A、'h13' = ♥K。ジョーカーは 'JK'。
// 強さの順番はゲームごとに違うので、ここでは決めない。

export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_MARK = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const JOKER = 'JK';
const FACE = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

export const suitOf = (c) => (c === JOKER ? null : c[0]);
export const rankOf = (c) => (c === JOKER ? 0 : Number(c.slice(1)));
export const rankLabel = (r) => FACE[r] ?? String(r);

export function makeDeck(jokers = 0) {
  const d = [];
  for (const s of SUITS) for (let r = 1; r <= 13; r++) d.push(s + r);
  for (let i = 0; i < jokers; i++) d.push(JOKER);
  return d;
}

export const cardLabel = (c) => (c === JOKER ? 'ジョーカー' : SUIT_MARK[c[0]] + rankLabel(rankOf(c)));

// 札の見た目。tag を 'button' にすると押せる札になる
export function cardEl(c, tag = 'div') {
  const e = document.createElement(tag);
  if (tag === 'button') e.type = 'button';
  if (c === JOKER) {
    e.className = 'pcard joker';
    e.innerHTML = '<span class="pc-r">JO<br>KER</span><span class="pc-s">🃏</span>';
  } else {
    const s = suitOf(c);
    e.className = 'pcard' + (s === 'h' || s === 'd' ? ' red' : '');
    e.innerHTML = `<span class="pc-r">${rankLabel(rankOf(c))}</span><span class="pc-s">${SUIT_MARK[s]}</span>`;
  }
  e.setAttribute('aria-label', cardLabel(c));
  return e;
}

export function backEl() {
  const e = document.createElement('div');
  e.className = 'pcard back';
  return e;
}
