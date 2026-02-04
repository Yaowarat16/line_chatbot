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
// BMI TEXT MAP
// =======================
const BMI_BY_CLASS_ID = {
  0: "น้ำหนักน้อยกว่าเกณฑ์ (BMI < 18.5)",
  1: "สมส่วน (BMI 18.5 – 22.9)",
  2: "น้ำหนักเกิน / ท้วม (BMI 23.0 – 24.9)",
  3: "อ้วนระดับ 1 (BMI 25.0 – 29.9)",
  4: "อ้วนระดับ 2 (BMI ≥ 30.0)",
};

// =======================
// BMI IMAGE MAP (⭐ รูปกลับมาแล้ว)
// =======================
const BMI_IMAGE_MAP = {
  0: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class1.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzMS5wbmciLCJpYXQiOjE3NzAyMDYxMzYsImV4cCI6MTgwMTc0MjEzNn0.XwJQzvrjksFRfjTwyxdCO-xBY-dhdI3WWaPr4h3yvKA",
  1: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class2.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzMi5wbmciLCJpYXQiOjE3NzAyMDYxNDMsImV4cCI6MTgwMTc0MjE0M30.ryzjAWitcZJtfyu1J-r2aZ4vcOaRNN8Es4XL5isfyfA",
  2: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class3.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzMy5wbmciLCJpYXQiOjE3NzAyMDYxNDgsImV4cCI6MTgwMTc0MjE0OH0.IeJzRh1ev05-aIukL4SadgRxxdRrqeWpbhEbjVvQ_kw",
  3: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class4.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzNC5wbmciLCJpYXQiOjE3NzAyMDYxNTgsImV4cCI6MTgwMTc0MjE1OH0.AoNGgJUve53SnpR03RM1_WeqfERrpAHlgueUYkBjl6s",
  4: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class5.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzNS5wbmciLCJpYXQiOjE3NzAyMDYxNjMsImV4cCI6MTgwMTc0MjE2M30.nphlpr2DD1SkgIlAtyaxl0nqEo2DBGgcr8XtHXwhftQ",
};

// =======================
// 🏃‍♂️ EXERCISE VIDEO MAP
// =======================
const EXERCISE_VIDEO_BY_CLASS_ID = {
  0: "https://www.youtube.com/watch?v=U0bhE67HuDY",
  1: "https://www.youtube.com/watch?v=UBMk30rjy0o",
  2: "https://www.youtube.com/watch?v=CBWQGb4LyAM",
  3: "https://www.youtube.com/watch?v=Yzm3fA2HhkQ",
  4: "https://www.youtube.com/watch?v=1f8yoFFdkcY",
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
      if (event.message.type === "image") {
        // 1) ดึงรูปจาก LINE
        const { bytes, contentType } = await getLineImageContent(
          event.message.id
        );

        // 2) ส่งไป FastAPI
        const form = new FormData();
        form.append("file", bytes, {
          filename: "image.jpg",
          contentType,
        });

        const aiRes = await axios.post(
          `${AI_API_URL.replace(/\/+$/, "")}/predict`,
          form,
          { headers: form.getHeaders() }
        );

        const { class_id, confidence, has_face, low_confidence } = aiRes.data;

        if (!has_face) {
          await replyLine(replyToken, [
            { type: "text", text: "❌ ไม่พบใบหน้าในภาพ กรุณาถ่ายใหม่" },
          ]);
          continue;
        }

        if (low_confidence) {
          await replyLine(replyToken, [
            { type: "text", text: "⚠️ ภาพไม่ชัด กรุณาถ่ายใหม่ให้หน้าตรงและชัดเจน" },
          ]);
          continue;
        }

        const replyText =
          `✅ ผลการประเมินโดย AI\n` +
          `━━━━━━━━━━━━━━\n` +
          `สถานะ BMI: ${BMI_BY_CLASS_ID[class_id]}\n` +
          `ความมั่นใจ: ${(confidence * 100).toFixed(2)}%\n\n` +
          `🏃‍♂️ คลิปออกกำลังกายที่เหมาะกับคุณ\n` +
          `${EXERCISE_VIDEO_BY_CLASS_ID[class_id]}\n\n` +
          `🕒 เวลาที่บอทตอบ: ${nowThai()}`;

        // ⭐ ตรงนี้คือจุดที่ “รูปกลับมา”
        await replyLine(replyToken, [
          { type: "text", text: replyText },
          {
            type: "image",
            originalContentUrl: BMI_IMAGE_MAP[class_id],
            previewImageUrl: BMI_IMAGE_MAP[class_id],
          },
        ]);
      }
    } catch (err) {
      console.error(err);
      await replyLine(replyToken, [
        { type: "text", text: "❌ ระบบไม่สามารถประมวลผลได้ กรุณาลองใหม่" },
      ]);
    }
  }
});

app.listen(10000, () =>
  console.log("✅ LINE Bot running (Text + Image + Video)")
);
