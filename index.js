require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const http = require("http");

/* ========= HTTP SERVER (UptimeRobot) ========= */
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
}).listen(PORT, () => {
  console.log(`🌐 Health check server running on port ${PORT}`);
});

/* ========= TELEGRAM BOT ========= */
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true
});

console.log("🤖 Telegram AI Bot is running...");

/* ========= MEMORY (CONTEXT) ========= */
const conversations = {}; // chatId -> [{role,text}]
const MAX_HISTORY = 10;

/* ========= MESSAGE HANDLER ========= */
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userText = msg.text || msg.caption || "";

  if (!conversations[chatId]) conversations[chatId] = [];

  try {
    /* ----- IMAGE (with or without text) ----- */
    if (msg.photo) {
      await bot.sendMessage(chatId, "📸 وصلت الصورة، جاري التحليل...");

      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const file = await bot.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      const imageRes = await axios.get(fileUrl, { responseType: "arraybuffer" });
      const imageBase64 = Buffer.from(imageRes.data).toString("base64");

      saveToMemory(chatId, "user", userText || "[صورة]");

      const answer = await askGemini({
        chatId,
        text: userText,
        imageBase64
      });

      saveToMemory(chatId, "assistant", answer);
      await sendLongMessage(chatId, answer);
      return;
    }

    /* ----- TEXT ONLY ----- */
    if (msg.text) {
      saveToMemory(chatId, "user", msg.text);

      const answer = await askGemini({
        chatId,
        text: msg.text
      });

      saveToMemory(chatId, "assistant", answer);
      await sendLongMessage(chatId, answer);
      return;
    }

    await bot.sendMessage(chatId, "❓ ابعث نص أو صورة");

  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
    await bot.sendMessage(chatId, "❌ صار خطأ أثناء المعالجة");
  }
});

/* ========= GEMINI ========= */
async function askGemini({ chatId, text = "", imageBase64 = null }) {
  const parts = [];

  // تعليمات ثابتة
  parts.push({
    text: `
أنت مساعد ذكي في محادثة مستمرة.
تذكر ما قيل سابقًا.
أجب كنص عادي فقط.
لا تستخدم LaTeX.
لا تستخدم Markdown.
لا تستخدم رموز مثل $ أو ---.
اكتب جواب واضح ومباشر مناسب لتلغرام.
`
  });

  // السياق السابق
  conversations[chatId].forEach((m) => {
    parts.push({
      text: `${m.role === "user" ? "المستخدم" : "المساعد"}: ${m.text}`
    });
  });

  // السؤال الحالي
  parts.push({
    text: `المستخدم الآن: ${text || "اشرح محتوى الصورة"}`
  });

  // الصورة إن وُجدت
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

/* ========= MEMORY ========= */
function saveToMemory(chatId, role, text) {
  conversations[chatId].push({ role, text });
  if (conversations[chatId].length > MAX_HISTORY) {
    conversations[chatId].shift();
  }
}

/* ========= LONG MESSAGE SPLIT ========= */
async function sendLongMessage(chatId, text) {
  const MAX = 4000;
  for (let i = 0; i < text.length; i += MAX) {
    await bot.sendMessage(chatId, text.substring(i, i + MAX));
  }
}
