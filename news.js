import fetch from "node-fetch"
import "dotenv/config"
import { GoogleGenerativeAI } from "@google/generative-ai"

const SERPAPI_KEY = process.env.SERPAPI_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY

function stripHtml(html) {
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
}

function isWithinOneWeek(dateStr) {
    if (!dateStr) return true
    const oneWeek = 7 * 24 * 60 * 60 * 1000
    const now = Date.now()

    // Handle relative dates e.g. "3 hours ago", "2 days ago"
    const relMatch = dateStr.match(/(\d+)\s+(minute|hour|day|week|month)s?\s+ago/i)
    if (relMatch) {
        const amount = parseInt(relMatch[1])
        const unit = relMatch[2].toLowerCase()
        const msMap = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 }
        return amount * (msMap[unit] ?? 0) <= oneWeek
    }

    const parsed = new Date(dateStr)
    if (isNaN(parsed.getTime())) return true
    return now - parsed.getTime() <= oneWeek
}

async function fetchThunhoon(symbol) {
    try {
        const ticker = symbol.replace(".BK", "")
        const url = `https://wp.thunhoon.com/wp-content/custom-api/my-posts.php?per_page=5&page=1&search=${ticker}`
        const res = await fetch(url, { timeout: 10000 })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        return data.slice(0, 5).map((item) => ({
            title: stripHtml(item.title?.rendered || ""),
            snippet: stripHtml(item.content?.rendered || "").slice(0, 400),
            date: item.date || "",
            source: "thunhoon",
        })).filter((item) => isWithinOneWeek(item.date))
    } catch (err) {
        console.warn(`[news] Thunhoon failed for ${symbol}:`, err.message)
        return []
    }
}

async function fetchSerpNews(symbol) {
    try {
        const ticker = symbol.replace(".BK", "")
        const query = encodeURIComponent(`${ticker} ข่าวหุ้นล่าสุด`)
        const url = `https://serpapi.com/search.json?q=${query}&api_key=${SERPAPI_KEY}&engine=google&hl=th&gl=th&num=5&tbm=nws`
        const res = await fetch(url, { timeout: 10000 })
        if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`)
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        const items = data.news_results || data.organic_results || []
        return items.slice(0, 5).map((item) => ({
            title: item.title || "",
            snippet: item.snippet || item.title || "",
            date: item.date || "",
            source: "serp",
        })).filter((item) => isWithinOneWeek(item.date))
    } catch (err) {
        console.warn(`[news] SerpAPI failed for ${symbol}:`, err.message)
        return []
    }
}

async function fetchAISearch(symbol) {
    if (!GEMINI_API_KEY) return []
    try {
        const ticker = symbol.replace(".BK", "")
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            tools: [{ googleSearch: {} }],
        })
        const prompt = `ค้นหาข่าวล่าสุดในช่วง 1 สัปดาห์ที่ผ่านมาเกี่ยวกับหุ้น ${ticker} ในตลาดหลักทรัพย์ไทย สรุปเป็นข้อๆ แต่ละข้อให้มีหัวข่าว วันที่ และเนื้อหาสั้นๆ`
        const result = await model.generateContent(prompt)
        const response = result.response
        const text = response.text()
        const groundingMetadata = response.candidates?.[0]?.groundingMetadata
        const chunks = groundingMetadata?.groundingChunks || []
        const supports = groundingMetadata?.groundingSupports || []

        if (chunks.length === 0) {
            // Fallback: parse Gemini text into a single item
            return [{
                title: `ข่าว ${ticker} จาก Gemini`,
                snippet: text.slice(0, 400),
                date: "",
                source: "gemini",
            }]
        }

        return chunks.slice(0, 5).map((chunk, i) => {
            const web = chunk.web || {}
            const supportText = supports[i]?.segment?.text || ""
            return {
                title: web.title || `ข่าว ${ticker} (${i + 1})`,
                snippet: supportText.slice(0, 400) || text.slice(0, 400),
                date: "",
                source: "gemini",
            }
        })
    } catch (err) {
        console.warn(`[news] Gemini search failed for ${symbol}:`, err.message)
        return []
    }
}

function deduplicateNews(items) {
    const seen = new Set()
    return items.filter((item) => {
        const key = item.title.toLowerCase().trim().slice(0, 50)
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

export async function fetchAllNews(symbol) {
    const [thunhoonResult, serpResult, aiResult] = await Promise.allSettled([
        fetchThunhoon(symbol),
        fetchSerpNews(symbol),
        fetchAISearch(symbol),
    ])

    const thunhoon = thunhoonResult.status === "fulfilled" ? thunhoonResult.value : []
    const serp = serpResult.status === "fulfilled" ? serpResult.value : []
    const ai = aiResult.status === "fulfilled" ? aiResult.value : []

    const all = [...thunhoon, ...serp, ...ai]
    return deduplicateNews(all).slice(0, 10)
}
