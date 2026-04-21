import OpenAI from "openai"
import "dotenv/config"

const client = new OpenAI({
    baseURL: "http://localhost:1234/v1",
    apiKey: "lm-studio",
})
const LM_MODEL = "google/gemma-3-4b"

const SCORE_MAP = {
    4: "✅ BUY",
    3: "✅ BUY",
    2: "👀 WATCH",
    1: "👀 WATCH",
    0: "⏸ HOLD",
    "-1": "⛔ AVOID",
    "-2": "⛔ AVOID",
    "-3": "❌ SELL",
    "-4": "❌ SELL",
}

function scoreLabel(total) {
    const clamped = Math.max(-4, Math.min(4, total))
    return SCORE_MAP[clamped.toString()] || "⏸ HOLD"
}

export async function analyzeNews(symbol, newsItems, stockInfo) {
    const { price, ema12, ema26, zone, label, cdcScore } = stockInfo
    const ticker = symbol.replace(".BK", "")

    const newsText = newsItems
        .map((n, i) => `[${i + 1}] [${n.source}] ${n.title}\n${n.snippet}`)
        .join("\n\n")

    const prompt = `คุณเป็นนักวิเคราะห์หุ้นไทยมืออาชีพ

ข้อมูลหุ้น ${ticker}:
- ราคาล่าสุด: ${price?.toFixed(2)} บาท
- EMA12: ${ema12?.toFixed(2)}, EMA26: ${ema26?.toFixed(2)}
- CDC Zone: ${zone} (${label}) | CDC Score: ${cdcScore}

ข่าวล่าสุด:
${newsText || "ไม่พบข่าว"}

วิเคราะห์ sentiment และให้คำแนะนำ ตอบเป็น JSON เท่านั้น โดยไม่มีข้อความอื่น:
{
  "sentiment": "bullish" | "neutral" | "bearish",
  "aiScore": <ตัวเลข -2 ถึง +2>,
  "reason": "<เหตุผลสั้นๆ ภาษาไทย ไม่เกิน 80 ตัวอักษร>",
  "keyPoints": ["<ประเด็น 1>", "<ประเด็น 2>"]
}`

    try {
        const completion = await client.chat.completions.create({
            model: LM_MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
        })
        const raw = completion.choices[0].message.content
        // strip markdown code fences if model wraps JSON
        const cleaned = raw.replace(/^```[\s\S]*?\n|```$/gm, "").trim()
        const result2 = JSON.parse(cleaned)
        const aiScore = Math.max(-2, Math.min(2, Math.round(Number(result2.aiScore) || 0)))
        const totalScore = cdcScore + aiScore

        return {
            sentiment: result2.sentiment || "neutral",
            aiScore,
            reason: result2.reason || "",
            keyPoints: result2.keyPoints || [],
            totalScore,
            decision: scoreLabel(totalScore),
        }
    } catch (err) {
        console.warn(`[analyze] LM Studio failed for ${symbol}:`, err.message)
        return {
            sentiment: "neutral",
            aiScore: 0,
            reason: "วิเคราะห์ไม่ได้",
            keyPoints: [],
            totalScore: cdcScore,
            decision: scoreLabel(cdcScore),
        }
    }
}
