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

if (!LINE_CHANNEL_ACCESS_TOKEN) throw new Error("LINE_CHANNEL_ACCESS_TOKEN not set");
if (!AI_API_URL) throw new Error("AI_API_URL not set");

// =======================
// BMI TEXT MAP (ใช้ class_id เท่านั้น)
// =======================
const BMI_BY_CLASS_ID = {
  0: "น้ำหนักน้อยกว่าเกณฑ์ (BMI < 18.5)",
  1: "สมส่วน (BMI 18.5 – 22.9)",
  2: "น้ำหนักเกิน / ท้วม (BMI 23.0 – 24.9)",
  3: "อ้วนระดับ 1 (BMI 25.0 – 29.9)",
  4: "อ้วนระดับ 2 (BMI ≥ 30.0)",
};

// =======================
// BMI IMAGE MAP
// =======================
const BMI_IMAGE_MAP = {
  0: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class1.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzMS5wbmciLCJpYXQiOjE3NzAyMDU0NjQsImV4cCI6MTgwMTc0MTQ2NH0.td_FMeTEjfeQrG0bmpXo3n9k2Xvkm5acQnLhKzkKBos",
  1: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class2.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzMi5wbmciLCJpYXQiOjE3NzAyMDU0ODAsImV4cCI6MTgwMTc0MTQ4MH0.LgwKS_7eTjIbS-EGhXhvrjbDmCjMsAtTuORPj77Uo74",
  2: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class3.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzMy5wbmciLCJpYXQiOjE3NzAyMDU0OTEsImV4cCI6MTgwMTc0MTQ5MX0.F99_ra062JCYqeVtDrCfmqbtwkaBSIbvgLd3asjb1Qs",
  3: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class4.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzNC5wbmciLCJpYXQiOjE3NzAyMDU1MDEsImV4cCI6MTgwMTc0MTUwMX0.MWY8tNIlDAfFcpR-rapXiJEpPA4GJscbRPnOlvwPNvs",
  4: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class5.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzNS5wbmciLCJpYXQiOjE3NzAyMDU1MTIsImV4cCI6MTgwMTc0MTUxMn0.hYIMJiSQp-fWNV3o7AG4No78eYcI0S8-XdkBS8zood8",
};

// =======================
// HELPERS
// =======================
async function replyLine(replyToken, messages) {
  await axios.post(
    LINE_REPLY_API,
    { replyToken, messages },
    {
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

async function getLineImageContent(messageId) {
  const url = `${LINE_CONTENT_API}/${messageId}/content`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    responseType: "arraybuffer",
  });

  return {
    bytes: res.data,
    contentType: res.headers["content-type"] || "image/jpeg",
  };
}

// เวลาไทย
function nowThai() {
  return new Date().toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
  });
}

// =======================
// WEBHOOK
// =======================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const events = req.body.events || [];

  for (const event of events) {
    const replyToken = event.replyToken;
    if (!replyToken || event.type !== "message") continue;

    try {
      // =======================
      // TEXT: "ประวัติ"
      // =======================
      if (event.message.type === "text") {
        if (event.message.text.trim() === "ประวัติ") {
          const historyRes = await axios.get(
            `${AI_API_URL.replace(/\/+$/, "")}/history?limit=5`
          );

          const history = historyRes.data.history || [];
          let msg = "📊 ประวัติการประเมิน BMI (ล่าสุด)\n\n";

          if (history.length === 0) {
            msg += "ยังไม่มีประวัติการใช้งาน";
          } else {
            history.forEach((h, i) => {
              msg +=
                `${i + 1}) ✅ ผลการประเมิน\n` +
                `- สถานะ BMI: ${BMI_BY_CLASS_ID[h.class_id]}\n` +
                `- ความมั่นใจ: ${(h.confidence * 100).toFixed(1)}%\n` +
                `- ตรวจพบใบหน้า: ${h.has_face ? "พบ" : "ไม่พบ"}\n` +
                `- จำนวนใบหน้า: ${h.face_count} คน\n` +
                `- เวลาที่บันทึก: ${h.created_at}\n\n`;
            });
          }

          await replyLine(replyToken, [{ type: "text", text: msg }]);
        }
        continue;
      }

      // =======================
      // IMAGE: Predict BMI
      // =======================
      if (event.message.type === "image") {
        // 1) ดึงรูปจาก LINE
        const { bytes, contentType } = await getLineImageContent(
          event.message.id
        );

        // 2) ส่งไป FastAPI
        const form = new FormData();
        form.append("file", bytes, {
          filename: contentType.includes("png") ? "image.png" : "image.jpg",
          contentType,
        });

        const aiRes = await axios.post(
          `${AI_API_URL.replace(/\/+$/, "")}/predict`,
          form,
          { headers: form.getHeaders() }
        );

        const {
          class_id,
          confidence,
          has_face,
          face_count,
          low_confidence,
        } = aiRes.data;

        // 3) ตรวจผลลัพธ์
        if (!has_face) {
          await replyLine(replyToken, [
            { type: "text", text: "❌ ไม่พบใบหน้าในภาพ กรุณาถ่ายใหม่" },
          ]);
          continue;
        }

        if (low_confidence) {
          await replyLine(replyToken, [
            { type: "text", text: "⚠️ ความมั่นใจต่ำ กรุณาถ่ายใหม่ให้หน้าชัด" },
          ]);
          continue;
        }

        // 4) ข้อความผลลัพธ์
        const resultText =
          `✅ ผลการประเมินโดย AI\n` +
          `━━━━━━━━━━━━━━\n` +
          `สถานะ BMI: ${BMI_BY_CLASS_ID[class_id]}\n` +
          `ความมั่นใจ: ${(confidence * 100).toFixed(2)}%\n` +
          `จำนวนใบหน้า: ${face_count} คน\n` +
          `🕒 เวลาที่บอทตอบ: ${nowThai()}`;

        // 5) ส่งข้อความ + รูป
        await replyLine(replyToken, [
          { type: "text", text: resultText },
          {
            type: "image",
            originalContentUrl: BMI_IMAGE_MAP[class_id],
            previewImageUrl: BMI_IMAGE_MAP[class_id],
          },
        ]);
      }
    } catch (err) {
      console.error(err?.response?.data || err);
      await replyLine(replyToken, [
        { type: "text", text: "❌ ระบบไม่สามารถประมวลผลได้ กรุณาลองใหม่" },
      ]);
    }
  }
});

// =======================
app.listen(10000, () => console.log("✅ LINE Bot running"));
