process.on('uncaughtException', err => {
  if (
    err && err.message && (
      err.message.includes('PartialReadError') ||
      err.message.includes('packet_world_particles')
    )
  ) {
    // 粒子協議錯誤完全忽略
    return;
  }
  // 其他錯誤照常顯示
  console.error('[全域錯誤]', err);
});

require('dotenv').config({ path: 'bot8851.env' });
const mineflayer = require('mineflayer');
const readline = require('readline');
const Vec3 = require('vec3').Vec3;
const fs = require('fs');

// 廣播到 Discord 的函式
function broadcastLotteryResult(msg) {
  fs.appendFileSync('./broadcast.txt', msg + '\n');
}

// ========== 設定 ==========
const CONFIG = {
  SERVER: 'mcfallout.net',
  SAFE_POSITION: new Vec3(2062, 64, 4678),
  CHECK_POS_INTERVAL: 600000,
  MAX_HISTORY: 50,
  RECONNECT_DELAY: 10000,
  ITEM_MAX_WAIT: 10000,
  ITEM_SCAN_INTERVAL: 50,
  PLAYER_SCAN_RANGE: 9,
  FILE_PATH: './pending_compensation.txt',
  RATE_FILE: './player_rates_v2.txt',
  MSG_RATE_LIMIT_WINDOW: 10000,
  MSG_RATE_LIMIT_COUNT: 20,
  MSG_MIN_INTERVAL: 2000,
  GAME_MIN_INTERVAL: 3000,
  RS_SCAN_RADIUS: 7,
  WIN_LOSE_SCAN_RANGE: 7,
  ITEM_MONITOR_INTERVAL: 200,
  WHITELIST_FILE: './bot_whitelist.txt',
  VILLAGER_COIN_ID: 690,
  LIMIT_FILE: './bet_limits.txt',
  EV_FILE: './expected_value.txt',
  AUTO_MESSAGE_FILE: './auto_message.txt',
  AUTO_MESSAGE_INTERVAL: 11 * 60 * 1000
};
const CLAY_ODDS = {
  'green':   { odds: 2,    key: '1/2',   color: 13, block: 'green_terracotta',    itemId: 463 },
  'red':     { odds: 3,    key: '1/3',   color: 14, block: 'red_terracotta',      itemId: 464 },
  'orange':  { odds: 4,    key: '1/4',   color: 1,  block: 'orange_terracotta',   itemId: 451 },
  'yellow':  { odds: 5,    key: '1/5',   color: 4,  block: 'yellow_terracotta',   itemId: 454 },
  'blue':    { odds: 6,    key: '1/6',   color: 11, block: 'blue_terracotta',     itemId: 461 },
  'magenta': { odds: 7,    key: '1/7',   color: 2,  block: 'magenta_terracotta',  itemId: 452 },
  'purple':  { odds: 8,    key: '1/8',   color: 10, block: 'purple_terracotta',   itemId: 460 },
  'gray':    { odds: 9,    key: '1/9',   color: 7,  block: 'gray_terracotta',     itemId: 457 },
  'black':   { odds: 1.5,  key: '2/3',   color: 15, block: 'black_terracotta',    itemId: 465 },
  'light_blue': { odds: 1.667, key: '3/5', color: 3, block: 'light_blue_terracotta', itemId: 450 },
  'lime':    { odds: 1.8,  key: '5/9',   color: 5,  block: 'lime_terracotta',     itemId: 455 },
  'white':   { odds: 'random', key: 'all', color: 0, block: 'white_terracotta',   itemId: 448 }
};
const CLAY_KEY_TO_ODDS = Object.fromEntries(Object.values(CLAY_ODDS).map(v => [v.key, v]));
const CLAY_BLOCK_TO_KEY = Object.fromEntries(Object.values(CLAY_ODDS).map(v => [v.block, v.key]));
const CLAY_ITEMID_TO_KEY = Object.fromEntries(Object.values(CLAY_ODDS).map(v => [v.itemId, v.key]));
const RANDOM_CLAY_KEYS = ['green', 'red', 'orange', 'yellow', 'blue', 'magenta', 'purple', 'gray', 'black'];
const VALID_KEYS = Object.values(CLAY_ODDS).map(v => v.key);

// ========== 期望值檔案 ==========
const DEFAULT_EXPECTED_VALUE = 0.925;
function getExpectedValue() {
  if (!fs.existsSync(CONFIG.EV_FILE)) {
    fs.writeFileSync(CONFIG.EV_FILE, DEFAULT_EXPECTED_VALUE.toString());
    return DEFAULT_EXPECTED_VALUE;
  }
  const val = parseFloat(fs.readFileSync(CONFIG.EV_FILE, 'utf8').trim());
  return isNaN(val) ? DEFAULT_EXPECTED_VALUE : val;
}
function setExpectedValue(val) {
  fs.writeFileSync(CONFIG.EV_FILE, val.toString());
}

// ========== 工具 ==========
function nowDateTimeStr() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10);
  const fullTime = d.toTimeString().slice(0,8);
  return { date, time: fullTime };
}
function oddsKeyToNumber(key) {
  if (CLAY_KEY_TO_ODDS[key]) return CLAY_KEY_TO_ODDS[key].odds;
  return key;
}
function reduceFraction(n, d) {
  function gcd(a, b) { return b == 0 ? a : gcd(b, a % b); }
  let g = gcd(n, d);
  return [n / g, d / g];
}
function calcDynamicOdds(ev, numer, denom) {
  if (!ev || !numer || !denom) return 0;
  let rate = ev * denom / numer;
  return Math.round(rate * 1000) / 1000;
}

// ========== 上下限檔案處理 ==========
const DEFAULT_LIMITS = {
  emerald: { min: 1, max: 1000000 },
  coin:    { min: 1, max: 100 }
};
if (!fs.existsSync(CONFIG.LIMIT_FILE)) {
  fs.writeFileSync(CONFIG.LIMIT_FILE, `money ${DEFAULT_LIMITS.emerald.min} ${DEFAULT_LIMITS.emerald.max}\ncoin ${DEFAULT_LIMITS.coin.min} ${DEFAULT_LIMITS.coin.max}\n`);
}
function getBetLimits() {
  if (!fs.existsSync(CONFIG.LIMIT_FILE)) return { ...DEFAULT_LIMITS };
  let emerald = { ...DEFAULT_LIMITS.emerald }, coin = { ...DEFAULT_LIMITS.coin };
  const lines = fs.readFileSync(CONFIG.LIMIT_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
  lines.forEach(line => {
    let tokens = line.trim().split(/\s+/);
    if (tokens[0] === 'money' && tokens.length >= 3) {
      emerald.min = parseInt(tokens[1]);
      emerald.max = parseInt(tokens[2]);
    } else if (tokens[0] === 'coin' && tokens.length >= 3) {
      coin.min = parseInt(tokens[1]);
      coin.max = parseInt(tokens[2]);
    }
  });
  return { emerald, coin };
}
function setBetLimit(type, min, max) {
  let limits = getBetLimits();
  if (type === 'money') limits.emerald = { min, max };
  else if (type === 'coin') limits.coin = { min, max };
  const content = `money ${limits.emerald.min} ${limits.emerald.max}\ncoin ${limits.coin.min} ${limits.coin.max}\n`;
  fs.writeFileSync(CONFIG.LIMIT_FILE, content);
}
// ========== 白名單 ==========
if (!fs.existsSync(CONFIG.WHITELIST_FILE)) fs.writeFileSync(CONFIG.WHITELIST_FILE, '');
function loadWhitelist() { return fs.readFileSync(CONFIG.WHITELIST_FILE, 'utf8').split(/\r?\n/).filter(Boolean); }
function isWhitelisted(player) { return loadWhitelist().includes(player); }

// ========== 補償記錄(全中文格式) ==========
if (!fs.existsSync(CONFIG.FILE_PATH)) fs.writeFileSync(CONFIG.FILE_PATH, '');
function loadAllPending() {
  let txt = '';
  try { txt = fs.readFileSync(CONFIG.FILE_PATH, "utf-8"); } catch { txt = ''; }
  const pending = [];
  txt.split('\n').forEach(line => {
    if (!line.trim()) return;
    let obj = {};
    line.trim().split(',').forEach(pair=>{
      let [k,v] = pair.split(':');
      if(k && v !== undefined) obj[k.trim()] = v.trim();
    });
    if (obj["玩家名稱"] && obj["狀態"]) pending.push(obj);
  });
  return pending;
}
function saveAllPending(pendingList) {
  const lines = pendingList.map(v =>
    `日期:${v["日期"]},時間:${v["時間"]},玩家名稱:${v["玩家名稱"]},賠率:${v["賠率"]},獎金:${v["獎金"]},貨幣:${v["貨幣"]||"emerald"},轉帳失敗原因:${v["轉帳失敗原因"]||""},狀態:${v["狀態"]}`
  );
  fs.writeFileSync(CONFIG.FILE_PATH, lines.join('\n') + (lines.length > 0 ? '\n' : ''));
}
function addPending(data) {
  const pending = loadAllPending();
  pending.push(data);
  saveAllPending(pending);
}
function findPendingUnpaidByPlayer(player) {
  return loadAllPending().filter(v => v["玩家名稱"] === player && v["狀態"] === "未支出");
}
function markAllPendingPaidForPlayerByUnique(record) {
  let pending = loadAllPending();
  let changed = false;
  pending.forEach(v => {
    if (
      v["玩家名稱"] === record["玩家名稱"] &&
      v["狀態"] === "未支出" &&
      Number(v["獎金"]) === Number(record["獎金"]) &&
      String(v["賠率"]) === String(record["賠率"]) &&
      String(v["時間"]) === String(record["時間"]) &&
      String(v["貨幣"]||"emerald") === String(record["貨幣"]||"emerald")
    ) {
      v["狀態"] = "已支出";
      changed = true;
    }
  });
  if (changed) saveAllPending(pending);
}

// ========== 玩家機率檔 ==========
function getPlayerRateRecordFile() {
  if (!fs.existsSync(CONFIG.RATE_FILE)) fs.writeFileSync(CONFIG.RATE_FILE, "");
  return fs.readFileSync(CONFIG.RATE_FILE, "utf-8").split("\n").filter(Boolean).map(line => {
    let [player, rate, start, expire, raw] = line.split(",");
    return { player, rate: rate.split(" "), start: +start, expire: +expire, raw: raw || "" };
  });
}
function savePlayerRateRecordFile(records) {
  fs.writeFileSync(CONFIG.RATE_FILE, records.map(r => [r.player, r.rate.join(" "), r.start, r.expire, r.raw || ""].join(",")).join("\n"));
}
function setPlayerRate(player, rateArr, content) {
  let now = Date.now();
  let expire = now + 3600 * 1000;
  let records = getPlayerRateRecordFile();
  records = records.filter(r => r.player !== player);
  records.push({ player, rate: rateArr, start: now, expire, raw: content || "" });
  savePlayerRateRecordFile(records);
}
function getPlayerRate(player) {
  let now = Date.now();
  let records = getPlayerRateRecordFile();
  let record = records.find(r => r.player === player && r.expire > now);
  if (!record) return null;
  return { rate: record.rate, expire: record.expire, raw: record.raw };
}
function clearExpiredRates() {
  let now = Date.now();
  let records = getPlayerRateRecordFile();
  let filtered = records.filter(r => r.expire > now);
  if (filtered.length !== records.length) savePlayerRateRecordFile(filtered);
}

// ========== 掃描紅石/陶土 ==========
function scanClayAndRedstoneAtLogin(bot) {
  const struct = [];
  const pos = bot.entity.position;
  const y = Math.floor(pos.y) - 1;
  for (let dx = -CONFIG.RS_SCAN_RADIUS; dx <= CONFIG.RS_SCAN_RADIUS; dx++) {
    for (let dz = -CONFIG.RS_SCAN_RADIUS; dz <= CONFIG.RS_SCAN_RADIUS; dz++) {
      let x = Math.floor(pos.x) + dx;
      let z = Math.floor(pos.z) + dz;
      let rsVec = new Vec3(x, y, z);
      let clayVec = new Vec3(x, y - 1, z);
      let rs = bot.blockAt(rsVec);
      let clay = bot.blockAt(clayVec);
      if (rs && rs.name === 'redstone_wire') {
        let clayName = clay ? clay.name : '(null)';
        let clayKey = CLAY_BLOCK_TO_KEY[clayName];
        if (clayKey && CLAY_KEY_TO_ODDS[clayKey]) {
          let clayObj = CLAY_KEY_TO_ODDS[clayKey];
          struct.push({
            redstone: { abs: rsVec.clone(), rel: rsVec.minus(pos) },
            clay: { abs: clayVec.clone(), rel: clayVec.minus(pos) },
            color: clayObj.color, odds: clayObj.odds,
            blockName: clay.name, key: clayObj.key
          });
        }
      }
    }
  }
  return struct;
}
function getAbsRedstoneStructList(bot, struct) {
  const pos = bot.entity.position;
  return struct.map(s => ({
    ...s,
    redstone: { abs: pos.plus(s.redstone.rel), rel: s.redstone.rel },
    clay: { abs: pos.plus(s.clay.rel), rel: s.clay.rel }
  }));
}

// ========== 轉帳記錄/掉落物 ==========
function logDroppedEntity(entity) {
  const t = new Date().toISOString();
  let foundItemId;
  if (entity.metadata) {
    for (let i = 0; i < entity.metadata.length; i++) {
      let m = entity.metadata[i];
      if (m && typeof m === 'object') {
        if ('itemId' in m) foundItemId = m.itemId;
        if ('id' in m && foundItemId === undefined) foundItemId = m.id;
      }
    }
  }
  let clayKeyFromItemId = (foundItemId !== undefined) ? CLAY_ITEMID_TO_KEY[foundItemId] : undefined;
  let keyText = clayKeyFromItemId || '無';
  console.log(`[記錄掉落物] ${t} id=${entity.id} name=${entity.name} itemId=${foundItemId !== undefined ? foundItemId : '無'} key=${keyText} pos=${entity.position ? entity.position.toString() : 'null'}`);
}
function monitorNearbyDroppedItems(bot) {
  let lastEntityIds = new Set();
  setInterval(() => {
    try {
      let nowEntityIds = new Set();
      for (let id in bot.entities) {
        let e = bot.entities[id];
        if (e && e.name === 'item') {
          nowEntityIds.add(id);
          if (!lastEntityIds.has(id)) {
            logDroppedEntity(e);
          }
        }
      }
      lastEntityIds = nowEntityIds;
    } catch (err) { console.error('[錯誤] 掃描掉落物時出錯:', err); }
  }, CONFIG.ITEM_MONITOR_INTERVAL);
}

// ========== 發送訊息 ==========
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
let msgHistory = [];
function canSendMsg() {
  const now = Date.now();
  msgHistory = msgHistory.filter(ts => now - ts < CONFIG.MSG_RATE_LIMIT_WINDOW);
  return msgHistory.length < CONFIG.MSG_RATE_LIMIT_COUNT;
}
let lastMsgTime = 0;
async function safeChat(bot, msg) {
  const now = Date.now();
  let wait = 0;
  if (!canSendMsg()) {
    let earliest = msgHistory[0];
    wait = Math.max(earliest + CONFIG.MSG_RATE_LIMIT_WINDOW - now, 0);
  }
  if (now - lastMsgTime < CONFIG.MSG_MIN_INTERVAL) {
    wait = Math.max(wait, CONFIG.MSG_MIN_INTERVAL - (now - lastMsgTime));
  }
  if (wait > 0) await sleep(wait);
  bot.chat(msg);
  msgHistory.push(Date.now());
  lastMsgTime = Date.now();
}
function sendPrivateMsg(bot, player, msg) {
  if (!msg) return;
  safeChat(bot, `/m ${player} ${msg}`);
}

// ========== 自動發話功能 ==========
if (!fs.existsSync(CONFIG.AUTO_MESSAGE_FILE)) fs.writeFileSync(CONFIG.AUTO_MESSAGE_FILE, '');
function loadAutoMessages() {
  try {
    return fs.readFileSync(CONFIG.AUTO_MESSAGE_FILE, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  } catch { return []; }
}
async function autoSendMessages(bot) {
  const lines = loadAutoMessages();
  for (let line of lines) {
    await safeChat(bot, line);
    await sleep(1000);
  }
}

// ========== Mineflayer主體 ==========
function createBot() {
  const bot = mineflayer.createBot({
    host: CONFIG.SERVER,
    username: process.env.MC_EMAIL,
    password: process.env.MC_PASSWORD,
    auth: 'microsoft',
    version: '1.21.4'
  });

  // 忽略自訂粒子協議等錯誤，讓 bot 不會因為 PartialReadError 掛掉
  bot._client.on('error', (err) => {
    if (
      err && err.message && (
        err.message.includes('PartialReadError') ||
        err.message.includes('packet_world_particles')
      )
    ) {
      // 完全不輸出
      return;
    }
    console.error('[Mineflayer Error]', err);
  });

  let taskQueue = [];
  let waitingQueue = [];
  let isProcessing = false;
  let messageHistory = [];
  let lastPositionCheck = 0;
  let currentBalance = 0;
  let currentCoinBalance = 0;
  let lookInterval = null;
  let structOnLogin = null;
  let initialized = false;
  let gamblingPaused = false;
  let lastPayFailPlayer = null;
  let lastPayFailAmount = null;
  let lastPayFailOdds = null;
  let lastCompensatePlayer = null;
  let lastCompensateAmount = null;
  let compensateFailNotified = {};
  let lastCompensateRecords = [];
  let pendingCoinTransfer = null;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('line', async (input) => { if (bot && input.trim()) { await safeChat(bot, input.trim()); } });

  bot.on('entitySpawn', (entity) => { if (entity.name === 'item') logDroppedEntity(entity); });
  bot.once('spawn', () => { monitorNearbyDroppedItems(bot); });
  bot.on('chat', (username, message) => { if (username !== bot.username) { const now = new Date(); const timeStr = now.toTimeString().split(' ')[0]; console.log(`[聊天][${timeStr}] <${username}>: ${message}`); } });

  // 記錄是否有最新一次查詢到的餘額
  let lastMoneyQuery = 0;
  let lastCoinQuery = 0;
  let lastRequestedBalPlayer = null;

  bot.on('message', (msg, position, jsonMsg, sender) => {
    let text = msg.toString().trim();
    if (text) console.log(`[系統][${(new Date()).toTimeString().split(' ')[0]}]: ${text}`);
    try {
      if (!text) return;
      addToHistory(text);
      handleEmeraldTransfer(text);
      handleVillagerCoinTransfer(text);
      handleBalanceQuery(text);
      handleCoinBalanceQuery(text);
      handlePrivateMessage(msg, text);
      handlePayFailNotice(text);
      handlePaySuccessNotice(text);
    } catch (err) { 
      console.error('[錯誤] 處理訊息時出錯:', err); 
    }
  });

  lookInterval = setInterval(() => scanAndFollowPlayer(bot), 400);

  // ========== 自動發話排程 ==========
  let autoMsgTimer = null;
  async function startAutoMessageLoop() {
    if (autoMsgTimer) clearInterval(autoMsgTimer);
    setTimeout(() => autoSendMessages(bot), 20000);
    autoMsgTimer = setInterval(() => autoSendMessages(bot), CONFIG.AUTO_MESSAGE_INTERVAL);
    autoMsgTimer.unref && autoMsgTimer.unref();
  }

  async function recordBalancesAtLogin() {
    await safeChat(bot, '/money');
    await sleep(1000);
    await safeChat(bot, '/coin');
    await sleep(1000);
  }

  bot.on('login', async () => {
    initialized = false;
    await recordBalancesAtLogin();
    structOnLogin = scanClayAndRedstoneAtLogin(bot);
    initialized = true;
    if (waitingQueue.length > 0) {
      taskQueue = taskQueue.concat(waitingQueue);
      waitingQueue = [];
      processQueue();
    }
    startAutoMessageLoop();
  });

  bot.on('spawn', async () => {
    initialized = false;
    await checkPosition();
    await recordBalancesAtLogin();
    structOnLogin = scanClayAndRedstoneAtLogin(bot);
    initialized = true;
    if (waitingQueue.length > 0) {
      taskQueue = taskQueue.concat(waitingQueue);
      waitingQueue = [];
      processQueue();
    }
    startAutoMessageLoop();
  });

  bot.on('end', (reason) => { 
    if (lookInterval) clearInterval(lookInterval); 
    if (autoMsgTimer) clearInterval(autoMsgTimer);
    setTimeout(createBot, CONFIG.RECONNECT_DELAY); 
  });
  bot.on('error', (err) => { console.error('[錯誤]', err); });

  function addToHistory(message) { messageHistory.push(message); if (messageHistory.length > CONFIG.MAX_HISTORY) messageHistory.shift(); }

  function handlePayFailNotice(message) {
    const failKeywords = [
      "只能轉帳給同一分流的線上玩家",
      "轉帳失敗",
      "請檢查對方的ID與所在分流",
      "無法轉帳",
      "不在線",
      "pay失敗",
      "只能",
      "失敗"
    ];
    let isFail = failKeywords.some(k => message.includes(k));
    if (isFail) {
      if (lastPayFailPlayer && lastPayFailAmount) {
        const { date, time } = nowDateTimeStr();
        addPending({
          "日期": date,
          "時間": time,
          "玩家名稱": lastPayFailPlayer,
          "賠率": lastPayFailOdds || '',
          "獎金": lastPayFailAmount,
          "貨幣": "emerald",
          "轉帳失敗原因": message,
          "狀態": "未支出"
        });
        sendPrivateMsg(bot, lastPayFailPlayer, `轉帳失敗！您的${Math.floor(lastPayFailAmount)}綠寶石已記錄，請私訊"領錢"或"pay"領回。`);
        lastPayFailPlayer = null;
        lastPayFailAmount = null;
        lastPayFailOdds = null;
      }
      if (lastCompensatePlayer && lastCompensateAmount && lastCompensateRecords.length > 0) {
        if (!compensateFailNotified[lastCompensatePlayer]) {
          sendPrivateMsg(bot, lastCompensatePlayer, `補償轉帳失敗，請至74分流再嘗試一次或通知管理員！您的${Math.floor(lastCompensateAmount)}綠寶石尚未成功領取。`);
          compensateFailNotified[lastCompensatePlayer] = true;
        }
      }
      if (pendingCoinTransfer) {
        sendPrivateMsg(bot, pendingCoinTransfer.player, `村民錠轉帳失敗，請至74分流再嘗試一次或通知管理員！您的${pendingCoinTransfer.amount}村民錠尚未成功領取。`);
        pendingCoinTransfer = null;
      }
    }
  }

  function handlePaySuccessNotice(message) {
    const payOk = message.match(/^\[系統\].*成功轉帳\s*([\d,]+)\s*綠寶石\s*給\s*([^\s]+)\s*\(.*$/);
    if (payOk && lastCompensatePlayer && lastCompensateAmount && lastCompensateRecords.length > 0) {
      const amount = parseInt(payOk[1].replace(/,/g, ''));
      const player = payOk[2];
      if (
        player === lastCompensatePlayer &&
        amount === Number(lastCompensateAmount)
      ) {
        lastCompensateRecords.forEach(record => {
          markAllPendingPaidForPlayerByUnique(record);
        });
        sendPrivateMsg(bot, lastCompensatePlayer, `補償轉帳成功！已領取${amount}綠寶石`);
        onPaySuccess(lastCompensatePlayer, amount);
        lastCompensatePlayer = null;
        lastCompensateAmount = null;
        lastCompensateRecords = [];
        compensateFailNotified[player] = false;
      }
    }
    if (pendingCoinTransfer && message.match(/^\[系統\].*成功轉帳.*村民錠.*給\s*([^\s]+)\s*\(.*$/)) {
      sendPrivateMsg(bot, pendingCoinTransfer.player, `補償村民錠轉帳成功！已領取${pendingCoinTransfer.amount}村民錠`);
      pendingCoinTransfer = null;
    }
  }

  function onPaySuccess(player, amount) {
    broadcastLotteryResult(`pay_success|${player}|${amount}`);
  }

  function handleEmeraldTransfer(message) {
    try {
      const transferRegex = /您收到了\s+([^\s]+)\s+轉帳的\s*([\d,]+)\s*綠寶石\s*[（(]\s*目前擁有\s*([\d,]+)\s*綠寶石[）)]/;
      const match = message.match(transferRegex);
      if (match) {
        if (gamblingPaused) return;
        const player = match[1];
        const amount = parseInt(match[2].replace(/,/g, ''));
        const newBalance = parseInt(match[3].replace(/,/g, ''));
        currentBalance = newBalance;
        const task = { type: 'emerald', player, amount, timestamp: Date.now() };
        if (!initialized) waitingQueue.push(task);
        else { taskQueue.push(task); processQueue(); }
        lastPayFailPlayer = player;
        lastPayFailAmount = null;
        lastPayFailOdds = null;
      }
    } catch (err) { console.error('[錯誤] 處理轉帳時出錯:', err); }
  }

  function handleVillagerCoinTransfer(message) {
    const villagerCoinRegex = /您收到了\s+([^\s]+)\s+送來的\s*([\d,]+)\s*村民錠.*目前擁有\s*([\d,]+)\s*村民錠/;
    const match = message.match(villagerCoinRegex);
    if (match) {
      if (gamblingPaused) return;
      const player = match[1];
      const amount = parseInt(match[2].replace(/,/g, ''));
      const newCoin = parseInt(match[3].replace(/,/g, ''));
      currentCoinBalance = newCoin;
      const task = { type: 'coin', player, amount, timestamp: Date.now() };
      if (!initialized) waitingQueue.push(task);
      else { taskQueue.push(task); processQueue(); }
    }
  }

  function handleBalanceQuery(message) {
    try {
      const moneyRegex = /金錢：＄([\d,]+)/;
      const balanceRegex = /綠寶石＄([\d,]+)個/;
      let match = message.match(balanceRegex);
      if (match) {
        currentBalance = parseInt(match[1].replace(/,/g, ''));
        lastMoneyQuery = Date.now();
        if (lastRequestedBalPlayer) trySendBalResult();
      } else if ((match = message.match(moneyRegex))) {
        currentBalance = parseInt(match[1].replace(/,/g, ''));
        lastMoneyQuery = Date.now();
        if (lastRequestedBalPlayer) trySendBalResult();
      }
    } catch (err) { console.error('[錯誤] 處理餘額查詢時出錯:', err); }
  }
  function handleCoinBalanceQuery(message) {
    try {
      const coinRegex1 = /村民錠\s*:\s*([\d,]+)/;
      const coinRegex2 = /目前有\s*([\d,]+)\s*村民錠/;
      let match = message.match(coinRegex1) || message.match(coinRegex2);
      if (match) {
        currentCoinBalance = parseInt(match[1].replace(/,/g, ''));
        lastCoinQuery = Date.now();
        if (lastRequestedBalPlayer) trySendBalResult();
      }
    } catch (err) { console.error('[錯誤] 處理村民錠餘額查詢時出錯:', err); }
  }

  function trySendBalResult() {
    if (!lastRequestedBalPlayer) return;
    if ((Date.now() - lastMoneyQuery > 2000) || (Date.now() - lastCoinQuery > 2000)) return;
    sendPrivateMsg(bot, lastRequestedBalPlayer, `綠寶石:${currentBalance},村民錠:${currentCoinBalance}`);
    lastRequestedBalPlayer = null;
  }

  function handlePlayerCustomRate(pmFrom, pmText) {
    let arr = pmText.split(/\s+/).filter(s => !!s);
    if (arr.length === 0) return false;
    if (arr.length === 1 && arr[0].toLowerCase() === 'all') {
      setPlayerRate(pmFrom, ['all'], pmText);
      sendPrivateMsg(bot, pmFrom, `目前賠率已更改為隨機1.5～9,將持續1小時`);
      return true;
    } else if (arr.length === 1 && VALID_KEYS.includes(arr[0])) {
      setPlayerRate(pmFrom, [arr[0]], pmText);
      sendPrivateMsg(bot, pmFrom, `您的遊戲機率已更改為 ${arr[0]}，將持續1小時。`);
      return true;
    } else if (arr.length === 2 && VALID_KEYS.includes(arr[0]) && VALID_KEYS.includes(arr[1])) {
      setPlayerRate(pmFrom, arr, pmText);
      let n1 = arr[0].split('/');
      let n2 = arr[1].split('/');
      let numer = parseInt(n1[0]) * parseInt(n2[0]);
      let denom = parseInt(n1[1]) * parseInt(n2[1]);
      let [an, ad] = reduceFraction(numer, denom);
      sendPrivateMsg(bot, pmFrom, `您的遊戲機率已更改為 ${arr[0]} ${arr[1]}，組合機率${an}/${ad}，將持續1小時。`);
      return true;
    }
    return false;
  }

  function handlePrivateMessage(msg, text) {
    const pmMatch = text.match(/^\[([^\]]+)-> ?您\] ?(.+)$/);
    if (!pmMatch) return;
    const pmFrom = pmMatch[1].trim();
    const pmText = pmMatch[2].trim();

    if (isWhitelisted(pmFrom)) {
      if (/^money\s+\d+\s+\d+$/i.test(pmText)) {
        const [, min, max] = pmText.match(/^money\s+(\d+)\s+(\d+)$/i);
        setBetLimit('money', parseInt(min), parseInt(max));
        sendPrivateMsg(bot, pmFrom, `綠寶石賭注上下限已設定為 ${min} ~ ${max}`);
        return;
      }
      if (/^coin\s+\d+\s+\d+$/i.test(pmText)) {
        const [, min, max] = pmText.match(/^coin\s+(\d+)\s+(\d+)$/i);
        setBetLimit('coin', parseInt(min), parseInt(max));
        sendPrivateMsg(bot, pmFrom, `村民錠賭注上下限已設定為 ${min} ~ ${max}`);
        return;
      }
      if (/^set\s*(\d*\.?\d+)$/i.test(pmText)) {
        const ev = parseFloat(pmText.match(/^set\s*(\d*\.?\d+)$/i)[1]);
        if (!isNaN(ev) && ev > 0 && ev <= 1) {
          setExpectedValue(ev);
          sendPrivateMsg(bot, pmFrom, `期望值已設定為 ${ev}`);
        } else {
          sendPrivateMsg(bot, pmFrom, `期望值設定錯誤，請輸入0~1之間的數字`);
        }
        return;
      }
      if (/^get\s+\d+\s+\d+$/i.test(pmText)) {
        const [, emeraldStr, villagerStr] = pmText.match(/^get\s+(\d+)\s+(\d+)$/i);
        const emerald = parseInt(emeraldStr);
        const villager = parseInt(villagerStr);
        (async () => {
          if (emerald > 0) {
            await safeChat(bot, `/pay ${pmFrom} ${emerald}`);
            sendPrivateMsg(bot, pmFrom, `已轉帳${emerald} 綠寶石`);
          }
          if (villager > 0) {
            await safeChat(bot, `/cointrans ${pmFrom} ${villager}`);
            await sleep(1000);
            await safeChat(bot, pmFrom);
            pendingCoinTransfer = { player: pmFrom, amount: villager };
            sendPrivateMsg(bot, pmFrom, `已發起村民錠轉帳指令(${villager}村民錠)，請稍候查收`);
          }
        })();
        return;
      }
      if (/^bal$/i.test(pmText)) {
        lastRequestedBalPlayer = pmFrom;
        lastMoneyQuery = 0;
        lastCoinQuery = 0;
        safeChat(bot, `/money`);
        setTimeout(() => { safeChat(bot, `/coin`); }, 1000);
        return;
      }
      if (/^stop$/i.test(pmText)) {
        gamblingPaused = true;
        sendPrivateMsg(bot, pmFrom, `賭博系統已暫停`);
        return;
      }
      if (/^go$/i.test(pmText)) {
        gamblingPaused = false;
        sendPrivateMsg(bot, pmFrom, `賭博系統已恢復`);
        return;
      }
      if (/^re$/i.test(pmText)) {
        sendPrivateMsg(bot, pmFrom, `即將重新連線`);
        setTimeout(() => bot.end(), 1000);
        return;
      }
      if (/^say\s+(.+)$/i.test(pmText)) {
        const sayText = pmText.match(/^say\s+(.+)$/i)[1];
        safeChat(bot, sayText);
        sendPrivateMsg(bot, pmFrom, `已發送訊息：「${sayText}」`);
        return;
      }
    }

    if (handlePlayerCustomRate(pmFrom, pmText)) return;

    if (/^(領錢|pay)$/i.test(pmText)) {
      let pending = findPendingUnpaidByPlayer(pmFrom);
      if (pending.length === 0) {
        sendPrivateMsg(bot, pmFrom, `目前沒有您的積欠款項`);
        lastCompensatePlayer = null;
        lastCompensateAmount = null;
        lastCompensateRecords = [];
        compensateFailNotified[pmFrom] = false;
        return;
      }
      let total = pending.filter(p=>!p["貨幣"]||p["貨幣"]==="emerald").reduce((sum, p) => sum + Number(p["獎金"]), 0);
      let totalCoin = pending.filter(p=>p["貨幣"]==="coin").reduce((sum, p) => sum + Number(p["獎金"]), 0);
      let emeraldRecords = pending.filter(p=>!p["貨幣"]||p["貨幣"]==="emerald").map(p => ({ ...p }));
      let coinRecords = pending.filter(p=>p["貨幣"]==="coin").map(p => ({ ...p }));
      (async () => {
        if (total > 0) {
          try {
            lastCompensatePlayer = pmFrom;
            lastCompensateAmount = total;
            lastCompensateRecords = emeraldRecords;
            compensateFailNotified[pmFrom] = false;
            await safeChat(bot, `/pay ${pmFrom} ${total}`);
            sendPrivateMsg(bot, pmFrom, `已轉帳您的積欠款項總計：${total} 綠寶石`);
          } catch (err) {
            if (!compensateFailNotified[pmFrom]) {
              sendPrivateMsg(bot, pmFrom, `轉帳失敗，請至74分流再嘗試一次`);
              compensateFailNotified[pmFrom] = true;
            }
          }
        }
        if (totalCoin > 0) {
          try {
            pendingCoinTransfer = { player: pmFrom, amount: totalCoin, records: coinRecords };
            await safeChat(bot, `/cointrans ${pmFrom} ${totalCoin}`);
            await sleep(1000);
            await safeChat(bot, pmFrom);
            sendPrivateMsg(bot, pmFrom, `已發起村民錠補償共${totalCoin}，請稍候查收`);
          } catch (err) {
            sendPrivateMsg(bot, pmFrom, `村民錠補償指令執行失敗，請至74分流再嘗試一次`);
          }
        }
        if (total===0 && totalCoin===0) {
          sendPrivateMsg(bot, pmFrom, `目前沒有您的積欠款項`);
        }
      })();
      return;
    }
  }

  async function processQueue() {
    if (isProcessing || taskQueue.length === 0 || gamblingPaused) return;
    isProcessing = true;
    let task = taskQueue.shift();
    try {
      let limits = getBetLimits();
      if (task.type === 'emerald') {
        let min = limits.emerald.min, max = limits.emerald.max;
        if (task.amount < min || task.amount > max) {
          await safeChat(bot, `/pay ${task.player} ${task.amount}`);
          await sleep(CONFIG.MSG_MIN_INTERVAL);
          sendPrivateMsg(bot, task.player, `賭注範圍為${min}~${max}綠寶石，已退款${task.amount}綠寶石，請勿超過上限`);
          isProcessing = false;
          processQueue();
          return;
        }
      }
      if (task.type === 'coin') {
        let min = limits.coin.min, max = limits.coin.max;
        if (task.amount < min || task.amount > max) {
          await safeChat(bot, `/cointrans ${task.player} ${task.amount}`);
          await sleep(1000);
          await safeChat(bot, task.player);
          await sleep(CONFIG.MSG_MIN_INTERVAL);
          sendPrivateMsg(bot, task.player, `村民錠賭注範圍為${min}~${max}，已退款${task.amount}村民錠，請勿超過上限`);
          isProcessing = false;
          processQueue();
          return;
        }
      }
      clearExpiredRates();
      let record = getPlayerRate(task.player);
      let rates = record ? record.rate : ['1/2'];
      if (rates.length > 2) rates = ['1/2'];
      let oddsArr = [];
      let messageOddsStr = '';
      let payout = 0;
      let oddsNumber = 2;
      let oddsKey = '1/2';
      let ev = getExpectedValue();
      let showOddsValue = null;
      if (rates.length === 2) {
        let n1 = rates[0].split('/');
        let n2 = rates[1].split('/');
        let numer = parseInt(n1[0]) * parseInt(n2[0]);
        let denom = parseInt(n1[1]) * parseInt(n2[1]);
        let [an, ad] = reduceFraction(numer, denom);
        oddsNumber = ad / an;
        oddsKey = `${an}/${ad}`;
        showOddsValue = calcDynamicOdds(ev, an, ad);
        messageOddsStr = `[機率${an}/${ad}] [賠率${showOddsValue}]`;
        payout = Math.floor(task.amount * showOddsValue);
        oddsArr = rates;
      } else if (rates[0] === 'all') {
        messageOddsStr = '[隨機機率1.5～9]';
        payout = Math.floor(task.amount * 9);
        oddsArr = ['all'];
        oddsNumber = '隨機';
        oddsKey = 'all';
      } else {
        let v = CLAY_KEY_TO_ODDS[rates[0]];
        let [an, ad] = rates[0].split('/').map(x => parseInt(x));
        if (!isNaN(an) && !isNaN(ad)) {
          showOddsValue = calcDynamicOdds(ev, an, ad);
          messageOddsStr = `[機率${rates[0]}] [賠率${showOddsValue}]`;
          payout = Math.floor(task.amount * showOddsValue);
        } else {
          showOddsValue = v.odds;
          messageOddsStr = `[機率${rates[0]}] [賠率${showOddsValue}]`;
          payout = Math.floor(task.amount * v.odds);
        }
        oddsArr = [rates[0]];
        oddsNumber = showOddsValue;
        oddsKey = rates[0];
      }

      let maxPayout = payout;
      if (oddsArr.length === 2) {
        let n1 = oddsArr[0].split('/');
        let n2 = oddsArr[1].split('/');
        let numer = parseInt(n1[0]) * parseInt(n2[0]);
        let denom = parseInt(n1[1]) * parseInt(n2[1]);
        let [an, ad] = reduceFraction(numer, denom);
        let comboOdds = calcDynamicOdds(ev, an, ad);
        maxPayout = Math.floor(task.amount * comboOdds);
      } else if (oddsArr[0] === 'all') {
        maxPayout = Math.floor(task.amount * 9);
      }

      lastPayFailPlayer = task.player;
      lastPayFailAmount = payout;
      lastPayFailOdds = showOddsValue;

      let absStruct = getAbsRedstoneStructList(bot, structOnLogin);

      try {
        if (oddsArr.length === 1 && oddsArr[0] === 'all') {
          await triggerWhiteClayRedstoneAndAutoJudge(bot, absStruct, task.player, task.amount, messageOddsStr, task.type);
        } else if (oddsArr.length === 1) {
          await triggerClayRedstoneAndCheckWin(bot, absStruct, oddsArr[0], task.player, false, false, messageOddsStr, task.amount, false, 0, showOddsValue, task.type);
        } else if (oddsArr.length === 2) {
          let n1 = oddsArr[0].split('/');
          let n2 = oddsArr[1].split('/');
          let numer = parseInt(n1[0]) * parseInt(n2[0]);
          let denom = parseInt(n1[1]) * parseInt(n2[1]);
          let [an, ad] = reduceFraction(numer, denom);
          let comboOdds = calcDynamicOdds(ev, an, ad);
          let firstWin = await triggerClayRedstoneAndCheckWin(bot, absStruct, oddsArr[0], task.player, false, true, messageOddsStr, task.amount, true, 0, comboOdds, task.type);
          if (firstWin) {
            await triggerClayRedstoneAndCheckWin(bot, absStruct, oddsArr[1], task.player, false, true, messageOddsStr, task.amount, false, Math.floor(task.amount * comboOdds), comboOdds, task.type);
          }
        }
      } catch (err) {
        const { date, time } = nowDateTimeStr();
        addPending({
          "日期": date,
          "時間": time,
          "玩家名稱": task.player,
          "賠率": showOddsValue,
          "獎金": task.amount,
          "貨幣": task.type,
          "轉帳失敗原因": "開獎過程失敗/斷線/異常",
          "狀態": "未支出"
        });
        sendPrivateMsg(bot, task.player, `您的賭注因系統異常未能完成開獎，請用"領錢"或"pay"私訊BOT補發。`);
        lastPayFailPlayer = task.player;
        lastPayFailAmount = task.amount;
        lastPayFailOdds = showOddsValue;
      }
    } catch (err) { }
    finally {
      isProcessing = false;
      if (taskQueue.length > 0) setTimeout(processQueue, 1000);
    }
  }

  async function triggerWhiteClayRedstoneAndAutoJudge(bot, absStruct, player, amount, messageOddsStr, currencyType = 'emerald') {
    let struct = absStruct.find(s => s.key === 'all' || s.color == 0);
    if (!struct) throw new Error("未找到白色陶土結構");
    let rsBlock = bot.blockAt(struct.redstone.abs);
    if (!rsBlock) throw new Error("未找到紅石線");
    await bot.lookAt(rsBlock.position.offset(0.5, 0.5, 0.5));
    await sleep(250);
    await bot.activateBlock(rsBlock);

    return await new Promise((resolve, reject) => {
      let idSet = new Set(Object.keys(bot.entities));
      let found = false;
      let dropKey = null;
      function handler(entity) {
        if (found) return;
        if (entity.name === 'item' && entity.position && struct.redstone.abs.distanceTo(entity.position) <= CONFIG.WIN_LOSE_SCAN_RANGE*2) {
          let itemId;
          if (entity.metadata && entity.metadata[8] && typeof entity.metadata[8].itemId !== 'undefined') {
            itemId = entity.metadata[8].itemId;
          } else if (entity.metadata && entity.metadata[8] && typeof entity.metadata[8].id !== 'undefined') {
            itemId = entity.metadata[8].id;
          }
          dropKey = CLAY_ITEMID_TO_KEY[itemId];
          if (dropKey && RANDOM_CLAY_KEYS.includes(Object.keys(CLAY_ODDS).find(k => CLAY_ODDS[k].key === dropKey))) {
            found = true;
            bot.removeListener('entitySpawn', handler);
            clearInterval(interval);
            triggerClayRedstoneAndCheckWin(bot, absStruct, dropKey, player, false, false, `[隨機機率${dropKey}]`, amount, false, 0, oddsKeyToNumber(dropKey), currencyType)
              .then(resolve)
              .catch(reject);
          }
        }
      }
      bot.on('entitySpawn', handler);
      let interval = setInterval(() => {
        if (found) return;
        for (let id in bot.entities) {
          if (idSet.has(id)) continue;
          let e = bot.entities[id];
          if (e.name === 'item' && e.position && struct.redstone.abs.distanceTo(e.position) <= CONFIG.WIN_LOSE_SCAN_RANGE*2) {
            let itemId;
            if (e.metadata && e.metadata[8] && typeof e.metadata[8].itemId !== 'undefined') {
              itemId = e.metadata[8].itemId;
            } else if (e.metadata && e.metadata[8] && typeof e.metadata[8].id !== 'undefined') {
              itemId = e.metadata[8].id;
            }
            dropKey = CLAY_ITEMID_TO_KEY[itemId];
            if (dropKey && RANDOM_CLAY_KEYS.includes(Object.keys(CLAY_ODDS).find(k => CLAY_ODDS[k].key === dropKey))) {
              found = true;
              bot.removeListener('entitySpawn', handler);
              clearInterval(interval);
              triggerClayRedstoneAndCheckWin(bot, absStruct, dropKey, player, false, false, `[隨機機率${dropKey}]`, amount, false, 0, oddsKeyToNumber(dropKey), currencyType)
                .then(resolve)
                .catch(reject);
            }
          }
        }
      }, 30);
      setTimeout(() => {
        if (!found) {
          bot.removeListener('entitySpawn', handler);
          clearInterval(interval);
          reject(new Error("開獎超時"));
        }
      }, 6000);
    });
  }

  async function triggerClayRedstoneAndCheckWin(bot, absStruct, key, player, isRandom, comboMode, messageOddsStr, amount, isFirst = false, comboPayout = 0, oddsNumberParam = 2, currencyType = 'emerald') {
    let struct = absStruct.find(s => s.key === key);
    if (!struct) throw new Error("未找到對應陶土結構");
    let rsBlock = bot.blockAt(struct.redstone.abs);
    if (!rsBlock) throw new Error("未找到紅石線");
    await bot.lookAt(rsBlock.position.offset(0.5, 0.5, 0.5));
    await sleep(250);
    await bot.activateBlock(rsBlock);
    let win = await waitForWoolDrop(bot, struct.redstone.abs, CONFIG.WIN_LOSE_SCAN_RANGE * 2, player, isRandom, comboMode);
    let ev = getExpectedValue();
    let showOddsValue = oddsNumberParam;
    let dispName = `[${nowDateTimeStr().time}]`;

    // ======= 下注結果廣播與pay =======
    let oddsKey = key;
    let payout = Math.floor(amount * showOddsValue);

    if (comboMode && isFirst) {
      if (!win) {
        await safeChat(bot, `${dispName} ${messageOddsStr} [${player}] 未中獎`);
        broadcastLotteryResult(`${player} 下注機率${oddsKey} **${amount}** 綠寶石，未中獎`);
      }
      return win;
    } else if (comboMode && !isFirst) {
      if (win) {
        await safeChat(bot, `${dispName} ${messageOddsStr} [${player}] 恭喜中獎 [${amount}→${comboPayout}${currencyType==='emerald'?'綠寶石':'村民錠'}]`);
        try {
          if (currencyType === 'emerald') {
            await safeChat(bot, `/pay ${player} ${comboPayout}`);
            broadcastLotteryResult(`${player} 下注機率${oddsKey} **${amount}** 綠寶石，中獎 **${comboPayout}**`);
          } else if (currencyType === 'coin') {
            await safeChat(bot, `/cointrans ${player} ${comboPayout}`);
            await sleep(1000);
            await safeChat(bot, player);
            broadcastLotteryResult(`${player} 下注機率${oddsKey} **${amount}** 村民錠，中獎 **${comboPayout}**`);
          }
        } catch (e) {
          broadcastLotteryResult(`${player} 下注機率${oddsKey} **${amount}** 綠寶石，中獎 **${comboPayout}**（轉帳失敗）`);
          const { date, time } = nowDateTimeStr();
          addPending({
            "日期": date,
            "時間": time,
            "玩家名稱": player,
            "賠率": showOddsValue,
            "獎金": comboPayout,
            "貨幣": currencyType,
            "轉帳失敗原因": "組合下注pay失敗",
            "狀態": "未支出"
          });
        }
      } else {
        await safeChat(bot, `${dispName} ${messageOddsStr} [${player}] 未中獎`);
        broadcastLotteryResult(`${player} 下注機率${oddsKey} **${amount}** 綠寶石，未中獎`);
      }
      return win;
    } else {
      if (win) {
        await safeChat(bot, `${dispName} ${messageOddsStr} [${player}] 恭喜中獎 [${amount}→${payout}${currencyType==='emerald'?'綠寶石':'村民錠'}]`);
        try {
          if (currencyType === 'emerald') {
            await safeChat(bot, `/pay ${player} ${payout}`);
            broadcastLotteryResult(`${player} 下注機率${oddsKey} **${amount}** 綠寶石，中獎 **${payout}**`);
          } else if (currencyType === 'coin') {
            await safeChat(bot, `/cointrans ${player} ${payout}`);
            await sleep(1000);
            await safeChat(bot, player);
            broadcastLotteryResult(`${player} 下注機率${oddsKey} **${amount}** 村民錠，中獎 **${payout}**`);
          }
        } catch (e) {
          broadcastLotteryResult(`${player} 下注機率${oddsKey} **${amount}** 綠寶石，中獎 **${payout}**（轉帳失敗）`);
          const { date, time } = nowDateTimeStr();
          addPending({
            "日期": date,
            "時間": time,
            "玩家名稱": player,
            "賠率": showOddsValue,
            "獎金": payout,
            "貨幣": currencyType,
            "轉帳失敗原因": "pay失敗",
            "狀態": "未支出"
          });
        }
      } else {
        await safeChat(bot, `${dispName} ${messageOddsStr} [${player}] 未中獎`);
        broadcastLotteryResult(`${player} 下注機率${oddsKey} **${amount}** 綠寶石，未中獎`);
      }
      return win;
    }
  }

  async function waitForWoolDrop(bot, center, range, player, isRandom, comboMode) {
    return await new Promise((resolve, reject) => {
      let idSet = new Set(Object.keys(bot.entities));
      let found = false;
      function handler(entity) {
        if (found) return;
        if (entity.name === 'item' && entity.position && center.distanceTo(entity.position) <= range) {
          let itemId;
          if (entity.metadata && entity.metadata[8] && typeof entity.metadata[8].itemId !== 'undefined') {
            itemId = entity.metadata[8].itemId;
          } else if (entity.metadata && entity.metadata[8] && typeof entity.metadata[8].id !== 'undefined') {
            itemId = entity.metadata[8].id;
          }
          if (itemId === 209) { found = true; cleanup(); resolve(true); }
          else if (itemId === 224) { found = true; cleanup(); resolve(false); }
        }
      }
      bot.on('entitySpawn', handler);
      let interval = setInterval(() => {
        if (found) return;
        for (let id in bot.entities) {
          if (idSet.has(id)) continue;
          let e = bot.entities[id];
          if (e.name === 'item' && e.position && center.distanceTo(e.position) <= range) {
            let itemId;
            if (e.metadata && e.metadata[8] && typeof e.metadata[8].itemId !== 'undefined') {
              itemId = e.metadata[8].itemId;
            } else if (e.metadata && e.metadata[8] && typeof e.metadata[8].id !== 'undefined') {
              itemId = e.metadata[8].id;
            }
            if (itemId === 209) { found = true; cleanup(); resolve(true); }
            else if (itemId === 224) { found = true; cleanup(); resolve(false); }
          }
        }
      }, 30);
      function cleanup() {
        bot.removeListener('entitySpawn', handler);
        clearInterval(interval);
      }
      setTimeout(() => { if (!found) { cleanup(); reject(new Error('羊毛掉落超時')); } }, 6000);
    });
  }

  async function checkPosition() {
    try {
      const now = Date.now();
      if (now - lastPositionCheck < CONFIG.CHECK_POS_INTERVAL) return;
      lastPositionCheck = now;
      const pos = bot.entity.position;
      if (Math.abs(pos.x - CONFIG.SAFE_POSITION.x) > 5 ||
        Math.abs(pos.y - CONFIG.SAFE_POSITION.y) > 5 ||
        Math.abs(pos.z - CONFIG.SAFE_POSITION.z) > 5) {
        await safeChat(bot, `/warp onlyfun17`);
        await sleep(5000);
        structOnLogin = scanClayAndRedstoneAtLogin(bot);
      }
    } catch (err) { console.error('[錯誤] 檢查位置時出錯:', err); }
  }

  setInterval(() => { checkPosition().catch(err => { console.error('[錯誤] 檢查位置時出錯:', err); }); }, 10000).unref();

  let followPlayer = null;
  function scanAndFollowPlayer(bot) {
    if (followPlayer && bot.entities[followPlayer.id]) {
      const entity = bot.entities[followPlayer.id];
      if (entity && entity.position && bot.entity.position.distanceTo(entity.position) <= CONFIG.PLAYER_SCAN_RANGE) {
        bot.lookAt(entity.position.offset(0, 1.5, 0));
        return;
      } else {
        followPlayer = null;
      }
    }
    let minDist = Infinity, target = null;
    for (const id in bot.entities) {
      const e = bot.entities[id];
      if (e.type === 'player' && e.username !== bot.username) {
        const dist = bot.entity.position.distanceTo(e.position);
        if (dist <= CONFIG.PLAYER_SCAN_RANGE && dist < minDist) {
          minDist = dist;
          target = e;
        }
      }
    }
    if (target) {
      followPlayer = target;
      bot.lookAt(target.position.offset(0, 1.5, 0));
    }
  }
}

createBot();