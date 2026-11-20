// オンライン対戦の通信。
// 公開 MQTT ブローカー（誰でも無料で使える中継サーバー）を経由して、同じ部屋コードの相手とメッセージをやり取りする。
// アカウント登録が要らない代わりに、部屋コードを知っている人なら誰でもやり取りを見られる（ゲームの手しか流さない）。
// mqtt.js は index.html で CDN から読み込み、グローバル変数 mqtt として使う。

export const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt'; // tools/net-rate.mjs もここから読む（中継サーバーを替えたら、測る先も一緒に替わるように）
const TOPIC_PREFIX = 'asobiba-q7m/v1/room/';

// 送る数の見張り（2026-11-19。本人の選択「送る数を上限より下げる」）。
// 中継サーバーは、1つの接続から受け取る数を「区切られた1秒ごとに10通まで」にしていて、超えた分は qos 1 でも配らずに捨てる
// （MQTT 3.1.1 では PUBACK は返るので、送った側は気づけない。実測は tools/net-rate.mjs。まとめて送ると、平均が10通より少なくても同じ1秒に入った分が捨てられる）。
// エアホッケー・紙相撲が位置を1秒に20通以上送っていて、その間は here・state・ping・ゴールの知らせまで消えていた。
// そこで、この端末が直近1秒（WINDOW_MS）に送った数が QOS0_PER_WINDOW 以上のあいだ、qos 0（届かなくてもよい見た目だけの中身）は送らずに捨てる。
// qos 1（大事な知らせ）はいつも送り、数には入れる（qos 1 の分だけ qos 0 が減る）。残りの2通は qos 1 と、届く間が通信のゆれで詰まる分の余裕。
// 続けて送るゲームは、自分の間隔でこの数より下に収めておく（ここで捨てると、届く間がふぞろいになる）。
const WINDOW_MS = 1000;
const QOS0_PER_WINDOW = 8;
// now = 今の時刻（ミリ秒）を返す関数。返る関数は、送ってよければ true（送った数に数える）
export function sendBudget(now = () => Date.now()) {
  const sent = [];
  return (qos) => {
    const t = now();
    while (sent.length && t - sent[0] >= WINDOW_MS) sent.shift();
    if (qos === 0 && sent.length >= QOS0_PER_WINDOW) return false;
    sent.push(t);
    return true;
  };
}

// onSelf（任意）: 自分が送ったものが中継サーバーから戻ってきたとき（通信の遅れを測るのに使う）
export function connectRoom(code, myId, onMessage, onStatus, onSelf) {
  if (typeof mqtt === 'undefined') throw new Error('mqtt.js が読み込めていません');
  const topic = TOPIC_PREFIX + code;
  const client = mqtt.connect(BROKER_URL, {
    clientId: 'bg_' + myId + '_' + Math.random().toString(36).slice(2, 8),
    clean: true,
    keepalive: 30,
    reconnectPeriod: 2000,
    connectTimeout: 10000,
    // 切れている間の qos 0 はためない（既定はためて、つながった瞬間にまとめて送る。その束が上の上限を超え、つなぎ直しの hello・state まで捨てられる）
    queueQoSZero: false,
  });
  const allow = sendBudget();

  client.on('connect', () => {
    client.subscribe(topic, { qos: 1 }, (err) => onStatus(err ? 'error' : 'ready'));
  });
  client.on('reconnect', () => onStatus('connecting'));
  client.on('offline', () => onStatus('connecting'));
  client.on('error', () => {}); // 再接続は mqtt.js が自動で行う
  client.on('message', (t, payload) => {
    if (t !== topic) return;
    let msg;
    try { msg = JSON.parse(payload.toString()); } catch { return; }
    if (!msg) return;
    if (msg.from === myId) { onSelf?.(msg); return; } // 自分が送ったものも届くので、ふつうの受け取りには回さない
    onMessage(msg);
  });

  return {
    // qos 0 = 届いたか確かめない（エアホッケーの位置のように何度も送るもの）。ふだんは 1（届くまで送り直す）
    send(msg, qos = 1) { if (allow(qos)) client.publish(topic, JSON.stringify({ ...msg, from: myId }), { qos }); },
    close() { client.end(true); },
  };
}
