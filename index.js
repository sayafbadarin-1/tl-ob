require("dotenv").config();
const http = require("http");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

/* ================= HTTP SERVER (Render + UptimeRobot) ================= */
const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain");
  res.end("OK");
}).listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Server listening on port ${PORT}`);
});

/* ================= TELEGRAM BOT ================= */
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true
});

console.log("🤖 Telegram AI Bot is running...");

/* ================= MEMORY ================= */
const conversations = {};
const MAX_HISTORY = 10;

/* ================= HANDLER ================= */
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userText = msg.text || msg.caption || "";

  if (!conversations[chatId]) conversations[chatId] = [];

  try {
    // ----- IMAGE -----
    if (msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const file = await bot.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      const img = await axios.get(fileUrl, { responseType: "arraybuffer" });
      const imageBase64 = Buffer.from(img.data).toString("base64");

      save(chatId, "user", userText || "[image]");

      const answer = await askGemini(chatId, userText, imageBase64);
      save(chatId, "assistant", answer);

      await sendLong(chatId, answer);
      return;
    }

    // ----- TEXT -----
    if (msg.text) {
      save(chatId, "user", msg.text);

      const answer = await askGemini(chatId, msg.text, null);
      save(chatId, "assistant", answer);

      await sendLong(chatId, answer);
      return;
    }

  } catch (e) {
    await bot.sendMessage(chatId, "❌ خطأ");
  }
});

/* ================= GEMINI ================= */
async function askGemini(chatId, text, imageBase64) {
  const parts = [];

  parts.push({
    text: `
أجب كنص عادي فقط.
لا Markdown.
لا LaTeX.
تذكّر سياق المحادثة.
`
  });

  conversations[chatId].forEach(m => {
    parts.push({
      text: `${m.role === "user" ? "المستخدم" : "المساعد"}: ${m.text}`
    });
  });

  parts.push({ text: `المستخدم الآن: ${text || "اشرح الصورة"}` });

  if (imageBase64) {
    parts.push({
      inline_data: {
        mime_type: "image/jpeg",
        data: imageBase64
      }
    });
  }

  const res = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    { contents: [{ parts }] },
    { params: { key: process.env.GOOGLE_API_KEY } }
  );

  return res.data.candidates[0].content.parts[0].text;
}

/* ================= HELPERS ================= */
function save(chatId, role, text) {
  conversations[chatId].push({ role, text });
  if (conversations[chatId].length > MAX_HISTORY) conversations[chatId].shift();
}

async function sendLong(chatId, text) {
  for (let i = 0; i < text.length; i += 4000) {
    await bot.sendMessage(chatId, text.substring(i, i + 4000));
  }
}
