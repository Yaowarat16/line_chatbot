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
  0: "URL1",
  1: "URL2",
  2: "URL3",
  3: "URL4",
  4: "URL5",
};

// =======================
// VIDEO MAP
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

      // =======================
      // TEXT: ประวัติ
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
                `ความมั่นใจ: ${h.confidence.toFixed(1)}%\n` +   // ✅ แก้แล้ว
                `จำนวนใบหน้า: ${h.face_count} คน\n` +
                `🕒 ${h.created_at}\n\n`;
            });
          }

          await replyLine(replyToken, [{ type: "text", text: msg }]);
        }
        continue;
      }

      // =======================
      // IMAGE: Predict
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
              `ความมั่นใจ: ${confidence.toFixed(2)}%\n\n` +  // ✅ แก้แล้ว
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
  console.log("✅ LINE Bot running (Fixed Confidence %)")
);
