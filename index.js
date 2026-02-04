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
// IMAGE MAP
// =======================
const BMI_IMAGE_MAP = {
  0: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class1.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzMS5wbmciLCJpYXQiOjE3NzAyMDY2NTgsImV4cCI6MTgwMTc0MjY1OH0.mg1sZa8-PDSM73sNmPfmaYgs9xeccozjafawLA9sMVI",
  1: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class2.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzMi5wbmciLCJpYXQiOjE3NzAyMDY2NzAsImV4cCI6MTgwMTc0MjY3MH0.lpJQdMegEhxkwhLdqS9Zv8FdG-8gnCFHu0bgagL77Ek",
  2: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class3.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzMy5wbmciLCJpYXQiOjE3NzAyMDY2NzYsImV4cCI6MTgwMTc0MjY3Nn0.4Z9NgubdLjo4L5n7K7bi8ZgFmSqIJYvfo-v4QP_lFus",
  3: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class4.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzNC5wbmciLCJpYXQiOjE3NzAyMDY2ODIsImV4cCI6MTgwMTc0MjY4Mn0.hULVkrISskrkBfWnCu9bQTMEWIf7Zt6h0sbmtrUCV4g",
  4: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class5.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzNS5wbmciLCJpYXQiOjE3NzAyMDY2ODcsImV4cCI6MTgwMTc0MjY4N30.W0dVfqjgmaj6iVygksdLX8yFmOdLyL1N9UP3qjefek8",
};

// =======================
// EXERCISE VIDEO MAP
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

    // ⭐ DEBUG สำคัญมาก
    console.log("EVENT:", JSON.stringify(event, null, 2));

    const replyToken = event.replyToken;
    if (!replyToken || event.type !== "message") continue;

    try {
      // =======================
      // 🟢 TEXT: "ประวัติ"
      // =======================
      if (event.message.type === "text") {
        const text = event.message.text.trim();

        if (text === "ประวัติ") {
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
                `${i + 1}) ${BMI_BY_CLASS_ID[h.class_id]}\n` +
                `ความมั่นใจ: ${(h.confidence * 100).toFixed(1)}%\n` +
                `จำนวนใบหน้า: ${h.face_count} คน\n` +
                `🕒 ${h.created_at}\n\n`;
            });
          }

          await replyLine(replyToken, [{ type: "text", text: msg }]);
        }
        continue;
      }

      // =======================
      // 🟡 IMAGE: predict
      // =======================
      if (event.message.type === "image") {
        const { bytes, contentType } = await getLineImageContent(event.message.id);

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

        const { class_id, confidence } = aiRes.data;

        await replyLine(replyToken, [
          {
            type: "text",
            text:
              `✅ ผลการประเมินโดย AI\n` +
              `สถานะ BMI: ${BMI_BY_CLASS_ID[class_id]}\n` +
              `ความมั่นใจ: ${(confidence * 100).toFixed(2)}%\n\n` +
              `🏃‍♂️ คลิปแนะนำ:\n${EXERCISE_VIDEO_BY_CLASS_ID[class_id]}\n\n` +
              `🕒 ${nowThai()}`,
          },
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
  console.log("✅ LINE Bot running (Text + Image + History + Video)")
);
