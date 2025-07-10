require('dotenv').config({ path: 'discord.env' }); // 指定你的 env 檔
const fs = require('fs');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const BROADCAST_FILE = './broadcast.txt';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

let lastLineCount = 0;

// 將 pay_success 訊息對應到實際已廣播的訊息行
let recentResults = []; // [{player, amount, msgId}]

async function broadcastLine(line, channel) {
  // 補款成功
  if (line.startsWith('pay_success|')) {
    const [_, player, amount] = line.split('|');
    // 找到最後一次這名玩家的欠款廣播
    const found = recentResults.reverse().find(r => r.player === player && r.amount == amount);
    if (found && found.msgId) {
      try {
        const refMsg = await channel.messages.fetch(found.msgId);
        await refMsg.reply(`已支付款項`);
      } catch (e) {
        await channel.send(`\`${player}\` 欠款 **${amount}** 綠寶石已支付款項`);
      }
    } else {
      await channel.send(`\`${player}\` 欠款 **${amount}** 綠寶石已支付款項`);
    }
    recentResults.reverse();
    return;
  }
  // 一般下注內容
  // 格式：kailin0726 下注機率1/2 **100,000** 綠寶石，中獎 **200,000**（轉帳失敗）
  const reg = /^(.+?) 下注機率(.+?) \*\*(.+?)\*\* 綠寶石，(中獎(?: \*\*(.+?)\*\*)?|未中獎)(（轉帳失敗）)?$/;
  const m = line.match(reg);
  if (m) {
    // Discord 格式化
    let msg = `\`${m[1]}\` 下注機率${m[2]} **${m[3]}** 綠寶石，${m[4]}`;
    if (m[6]) msg += `（轉帳失敗）`;
    // 廣播
    const sentMsg = await channel.send(msg);
    // 如果是中獎且轉帳失敗，記錄這個訊息
    if (m[4].includes('中獎') && m[6]) {
      recentResults.push({ player: m[1], amount: m[3].replace(/,/g, ''), msgId: sentMsg.id });
      // 只保留最近 50 筆
      if (recentResults.length > 50) recentResults.shift();
    }
    return;
  }
  // 其它格式 fallback 直接廣播
  if (line) await channel.send(line);
}

client.once('ready', async () => {
  console.log(`Discord bot ready as ${client.user.tag}`);
  const channel = await client.channels.fetch(CHANNEL_ID);
  setInterval(async () => {
    if (!fs.existsSync(BROADCAST_FILE)) return;
    const lines = fs.readFileSync(BROADCAST_FILE, 'utf8').split('\n').filter(Boolean);
    if (lines.length > lastLineCount) {
      const newLines = lines.slice(lastLineCount);
      lastLineCount = lines.length;
      for (let line of newLines) {
        await broadcastLine(line, channel);
      }
    }
  }, 1000);
});

// 可加一個簡單的 !help 指令
client.on('messageCreate', async (msg) => {
  if (msg.channel.id !== CHANNEL_ID) return;
  if (msg.author.bot) return;
  if (msg.content === '!help' || msg.content === '!幫助') {
    await msg.reply('這個 bot 會自動同步 Minecraft 賭博結果\n格式例如：\n`kailin0726` 下注機率1/2 **10,000** 綠寶石，未中獎\n`kailin0726` 下注機率1/2 **100,000** 綠寶石，中獎 **200,000**');
  }
});

client.login(TOKEN);