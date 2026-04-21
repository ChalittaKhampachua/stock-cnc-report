import "dotenv/config"
import fetch from "node-fetch"
import { analyzeStock } from "./cdc.js"
// import { fetchAllNews } from "./news.js"
// import { analyzeNews } from "./analyze.js"

const TOKEN = process.env.TELEGRAM_TOKEN
const CHAT_ID = process.env.TELEGRAM_CHAT_ID

const WATCHLIST = [
    "ADVANC.BK",
    "BANPU.BK",
    "BGRIM.BK",
    "DIF.BK",
    "GULF.BK",
    "INETREIT.BK",
    "INSET.BK",
    "KBANK.BK",
    "KKP.BK",
    "KTB.BK",
    "THCOM.BK",
    "TTB.BK",
    "SCB.BK",
]

async function sendTelegram(text) {
    // Telegram limit: 4096 chars per message — split if needed
    const chunks = []
    for (let i = 0; i < text.length; i += 4000) {
        chunks.push(text.slice(i, i + 4000))
    }
    for (const chunk of chunks) {
        const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: CHAT_ID, text: chunk, parse_mode: "HTML" }),
        })
        const data = await res.json()
        if (!data.ok) console.warn("[telegram] Error:", data.description)
    }
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
}

function formatMessage(stockInfo) {
    const { symbol, price, zone, label, cdcScore, ema12, ema26, change, changePct, high52w, low52w } = stockInfo

    const changeSign = change >= 0 ? "+" : ""
    const changeStr = `${changeSign}${change?.toFixed(2)} THB (${changeSign}${changePct?.toFixed(2)}%)`

    let msg = `<b>━━━ ${escapeHtml(symbol)} ━━━</b>\n`
    msg += `💰 ราคา: <b>${price?.toFixed(2)} บาท</b>\n`
    msg += `📉 Change Today: ${escapeHtml(changeStr)}\n`
    msg += `📊 CDC: ${escapeHtml(label)} [${cdcScore > 0 ? "+" : ""}${cdcScore}]\n`
    msg += `📈 EMA12: ${ema12?.toFixed(2)} | EMA26: ${ema26?.toFixed(2)}\n`
    if (high52w != null) msg += `🔝 52-Week High: ${high52w?.toFixed(2)} THB\n`
    if (low52w != null) msg += `🔻 52-Week Low: ${low52w?.toFixed(2)} THB\n`

    return msg
}

async function processSymbol(symbol) {
    console.log(`[run] Processing ${symbol}...`)
    try {
        const stockInfo = await analyzeStock(symbol)
        console.log(`[run] ${symbol}: Zone ${stockInfo.zone} | CDC ${stockInfo.cdcScore}`)
        return { msg: formatMessage(stockInfo), stockInfo }
    } catch (err) {
        console.error(`[run] Failed ${symbol}:`, err.message)
        return {
            msg: `❗ <b>${symbol}</b>: ดึงข้อมูลล้มเหลว (${err.message})\n`,
            stockInfo: null,
        }
    }
}

async function run() {
    console.log(`[run] Starting analysis for ${WATCHLIST.length} stocks...`)
    const dateStr = new Date().toLocaleDateString("th-TH", { dateStyle: "medium" })
    const header = `🗓️ <b>รายงานหุ้น</b> — ${dateStr}\n\n`
    const divider = "━━━━━━━━━━━━\n"

    const results = []
    for (const symbol of WATCHLIST) {
        results.push(await processSymbol(symbol))
    }

    const fullMessage = header + results.map((r) => r.msg).join("\n") + "\n" + divider
    await sendTelegram(fullMessage)
    console.log(fullMessage)
    console.log("[run] Done! Telegram sent.")
}

run()

