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

if (!LINE_CHANNEL_ACCESS_TOKEN) {
  throw new Error("LINE_CHANNEL_ACCESS_TOKEN not set");
}
if (!AI_API_URL) {
  throw new Error("AI_API_URL not set");
}

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
// IMAGE MAP (ต้องเป็น https public จริง)
// =======================
const BMI_IMAGE_MAP = {
  0: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class1.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzMS5wbmciLCJpYXQiOjE3NzA4MTQwMTMsImV4cCI6MTgwMjM1MDAxM30.P1-o9drsgJr3KgQe9klFkdHvWbw1IWrKSPyd9gMvFRA",
  1: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class2.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzMi5wbmciLCJpYXQiOjE3NzA4MTQwMjUsImV4cCI6MTgwMjM1MDAyNX0.oj28iDEc0qvfUt5tMIMkaj-ylTAi30Qm1oHHTutVyX0",
  2: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class3.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzMy5wbmciLCJpYXQiOjE3NzA4MTQwMzcsImV4cCI6MTgwMjM1MDAzN30.IbATsCh50q1vj4MjyqiNdtu9lBFWD6RBZk-Lw2OpSBs",
  3: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class4.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzNC5wbmciLCJpYXQiOjE3NzA4MTQwNDMsImV4cCI6MTgwMjM1MDA0M30.seYFUtupddcnIB9IUN5LF4JyqhXKFFi620JmJq685FA",
  4: "https://tsfcpojgprlspohbxtwu.supabase.co/storage/v1/object/sign/Picture/class5.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8xZjk0OWQ0Mi02MDllLTRhZjgtYmJjMS1kYjcxYmIyN2ZiMzIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJQaWN0dXJlL2NsYXNzNS5wbmciLCJpYXQiOjE3NzA4MTQwNTYsImV4cCI6MTgwMjM1MDA1Nn0.SkqpI19Ci70O5y2XiXV645xHx20mv9P6hFTLBw1LrmE",
};

// =======================
// YOUTUBE MAP
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
    headers: {
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
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

      // =======================
      // IMAGE: Predict
      // =======================
      if (event.message.type === "image") {

        const { bytes, contentType } =
          await getLineImageContent(event.message.id);

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

        const class_id = aiRes.data.class_id ?? -1;
        const confidence = Number(aiRes.data.confidence ?? 0);

        const textReply =
          `✅ ผลการประเมินโดย AI\n` +
          `สถานะ BMI: ${BMI_BY_CLASS_ID[class_id] || "ไม่สามารถระบุได้"}\n` +
          `ความมั่นใจ: ${confidence.toFixed(2)}%\n\n` +
          `🏃‍♂️ คลิปแนะนำ:\n${EXERCISE_VIDEO_BY_CLASS_ID[class_id]}\n\n` +
          `🕒 ${nowThai()}`;

        const messages = [
          { type: "text", text: textReply }
        ];

        // 🔥 ใส่รูปเพิ่ม ถ้ามี URL จริง
        if (BMI_IMAGE_MAP[class_id]?.startsWith("https")) {
          messages.push({
            type: "image",
            originalContentUrl: BMI_IMAGE_MAP[class_id],
            previewImageUrl: BMI_IMAGE_MAP[class_id],
          });
        }

        await replyLine(replyToken, messages);
      }

    } catch (err) {
      console.error("ERROR:", err?.response?.data || err.message);

      await replyLine(replyToken, [
        { type: "text", text: "❌ ระบบไม่สามารถประมวลผลได้ กรุณาลองใหม่" },
      ]);
    }
  }
});

app.listen(process.env.PORT || 10000, () =>
  console.log("✅ LINE Bot running")
);
