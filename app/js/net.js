// オンライン対戦の通信。
// 公開 MQTT ブローカー（誰でも無料で使える中継サーバー）を経由して、同じ部屋コードの相手とメッセージをやり取りする。
// アカウント登録が要らない代わりに、部屋コードを知っている人なら誰でもやり取りを見られる（ゲームの手しか流さない）。
// mqtt.js は index.html で CDN から読み込み、グローバル変数 mqtt として使う。

const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt';
const TOPIC_PREFIX = 'asobiba-q7m/v1/room/';

export function connectRoom(code, myId, onMessage, onStatus) {
  if (typeof mqtt === 'undefined') throw new Error('mqtt.js が読み込めていません');
  const topic = TOPIC_PREFIX + code;
  const client = mqtt.connect(BROKER_URL, {
    clientId: 'bg_' + myId + '_' + Math.random().toString(36).slice(2, 8),
    clean: true,
    keepalive: 30,
    reconnectPeriod: 2000,
    connectTimeout: 10000,
  });

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
    if (!msg || msg.from === myId) return; // 自分が送ったものも届くので捨てる
    onMessage(msg);
  });

  return {
    // qos 0 = 届いたか確かめない（エアホッケーの位置のように何度も送るもの）。ふだんは 1（届くまで送り直す）
    send(msg, qos = 1) { client.publish(topic, JSON.stringify({ ...msg, from: myId }), { qos }); },
    close() { client.end(true); },
  };
}
