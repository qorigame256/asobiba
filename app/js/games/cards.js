// トランプの共通の道具（大富豪・ポーカー・スピードで使う）。
// 札は「マーク1文字 + 数字」: マーク s♠ h♥ d♦ c♣、数字 1(A)〜13(K)。例: 's1' = ♠A、'h13' = ♥K。ジョーカーは 'JK'（2枚使うゲームの2枚目は 'JK2'。スピード）。
// 強さの順番はゲームごとに違うので、ここでは決めない。

export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_MARK = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const JOKER = 'JK';
export const JOKER2 = 'JK2';
export const isJoker = (c) => c === JOKER || c === JOKER2;
const FACE = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

export const suitOf = (c) => (isJoker(c) ? null : c[0]);
export const rankOf = (c) => (isJoker(c) ? 0 : Number(c.slice(1)));
export const rankLabel = (r) => FACE[r] ?? String(r);

export function makeDeck(jokers = 0) {
  const d = [];
  for (const s of SUITS) for (let r = 1; r <= 13; r++) d.push(s + r);
  for (let i = 0; i < jokers; i++) d.push(JOKER);
  return d;
}

export const cardLabel = (c) => (isJoker(c) ? 'ジョーカー' : SUIT_MARK[c[0]] + rankLabel(rankOf(c)));

// 札の見た目。tag を 'button' にすると押せる札になる。
// 絵は img/cards/<札>.webp（Byron Knoll の Vector Playing Cards。パブリックドメイン。PNG を幅240の WebP に縮めた。
// ♠A は飾りの無い版。飾りのある版は別の作者の絵で、自由に使えるとの表明が見つからなかったため使わない）。
// 小さく出すと絵の隅の数字が読めないので、左上に大きめの数字とマークを重ねる
export function cardEl(c, tag = 'div') {
  const e = document.createElement(tag);
  if (tag === 'button') e.type = 'button';
  if (isJoker(c)) {
    e.className = 'pcard joker';
    e.innerHTML = '<span class="pc-idx">JO<br>KER</span>';
  } else {
    const s = suitOf(c);
    e.className = 'pcard' + (s === 'h' || s === 'd' ? ' red' : '');
    e.innerHTML = `<span class="pc-idx">${rankLabel(rankOf(c))}<br>${SUIT_MARK[s]}</span>`;
  }
  e.style.backgroundImage = `url(img/cards/${isJoker(c) ? 'joker' : c}.webp)`;
  e.setAttribute('aria-label', cardLabel(c));
  return e;
}

export function backEl() {
  const e = document.createElement('div');
  e.className = 'pcard back';
  return e;
}
