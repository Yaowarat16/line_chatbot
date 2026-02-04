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
const LINE_REPLY_API = "https://api.line.me/v2/bot/message/reply";
const LINE_CONTENT_API = "https://api-data.line.me/v2/bot/message";
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const AI_API_URL = process.env.AI_API_URL;

// =======================
// BMI MAP (⭐ แปลจาก class_id เท่านั้น)
// =======================
const BMI_BY_CLASS_ID = {
  0: "น้ำหนักน้อยกว่าเกณฑ์ (BMI < 18.5)",
  1: "สมส่วน (BMI 18.5 – 22.9)",
  2: "น้ำหนักเกิน / ท้วม (BMI 23.0 – 24.9)",
  3: "อ้วนระดับ 1 (BMI 25.0 – 29.9)",
  4: "อ้วนระดับ 2 (BMI ≥ 30.0)",
};

// =======================
// Helper
// =======================
async function replyLine(replyToken, messages) {
  await axios.post(
    LINE_REPLY_API,
    { replyToken, messages },
    { headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` } }
  );
}

// =======================
// WEBHOOK
// =======================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const events = req.body.events || [];

  for (const event of events) {
    const replyToken = event.replyToken;
    if (!replyToken) continue;

    // =======================
    // TEXT: history
    // =======================
    if (event.message.type === "text") {
      if (event.message.text === "ประวัติ") {
        const historyRes = await axios.get(`${AI_API_URL}/history?limit=5`);
        const history = historyRes.data.history || [];

        let msg = "📊 ประวัติการประเมิน BMI\n\n";

        history.forEach((h, i) => {
          msg +=
            `${i + 1}) ✅ ผลการประเมิน\n` +
            `- สถานะ BMI: ${BMI_BY_CLASS_ID[h.class_id]}\n` +
            `- ความมั่นใจ: ${(h.confidence * 100).toFixed(1)}%\n` +
            `- ตรวจพบใบหน้า: ${h.has_face ? "พบ" : "ไม่พบ"}\n` +
            `- จำนวนใบหน้า: ${h.face_count} คน\n` +
            `- เวลาบันทึก: ${h.created_at}\n\n`;
        });

        await replyLine(replyToken, [{ type: "text", text: msg }]);
      }
      continue;
    }

    // =======================
    // IMAGE: predict
    // =======================
    if (event.message.type === "image") {
      const aiRes = await axios.post(
        `${AI_API_URL}/predict`,
        {}, // (ตัดรายละเอียด download image ออกเพื่อความกระชับ)
      );

      const { class_id, confidence } = aiRes.data;

      await replyLine(replyToken, [{
        type: "text",
        text:
          `✅ AI วิเคราะห์สำเร็จ\n` +
          `สถานะ BMI: ${BMI_BY_CLASS_ID[class_id]}\n` +
          `ความมั่นใจ: ${(confidence * 100).toFixed(2)}%`
      }]);
    }
  }
});

app.listen(10000, () => console.log("LINE Bot running"));
