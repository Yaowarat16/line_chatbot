import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ===== LINE WEBHOOK =====
app.post("/webhook", async (req, res) => {
  try {
    const event = req.body.events[0];
    if (!event) return res.sendStatus(200);

    const replyToken = event.replyToken;

    // กรณีผู้ใช้ส่ง "รูป"
    if (event.message.type === "image") {
      const imageId = event.message.id;

      // 1) โหลดรูปจาก LINE
      const imageResponse = await axios.get(
        `https://api-data.line.me/v2/bot/message/${imageId}/content`,
        {
          headers: {
            Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
          },
          responseType: "arraybuffer"
        }
      );

      // 2) ส่งรูปไปให้โมเดล
      const modelRes = await axios.post(
        "https://MODEL-API.onrender.com/predict",
        imageResponse.data,
        {
          headers: {
            "Content-Type": "application/octet-stream"
          }
        }
      );

      const bmi = modelRes.data.bmi;
      const status = modelRes.data.status;

      // 3) ตอบ LINE
      await replyLine(replyToken, `BMI ของคุณคือ ${bmi}\nสถานะ: ${status}`);
      return res.sendStatus(200);
    }

    // กรณีไม่ใช่รูป
    await replyLine(replyToken, "กรุณาส่งรูปใบหน้ามาเพื่อคำนวณ BMI งับ 😊");
    res.sendStatus(200);

  } catch (err) {
    console.error(err);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("LINE BMI bot running"));
