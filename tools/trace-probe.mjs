// ホストとゲストの通信の中身（WebSocket を流れる MQTT のパケット）を時刻つきで記録する台本（2026-11-19。play-two.mjs の --script に渡す）。
// なぜ要るか: 「送ったのに届かない」を、どこで消えたか（送っていない・中継サーバーが配らない・受けた側が捨てた）まで見分けるため。
//   エアホッケー・紙相撲の対局中に「↩ さっきの部屋へ」が出ない件は、これで「ホストは here を送り PUBACK も返ったが、だれにも配られていない」と分かった。
// すること: 両方のページをつなぎ直させて WebSocket を最初から見る → 始める → PLAY_MS（既定 3500）待つ → ゲストをホームへ戻して部屋へ問い合わせさせる（tools/sweep-rejoin.mjs と同じ仕込み）
//   → ボタンが出たか（shown）・部屋の覚えが残ったか（kept）・接続ごとの送った数（sentAll）と、そのうち自分へ戻った数（back。少なければ中継サーバーが捨てている）・種類と qos ごとの数・live と stream のほかの全パケットの記録（log）を返す。
// 使い方（プロジェクトのフォルダで）: node tools/play-two.mjs <ゲーム> --no-start --script tools/trace-probe.mjs --out <フォルダ> --timeout 90
//   記録は <フォルダ>/result.json の value（log は { t: 始めからのミリ秒, id: 'host#1' など, ev: '→PUB'（送った）・'←PUB'（受けた）・'←PUBACK' など, type, pid }）。
//   liveLag は、同じ中身の live が続くと小さく出る（送った時刻を中身で引き当てているため）。目安にしか使わない。
const T0 = Date.now();
const now = () => Date.now() - T0;

// MQTT 3.1.1 のパケットを、つながった流れから切り出す
function makeParser(onPacket) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    for (;;) {
      if (buf.length < 2) return;
      let len = 0, mul = 1, i = 1, ok = false;
      for (; i < buf.length && i <= 4; i++) { len += (buf[i] & 127) * mul; mul *= 128; if (!(buf[i] & 128)) { ok = true; i++; break; } }
      if (!ok) return;
      if (buf.length < i + len) return;
      const type = buf[0] >> 4, flags = buf[0] & 15, body = buf.subarray(i, i + len);
      buf = buf.subarray(i + len);
      const p = { type, qos: (flags >> 1) & 3, dup: !!(flags & 8) };
      if (type === 3) {
        const tl = body.readUInt16BE(0);
        let o = 2 + tl;
        if (p.qos) { p.pid = body.readUInt16BE(o); o += 2; }
        p.payload = body.subarray(o).toString('utf8');
        try { p.json = JSON.parse(p.payload); } catch { /* JSON でない */ }
      } else if (type === 4 || type === 9 || type === 8) p.pid = body.readUInt16BE(0);
      else if (type === 2) p.rc = body[1];
      onPacket(p);
    }
  };
}
const NAMES = { 1: 'CONNECT', 2: 'CONNACK', 3: 'PUBLISH', 4: 'PUBACK', 8: 'SUBSCRIBE', 9: 'SUBACK', 12: 'PINGREQ', 13: 'PINGRESP', 14: 'DISCONNECT' };

function watch(page, who, log, sentAt) {
  let n = 0;
  page.on('websocket', (ws) => {
    const id = `${who}#${++n}`;
    log.push({ t: now(), id, ev: 'open' });
    const stat = { id, sentAll: 0, back: 0, sent: {}, recv: {}, liveLag: [] }; // back = この接続が送ったもののうち、中継サーバーから自分へ戻った数（sentAll より少なければ捨てられている）
    const own = new Map(); // 送った中身 → まだ戻っていない数
    log.stats.push(stat);
    const key = (p) => (p.json?.type ?? '?') + (p.json?.type === 'live' ? ':' + (p.json.d?.k ?? '?') : '') + '/q' + p.qos;
    const out = makeParser((p) => {
      const t = now();
      if (p.type === 3) {
        stat.sent[key(p)] = (stat.sent[key(p)] ?? 0) + 1;
        stat.sentAll++;
        own.set(p.payload, (own.get(p.payload) ?? 0) + 1);
        if (sentAt) sentAt.set(p.payload, t);
        if (p.json?.type !== 'live' && p.json?.type !== 'stream') log.push({ t, id, ev: '→PUB', type: p.json?.type, qos: p.qos, pid: p.pid, dup: p.dup || undefined, to: p.json?.to, len: p.payload.length });
        else if (p.qos) log.push({ t, id, ev: '→PUB', type: key(p), pid: p.pid });
      } else log.push({ t, id, ev: '→' + (NAMES[p.type] ?? p.type), pid: p.pid });
    });
    const inn = makeParser((p) => {
      const t = now();
      if (p.type === 3) {
        stat.recv[key(p)] = (stat.recv[key(p)] ?? 0) + 1;
        if (own.get(p.payload) > 0) { own.set(p.payload, own.get(p.payload) - 1); stat.back++; }
        const s = log.sentAtAll.get(p.payload);
        if (p.json?.type === 'live' && s !== undefined) stat.liveLag.push([t, t - s]);
        if (p.json?.type !== 'live' && p.json?.type !== 'stream') log.push({ t, id, ev: '←PUB', type: p.json?.type, qos: p.qos, pid: p.pid, from: String(p.json?.from ?? '').slice(0, 6), to: p.json?.to, lag: s !== undefined ? t - s : undefined, len: p.payload.length });
      } else log.push({ t, id, ev: '←' + (NAMES[p.type] ?? p.type), pid: p.pid, rc: p.rc });
    });
    ws.on('framesent', (f) => out(f.payload));
    ws.on('framereceived', (f) => inn(f.payload));
    ws.on('close', () => log.push({ t: now(), id, ev: 'close' }));
    ws.on('socketerror', (e) => log.push({ t: now(), id, ev: 'error', e: String(e) }));
  });
}

const LAST_AT_KEY = 'bg-last-room-at';

export default async function ({ host, guests, readyAll, sleep }) {
  const a = guests[0];
  const log = [];
  log.stats = [];
  log.sentAtAll = new Map(); // 送った中身 → 送った時刻（どのページが送ったものでも）
  watch(host, 'host', log, log.sentAtAll);
  watch(a, 'guest', log, log.sentAtAll);
  // つなぎ直させて、WebSocket を最初から見る
  await host.reload();
  await host.waitForSelector('#dock button:has-text("始める")');
  await a.reload();
  await a.waitForSelector('#screen-play:not([hidden])');
  await sleep(1500);
  await readyAll();
  await host.click('#dock button:has-text("始める"):not([disabled])');
  const playMs = Number(process.env.PLAY_MS ?? 3500);
  await sleep(playMs);
  log.push({ t: now(), id: 'script', ev: 'yield を仕込む' });
  await a.evaluate((key) => {
    const st = window.setTimeout.bind(window);
    let used = false;
    window.setTimeout = (cb, ms, ...rest) => {
      const hit = !used && ms > 10100 && ms <= 15600 && !document.querySelector('#screen-home')?.hidden;
      if (hit) used = true;
      return st(cb, hit ? 800 : ms, ...rest);
    };
    const cur = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...cur, at: Date.now(), tab: 'sweep-rejoin' }));
  }, LAST_AT_KEY);
  await a.waitForSelector('#screen-home:not([hidden])', { timeout: 9000 });
  log.push({ t: now(), id: 'script', ev: 'ゲストがホームへ' });
  await a.evaluate((key) => {
    const cur = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...cur, at: Date.now() - 60000 }));
  }, LAST_AT_KEY);
  let shown = false;
  try { await a.waitForSelector('#last-room button', { timeout: 14000 }); shown = true; } catch { /* 出なかった */ }
  log.push({ t: now(), id: 'script', ev: shown ? 'ボタンが出た' : 'ボタンが出ない' });
  const kept = await a.evaluate(() => !!localStorage.getItem('bg-last-room'));
  await sleep(Number(process.env.TAIL_MS ?? 3000)); // 遅れて届く here を見る
  const lagSum = (arr) => {
    if (!arr.length) return null;
    const v = arr.map((x) => x[1]).sort((x, y) => x - y);
    return { n: v.length, min: v[0], med: v[v.length >> 1], max: v[v.length - 1], first: arr[0], last: arr[arr.length - 1] };
  };
  return {
    shown, kept,
    stats: log.stats.map((s) => ({ id: s.id, sentAll: s.sentAll, back: s.back, sent: s.sent, recv: s.recv, liveLag: lagSum(s.liveLag) })),
    log: log.map((x) => x),
  };
}
