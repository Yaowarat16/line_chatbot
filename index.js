import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));

// ===== LINE WEBHOOK =====
app.post("/webhook", async (req, res) => {
  try {
    const event = req.body.events?.[0];
    if (!event) return res.sendStatus(200);

    const replyToken = event.replyToken;

    // 👉 ถ้าเป็นรูป → ส่งให้ AI
    if (event.message?.type === "image") {
      const imageId = event.message.id;

      // 1️⃣ โหลดรูปจาก LINE
      const imageRes = await axios.get(
        `https://api-data.line.me/v2/bot/message/${imageId}/content`,
        {
          headers: {
            Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
          },
          responseType: "arraybuffer"
        }
      );

      // 2️⃣ ส่งรูปไป backend AI
      const aiUrl = process.env.AI_BACKEND_URL.endsWith("/predict")
        ? process.env.AI_BACKEND_URL
        : process.env.AI_BACKEND_URL + "/predict";

      const aiRes = await axios.post(
        aiUrl,
        imageRes.data,
        {
          headers: {
            "Content-Type": "application/octet-stream"
          },
          timeout: 15000
        }
      );

      const { message, confidence } = aiRes.data;
      const confidencePercent = confidence
        ? (confidence * 100).toFixed(1)
        : "ไม่ทราบ";

      // 3️⃣ ตอบกลับ LINE
      await replyLine(
        replyToken,
        `${message}\nความมั่นใจ: ${confidencePercent}%`
      );

      return res.sendStatus(200);
    }

    // 👉 กรณีอื่น
    await replyLine(
      replyToken,
      "กรุณาส่งรูปใบหน้ามาเพื่อวิเคราะห์ BMI นะงับ 😊"
    );

    res.sendStatus(200);
  } catch (err) {
    console.error(
      "Webhook error:",
      err.response?.status,
      err.response?.data || err.message
    );

    if (req.body?.events?.[0]?.replyToken) {
      await replyLine(
        req.body.events[0].replyToken,
        "ขออภัย ระบบมีปัญหาชั่วคราว 😢"
      );
    }

    res.sendStatus(500);
  }
});

// ===== ฟังก์ชันตอบ LINE =====
async function replyLine(replyToken, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [{ type: "text", text }]
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// ===== START SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`✅ LINE Bot running on port ${PORT}`)
);
