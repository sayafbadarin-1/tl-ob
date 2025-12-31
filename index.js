require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true
});

console.log("🤖 Context-aware Telegram Bot is running...");

// ====== ذاكرة المحادثات ======
const conversations = {}; // chatId -> messages[]

const MAX_HISTORY = 10;

// ================== استقبال الرسائل ==================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userText = msg.text || msg.caption || "";

  if (!conversations[chatId]) {
    conversations[chatId] = [];
  }

  try {
    // ====== صورة (مع أو بدون نص) ======
    if (msg.photo) {
      await bot.sendMessage(chatId, "📸 وصلت الصورة، جاري التحليل...");

      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const file = await bot.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      const imageRes = await axios.get(fileUrl, {
        responseType: "arraybuffer"
      });

      const imageBase64 = Buffer.from(imageRes.data).toString("base64");

      const answer = await askGemini({
        chatId,
        text: userText,
        imageBase64
      });

      saveToMemory(chatId, "assistant", answer);
      await sendLongMessage(chatId, answer);
      return;
    }

    // ====== نص فقط ======
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

// ================== Gemini ==================
async function askGemini({ chatId, text = "", imageBase64 = null }) {
  const parts = [];

  // ====== النظام (تعليمات عامة) ======
  parts.push({
    text: `
أنت مساعد ذكي في محادثة مستمرة.
تذكّر ما قيل سابقًا في المحادثة.
أجب كنص عادي فقط.
لا تستخدم LaTeX.
لا تستخدم Markdown.
جوابك يجب أن يكون واضحًا ومباشرًا.
`
  });

  // ====== السياق السابق ======
  conversations[chatId].forEach((msg) => {
    parts.push({
      text: `${msg.role === "user" ? "المستخدم" : "المساعد"}: ${msg.text}`
    });
  });

  // ====== السؤال الحالي ======
  parts.push({
    text: `المستخدم الآن: ${text || "اشرح محتوى الصورة"}`
  });

  // ====== الصورة ======
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
    {
      contents: [{ parts }]
    },
    {
      params: {
        key: process.env.GOOGLE_API_KEY
      }
    }
  );

  return res.data.candidates[0].content.parts[0].text;
}

// ================== حفظ السياق ==================
function saveToMemory(chatId, role, text) {
  conversations[chatId].push({ role, text });

  if (conversations[chatId].length > MAX_HISTORY) {
    conversations[chatId].shift(); // حذف الأقدم
  }
}

// ================== تقسيم الرسائل الطويلة ==================
async function sendLongMessage(chatId, text) {
  const MAX_LENGTH = 4000;

  for (let i = 0; i < text.length; i += MAX_LENGTH) {
    const chunk = text.substring(i, i + MAX_LENGTH);
    await bot.sendMessage(chatId, chunk);
  }
}
