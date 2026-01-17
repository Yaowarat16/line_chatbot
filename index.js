import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import FormData from "form-data";

dotenv.config();

const app = express();
app.use(express.json());

/* ===============================
   BMI RESPONSE MAPPING
================================ */
const BMI_RESPONSES = {
  Class1: `📊 ผลการประเมินดัชนีมวลกาย (BMI)
ค่า BMI ของคุณอยู่ในช่วง 18.5 – 22.9
จัดอยู่ในเกณฑ์ น้ำหนักปกติ
✅ ร่างกายมีความสมดุล เหมาะสมต่อสุขภาพ
แนะนำให้รักษาพฤติกรรมการกินและการออกกำลังกายอย่างสม่ำเสมอ เพื่อคงสุขภาพที่ดีต่อไป`,

  Class2: `📊 ผลการประเมินดัชนีมวลกาย (BMI)
ค่า BMI ของคุณอยู่ในช่วง 23.0 – 24.9
จัดอยู่ในเกณฑ์ น้ำหนักเกิน (เริ่มมีความเสี่ยง)
⚠️ อาจเริ่มมีความเสี่ยงต่อปัญหาสุขภาพในอนาคต
แนะนำให้ควบคุมอาหาร และเพิ่มกิจกรรมทางกาย เช่น การออกกำลังกาย เพื่อป้องกันภาวะโรคอ้วน`,

  Class3: `📊 ผลการประเมินดัชนีมวลกาย (BMI)
ค่า BMI ของคุณอยู่ในช่วง 25.0 – 29.9
จัดอยู่ในเกณฑ์ อ้วนระดับที่ 1
🚨 มีความเสี่ยงต่อโรคไม่ติดต่อเรื้อรัง เช่น เบาหวาน ความดันโลหิตสูง
ควรปรับพฤติกรรมการรับประทานอาหาร และออกกำลังกายอย่างเหมาะสม หากเป็นไปได้ควรปรึกษาผู้เชี่ยวชาญด้านสุขภาพ`
};

/* ===============================
   LINE WEBHOOK
================================ */
app.post("/webhook", async (req, res) => {
  // ✅ ตอบ LINE ทันที
  res.sendStatus(200);

  const event = req.body.events?.[0];
  if (!event) return;

  if (event.type !== "message" || event.message.type !== "image") {
    return;
  }

  const replyToken = event.replyToken;
  const imageId = event.message.id;

  try {
    /* 1️⃣ โหลดรูปจาก LINE */
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

    /* 2️⃣ เตรียม form-data */
    const form = new FormData();
    form.append("file", imageRes.data, {
      filename: "image.jpg",
      contentType: "image/jpeg",
    });

    /* 3️⃣ ส่งไป AI Backend */
    const aiRes = await axios.post(
      "https://bmi-ai-backend.onrender.com/predict",
      form,
      {
        headers: form.getHeaders(),
        timeout: 20000,
      }
    );

    // 🔍 DEBUG สำคัญมาก
    console.log("AI RESPONSE RAW:", aiRes.data);

    /* 4️⃣ ดึงค่า class แบบปลอดภัย */
    const predictedClassRaw =
      aiRes.data.predicted_class ||
      aiRes.data.class ||
      aiRes.data.label ||
      null;

    const confidence = aiRes.data.confidence;

    /* 5️⃣ normalize class → Class1 | Class2 | Class3 */
    let predictedClass = null;

    if (typeof predictedClassRaw === "string") {
      const c = predictedClassRaw.toLowerCase();
      if (c.includes("1")) predictedClass = "Class1";
      else if (c.includes("2")) predictedClass = "Class2";
      else if (c.includes("3")) predictedClass = "Class3";
    }

    const bmiMessage =
      BMI_RESPONSES[predictedClass] ||
      "ไม่สามารถระบุผลการประเมิน BMI ได้";

    const confidencePercent =
      typeof confidence === "number"
        ? (confidence * 100).toFixed(1)
        : "ไม่ทราบ";

    /* 6️⃣ Reply LINE */
    await replyLine(
      replyToken,
      `${bmiMessage}\n\n🔍 ความมั่นใจของโมเดล: ${confidencePercent}%`
    );
  } catch (err) {
    console.error(
      "Webhook processing error:",
      err.response?.data || err.message
    );

    await replyLine(
      replyToken,
      "❌ ไม่สามารถประมวลผลภาพได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง"
    );
  }
});

/* ===============================
   LINE REPLY FUNCTION
================================ */
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

/* ===============================
   START SERVER
================================ */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`✅ LINE Bot running on port ${PORT}`)
);
