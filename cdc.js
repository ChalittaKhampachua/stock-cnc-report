import YahooFinance from "yahoo-finance2"
import { EMA } from "technicalindicators"

const yahooFinance = new YahooFinance()

export async function fetchCloses(symbol, days = 60) {
    const period2 = new Date()
    const period1 = new Date()
    period1.setDate(period1.getDate() - days)

    const rows = await yahooFinance.historical(symbol, {
        period1: period1.toISOString().split("T")[0],
        period2: period2.toISOString().split("T")[0],
        interval: "1d",
    })

    // เรียงเก่า → ใหม่
    rows.sort((a, b) => new Date(a.date) - new Date(b.date))
    return rows.map((r) => r.close)
}

export function calcEMA(closes) {
    const ema12 = EMA.calculate({ period: 12, values: closes })
    const ema26 = EMA.calculate({ period: 26, values: closes })
    return {
        ema12: ema12.at(-1),
        ema26: ema26.at(-1),
    }
}

export function getCDCZone(price, ema12, ema26) {
    if (price > ema12 && ema12 > ema26) {
        return { zone: 1, label: "🟢 Zone 1 — BUY", cdcScore: 2 }
    }
    if (ema12 > price && price > ema26) {
        return { zone: 2, label: "🟡 Zone 2 — Weakening Uptrend", cdcScore: 1 }
    }
    if (ema12 > ema26 && ema26 > price) {
        return { zone: 3, label: "🟡 Zone 3 — Below Both EMAs", cdcScore: 1 }
    }
    if (price < ema12 && ema12 < ema26) {
        return { zone: 4, label: "🔴 Zone 4 — SELL", cdcScore: -2 }
    }
    if (ema12 < price && price < ema26) {
        return { zone: 5, label: "🟠 Zone 5 — Bear Bounce", cdcScore: -1 }
    }
    if (ema12 < ema26 && ema26 < price) {
        return { zone: 6, label: "🟠 Zone 6 — Above EMAs in Downtrend", cdcScore: -1 }
    }
    return { zone: 0, label: "⚪ Undefined", cdcScore: 0 }
}

export async function analyzeStock(symbol) {
    const [closes, quote] = await Promise.all([
        fetchCloses(symbol, 60),
        yahooFinance.quote(symbol),
    ])

    if (closes.length < 26) {
        throw new Error(`Not enough data for ${symbol}: got ${closes.length} candles`)
    }

    const price = quote?.regularMarketPrice ?? closes.at(-1)
    const { ema12, ema26 } = calcEMA(closes)
    const { zone, label, cdcScore } = getCDCZone(price, ema12, ema26)

    const change = quote?.regularMarketChange ?? 0
    const changePct = quote?.regularMarketChangePercent ?? 0
    const high52w = quote?.fiftyTwoWeekHigh ?? null
    const low52w = quote?.fiftyTwoWeekLow ?? null

    return { symbol, price, ema12, ema26, zone, label, cdcScore, change, changePct, high52w, low52w }
}
