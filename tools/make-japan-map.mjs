// 都道府県タッチ（todofuken.js）の日本地図のデータ app/js/games/todofuken-data.js を作る。
// 元は Natural Earth の ne_10m_admin_1_states_provinces（パブリックドメイン。https://www.naturalearthdata.com/ ）。
// 使い方: node tools/make-japan-map.mjs <ne_10m_admin_1_states_provinces.shp と .dbf のあるフォルダ>
//   （元のデータは 15MB ほどあるので Git に入れない。作り直すときは naciscdn.org から取ってきて展開する）
//
// 作り（Claude の判断）:
//   - 経度・緯度を、北緯36度で縦横の縮み方が合う平らな地図にして、横 1000 の整数の座標にする（地図の外は切る）。
//   - 線は Douglas-Peucker で間引き（TOL）、小さな島（AREA_MIN より小さい輪）は省く。どの県もいちばん大きい輪は必ず残す。
//   - 沖縄県と奄美の島々（鹿児島県）は本当の場所だと地図が縦に長くなるので、左上の日本海のあたりに枠で囲んで寄せて描く（OKI_SHIFT）。
//   - 北方領土（国後島・択捉島・色丹島・歯舞群島）は Natural Earth ではロシアのサハリン州に入っているので、その輪を北海道に足す。
//   - 座標はすべて整数（勝ち負けの距離を全員の端末で同じに数えるため。todofuken.js の distTo）。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) { console.error('使い方: node tools/make-japan-map.mjs <フォルダ>'); process.exit(1); }
const base = join(src, 'ne_10m_admin_1_states_provinces');

// ---- dbf ----
function readDbf(buf) {
  const n = buf.readUInt32LE(4), hlen = buf.readUInt16LE(8), rlen = buf.readUInt16LE(10);
  const fields = [];
  for (let o = 32; buf[o] !== 0x0d; o += 32) {
    fields.push({ name: buf.toString('latin1', o, o + 11).replace(/\0.*$/, ''), len: buf[o + 16] });
  }
  const rows = [];
  for (let i = 0; i < n; i++) {
    let o = hlen + i * rlen + 1;
    const row = {};
    for (const f of fields) { row[f.name] = buf.toString('utf8', o, o + f.len).replace(/[\0\s　]+$/u, '').trim(); o += f.len; }
    rows.push(row);
  }
  return rows;
}
// ---- shp（多角形だけ） ----
function readShp(buf) {
  const out = [];
  let o = 100;
  while (o < buf.length) {
    const len = buf.readInt32BE(o + 4) * 2;
    const c = o + 8;
    const type = buf.readInt32LE(c);
    const rings = [];
    if (type === 5) {
      const np = buf.readInt32LE(c + 36), nPts = buf.readInt32LE(c + 40);
      const parts = Array.from({ length: np }, (_, i) => buf.readInt32LE(c + 44 + i * 4));
      const p0 = c + 44 + np * 4;
      for (let i = 0; i < np; i++) {
        const a = parts[i], b = i + 1 < np ? parts[i + 1] : nPts;
        const ring = [];
        for (let k = a; k < b; k++) ring.push([buf.readDoubleLE(p0 + k * 16), buf.readDoubleLE(p0 + k * 16 + 8)]);
        rings.push(ring);
      }
    }
    out.push(rings);
    o = c + len;
  }
  return out;
}

const rows = readDbf(readFileSync(base + '.dbf'));
const shapes = readShp(readFileSync(base + '.shp'));
if (rows.length !== shapes.length) throw new Error('dbf と shp の数が合わない');

// ---- 投影 ----
const LON0 = 128.6, LAT_TOP = 45.75, K = Math.cos(36 * Math.PI / 180);
const SCALE = 1000 / ((149.0 - LON0) * K);
const proj = ([lon, lat]) => [(lon - LON0) * K * SCALE, (LAT_TOP - lat) * SCALE];
const TOL = 0.9;
const AREA_MIN = 6;
// 沖縄を寄せる量（地図の座標で）と、寄せたあとの枠
const OKI_SHIFT = [285, -1035];

function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  // 輪は始まりと終わりが同じ点なので、始まりからいちばん遠い点でも分ける（分けないと全部が1点に潰れる）
  let far = 0;
  pts.forEach(([x, y], i) => { if (Math.hypot(x - pts[0][0], y - pts[0][1]) > Math.hypot(pts[far][0] - pts[0][0], pts[far][1] - pts[0][1])) far = i; });
  keep[0] = keep[pts.length - 1] = keep[far] = 1;
  const stack = [[0, far], [far, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const area = (r) => Math.abs(r.reduce((s, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x * y2 - x2 * y; }, 0) / 2);
const ringOut = (ring, shift) => {
  let r = ring.map(proj).map(([x, y]) => [x + shift[0], y + shift[1]]);
  r = simplify(r, TOL).map(([x, y]) => [Math.round(x), Math.round(y)]);
  r = r.filter((p, i) => i === 0 || p[0] !== r[i - 1][0] || p[1] !== r[i - 1][1]);
  if (r.length > 1 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]) r.pop();
  return r;
};

// 都道府県の読みと地方（地方は CPU の外し方とヒントに使う）
const READ = {
  北海道: 'ほっかいどう', 青森県: 'あおもりけん', 岩手県: 'いわてけん', 宮城県: 'みやぎけん', 秋田県: 'あきたけん', 山形県: 'やまがたけん', 福島県: 'ふくしまけん',
  茨城県: 'いばらきけん', 栃木県: 'とちぎけん', 群馬県: 'ぐんまけん', 埼玉県: 'さいたまけん', 千葉県: 'ちばけん', 東京都: 'とうきょうと', 神奈川県: 'かながわけん',
  新潟県: 'にいがたけん', 富山県: 'とやまけん', 石川県: 'いしかわけん', 福井県: 'ふくいけん', 山梨県: 'やまなしけん', 長野県: 'ながのけん', 岐阜県: 'ぎふけん', 静岡県: 'しずおかけん', 愛知県: 'あいちけん',
  三重県: 'みえけん', 滋賀県: 'しがけん', 京都府: 'きょうとふ', 大阪府: 'おおさかふ', 兵庫県: 'ひょうごけん', 奈良県: 'ならけん', 和歌山県: 'わかやまけん',
  鳥取県: 'とっとりけん', 島根県: 'しまねけん', 岡山県: 'おかやまけん', 広島県: 'ひろしまけん', 山口県: 'やまぐちけん',
  徳島県: 'とくしまけん', 香川県: 'かがわけん', 愛媛県: 'えひめけん', 高知県: 'こうちけん',
  福岡県: 'ふくおかけん', 佐賀県: 'さがけん', 長崎県: 'ながさきけん', 熊本県: 'くまもとけん', 大分県: 'おおいたけん', 宮崎県: 'みやざきけん', 鹿児島県: 'かごしまけん', 沖縄県: 'おきなわけん',
};
const ORDER = Object.keys(READ);
const REGION = (i) => (i === 0 ? 0 : i <= 6 ? 1 : i <= 13 ? 2 : i <= 22 ? 3 : i <= 29 ? 4 : i <= 34 ? 5 : i <= 38 ? 6 : 7);

const prefs = new Map();
rows.forEach((r, i) => {
  if (r.adm0_a3 !== 'JPN') return;
  const name = r.name_ja;
  if (!READ[name]) throw new Error('知らない県の名前: ' + name + ' / ' + r.name);
  prefs.set(name, shapes[i]);
});
// 北方領土: サハリン州の輪のうち、北海道の東（経度145.3〜149、緯度43.2〜45.6）にあるもの
rows.forEach((r, i) => {
  if (r.adm0_a3 !== 'RUS' || !/Sakhalin/i.test(r.name)) return;
  const add = shapes[i].filter((ring) => {
    const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length, lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    return lon > 145.3 && lon < 149 && lat > 43.2 && lat < 45.6;
  });
  console.log('北方領土の輪:', add.length);
  prefs.get('北海道').push(...add);
});
if (prefs.size !== 47) throw new Error('県の数が47でない: ' + prefs.size);
// Natural Earth では奄美の島々（緯度 27.2 より北）が沖縄県に入っているので鹿児島県へ移す（沖縄と一緒に左上の枠へ寄せる。
// 本当の場所だと地図が下へ長くなるため）。大東諸島（経度 130.5 より東）は沖縄の枠が横に長くなるので省く。
{
  const mid = (ring) => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  const oki = prefs.get('沖縄県');
  const amami = oki.filter((r) => mid(r)[1] > 27.2);
  console.log('奄美の輪（鹿児島へ）:', amami.length);
  for (const r of amami) r.inset = true;
  for (const r of oki) r.inset = true;
  prefs.get('鹿児島県').push(...amami);
  prefs.set('沖縄県', oki.filter((r) => mid(r)[1] <= 27.2 && mid(r)[0] < 130.5));
}

let pts = 0;
const insetRings = [];
const out = ORDER.map((name, i) => {
  let rings = prefs.get(name).map((r) => Object.assign(ringOut(r, r.inset ? OKI_SHIFT : [0, 0]), { inset: r.inset })).filter((r) => r.length >= 3);
  rings.sort((a, b) => area(b) - area(a));
  rings = rings.filter((r, k) => k === 0 || area(r) >= AREA_MIN);
  pts += rings.reduce((s, r) => s + r.length, 0);
  insetRings.push(...rings.filter((r) => r.inset).map((r) => r.flat()));
  // 輪は「x,y x,y …」の差分にせず、そのまま数を並べる（読みやすさ優先）
  return { n: name, k: READ[name], g: REGION(i), r: rings.map((r) => r.flat()) };
});

const all = out.flatMap((p) => p.r.flatMap((r) => r));
const xs = all.filter((_, i) => i % 2 === 0), ys = all.filter((_, i) => i % 2 === 1);
const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
// 沖縄と奄美を寄せた枠（寄せた輪の外側に少し余白）
const oki = insetRings.flat();
const ox = oki.filter((_, i) => i % 2 === 0), oy = oki.filter((_, i) => i % 2 === 1);
const okiBox = [Math.min(...ox) - 12, Math.min(...oy) - 12, Math.max(...ox) + 12, Math.max(...oy) + 12];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const js = `// 都道府県タッチの日本地図。tools/make-japan-map.mjs が Natural Earth（パブリックドメイン）から作る。手で直さない。
// n = 名前、k = 読み、g = 地方（0 北海道・1 東北・2 関東・3 中部・4 近畿・5 中国・6 四国・7 九州沖縄）、r = 輪（[x0, y0, x1, y1, …] の整数）。
// BOX = 地図全体の範囲 [左, 上, 右, 下]、OKI_BOX = 沖縄県と奄美（鹿児島県）を寄せて描いた枠。
export const BOX = ${JSON.stringify(box)};
export const OKI_BOX = ${JSON.stringify(okiBox)};
export const PREFS = [
${out.map((p) => '  ' + JSON.stringify(p)).join(',\n')},
];
`;
writeFileSync(join(root, 'app/js/games/todofuken-data.js'), js);
console.log('点の数', pts, '大きさ', js.length, 'BOX', box, 'OKI_BOX', okiBox);
