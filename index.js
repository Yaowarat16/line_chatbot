import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import FormData from "form-data";

dotenv.config();

const app = express();
app.use(express.json());

// ===== LINE WEBHOOK =====
app.post("/webhook", async (req, res) => {
  // 👉 ตอบ 200 ให้ LINE ก่อน กัน timeout
  res.sendStatus(200);

  try {
    const event = req.body.events?.[0];
    if (!event) return;

    const replyToken = event.replyToken;

    // ===== รับเฉพาะรูป =====
    if (event.message?.type !== "image") {
      await replyLine(
        replyToken,
        "กรุณาส่งรูปใบหน้ามาเพื่อวิเคราะห์ BMI นะงับ 😊"
      );
      return;
    }

    const imageId = event.message.id;

    // 1️⃣ โหลดรูปจาก LINE
    const imageRes = await axios.get(
      `https://api-data.line.me/v2/bot/message/${imageId}/content`,
      {
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        responseType: "arraybuffer",
        timeout: 10000,
      }
    );

    // 2️⃣ เตรียม multipart/form-data ให้ตรงกับ FastAPI
    const form = new FormData();
    form.append("file", imageRes.data, {
      filename: "image.jpg",
      contentType: "image/jpeg",
    });

    // 3️⃣ ส่งไป AI Backend
    const aiRes = await axios.post(
      "https://bmi-ai-backend.onrender.com/predict",
      form,
      {
        headers: {
          ...form.getHeaders(),
        },
        timeout: 20000,
      }
    );

    const { message, confidence } = aiRes.data;

    const confidencePercent =
      typeof confidence === "number"
        ? (confidence * 100).toFixed(1)
        : "ไม่ทราบ";

    // 4️⃣ ตอบกลับ LINE
    await replyLine(
      replyToken,
      `${message}\nความมั่นใจ: ${confidencePercent}%`
    );
  } catch (err) {
    console.error(
      "Webhook processing error:",
      err.response?.data || err.message
    );

    if (req.body?.events?.[0]?.replyToken) {
      await replyLine(
        req.body.events[0].replyToken,
        "ขออภัย ระบบมีปัญหาชั่วคราว 😢"
      );
    }
  }
});

// ===== ฟังก์ชันตอบ LINE =====
async function replyLine(replyToken, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [{ type: "text", text }],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ===== START SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`✅ LINE Bot running on port ${PORT}`)
);
