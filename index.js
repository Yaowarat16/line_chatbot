import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import FormData from "form-data";

dotenv.config();

const app = express();
app.use(express.json());

// =======================
// CONFIG
// =======================
const AI_API_URL = "https://bmi-ai-backend-ngbp.onrender.com";
const LINE_REPLY_API = "https://api.line.me/v2/bot/message/reply";

// =======================
// LINE WEBHOOK
// =======================
app.post("/webhook", async (req, res) => {
  // ตอบ LINE ก่อน ป้องกัน timeout
  res.sendStatus(200);

  const event = req.body?.events?.[0];
  if (!event) return;

  const replyToken = event.replyToken;

  try {
    // ===== รับเฉพาะรูป =====
    if (event.message?.type !== "image") {
      await replyLine(
        replyToken,
        "📸 กรุณาส่งรูปใบหน้ามาเพื่อประเมินค่า BMI นะคะ 😊"
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
        timeout: 15000,
      }
    );

    // 2️⃣ เตรียม multipart/form-data
    const form = new FormData();
    form.append("file", imageRes.data, {
      filename: "image.jpg",
      contentType: "image/jpeg",
    });

    // 3️⃣ ส่งไป AI Backend
    const aiRes = await axios.post(
      `${AI_API_URL}/predict`,
      form,
      {
        headers: {
          ...form.getHeaders(),
        },
        timeout: 30000,
        validateStatus: () => true, // ❗ ไม่ throw auto
      }
    );

    // ===== เช็กสถานะ =====
    if (aiRes.status !== 200) {
      console.error("AI ERROR:", aiRes.status, aiRes.data);
      await replyLine(
        replyToken,
        "❌ ระบบวิเคราะห์มีปัญหา กรุณาลองใหม่อีกครั้งนะคะ"
      );
      return;
    }

    /**
     * EXPECTED RESPONSE (Regression)
     * {
     *   bmi: 23.6,
     *   message: "BMI โดยประมาณ: 23.6"
     * }
     */
    const { bmi, message } = aiRes.data;

    // ===== กรณี backend แจ้งข้อความพิเศษ =====
    if (typeof bmi !== "number") {
      await replyLine(
        replyToken,
        message || "ไม่สามารถประเมิน BMI จากภาพนี้ได้ 😢"
      );
      return;
    }

    // ===== ตีความ BMI =====
    let status = "";
    if (bmi < 18.5) status = "น้ำหนักต่ำกว่าเกณฑ์";
    else if (bmi < 23) status = "น้ำหนักปกติ";
    else if (bmi < 25) status = "น้ำหนักเกิน";
    else status = "อ้วน";

    const replyText = `
🧮 ผลการประเมิน BMI
━━━━━━━━━━━━━━
ค่า BMI โดยประมาณ: ${bmi.toFixed(1)}
สถานะ: ${status}

ℹ️ เป็นการประเมินจากภาพใบหน้า
ไม่สามารถใช้แทนการวัดจริงได้
`.trim();

    // 4️⃣ ตอบกลับ LINE
    await replyLine(replyToken, replyText);

  } catch (err) {
    console.error("Webhook error:", err.response?.data || err.message);

    if (replyToken) {
      await replyLine(
        replyToken,
        "ขออภัย ระบบมีปัญหาชั่วคราว 😢"
      );
    }
  }
});

// =======================
// Reply LINE
// =======================
async function replyLine(replyToken, text) {
  await axios.post(
    LINE_REPLY_API,
    {
      replyToken,
      messages: [{ type: "text", text }],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    }
  );
}

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ LINE Bot running on port ${PORT}`);
});
