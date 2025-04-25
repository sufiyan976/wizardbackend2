const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/stocks", async (req, res) => {
  try {
    const homeUrl = "https://chartink.com/";
    const apiUrl = "https://chartink.com/screener/process";

    const scans = {
      buy: {
        scan_clause:
          "( {cash} ( [=1] 5 minute close >= [=1] 5 minute open * 1.005 and [=1] 5 minute volume > 100000 and [=1] 5 minute rsi( 14 ) > 70 ) )"
      },
      sell: {
        scan_clause:
          "( {cash} ( [=1] 5 minute volume > 100000 and [=2] 5 minute rsi( 14 ) < 35 and [=1] 5 minute close <= [=1] 5 minute open * 0.995 ) )"
      },
      advanceBuy: {
        scan_clause:
          "( {cash} ( [=1] 5 minute close >= [=1] 5 minute open * 1.005 and [=1] 5 minute volume > 100000 and [=1] 5 minute buyer initiated trades quantity > 50000 and [=1] 5 minute rsi( 14 ) > 70 ) )"
      },
      advanceSell: {
        scan_clause:
          "( {cash} ( [=1] 5 minute volume > 100000 and [=1] 5 minute seller initiated trades quantity > 50000 and [=1] 5 minute rsi( 14 ) < 35 and [=1] 5 minute close <= [=1] 5 minute open * 0.995 ) )"
      },
      volumeGainers: {
        scan_clause: "( {cash} ( latest volume > 100000 ) )"
      },
      topGainers: {
        scan_clause:
          "( {cash} ( latest close > 1 day ago close and latest close > 100 and latest volume > 100000 ) )"
      },
      topLosers: {
        scan_clause:
          "( {cash} ( latest close < 1 day ago close and latest close > 100 and latest volume > 100000 ) )"
      },
      niftyGainers: {
        scan_clause:
          "( {57960} ( latest close > 1 day ago close and latest close > 100 and latest volume > 100000 ) )"
      },
      niftyLosers: {
        scan_clause:
          "( {57960} ( latest close < 1 day ago close and latest close > 100 and latest volume > 100000 ) )"
      },
      fiftyTwoWeekHigh: {
        scan_clause:
          "( {cash} ( latest high = latest max( 260 , latest high ) ) )"
      },
      fiftyEmaSupport: {
        scan_clause:
          "( {cash} ( latest ema( close,50 ) >= latest low and( {cash} ( latest close >= latest ema( close,50 ) and latest volume > 100000 ) ) ) )"
      },
      vcpPattern: {
        scan_clause:
          "( {cash} ( weekly ema( close,13 ) > weekly ema( close,26 ) and weekly ema( close,26 ) > weekly sma( close,50 ) and weekly sma( close,40 ) > 5 weeks ago sma( close,40 ) and latest close >= weekly min( 50 , weekly low * 1.3 ) and latest close >= weekly max( 50 , weekly high * 0.75 ) and 20 days ago ema( close,13 ) > 20 weeks ago ema( close,26 ) and 5 weeks ago sma( close,40 ) > 10 weeks ago sma( close,40 ) and latest close > latest sma( close,50 ) and( weekly wma( close,8 ) - weekly sma( close,8 ) ) * 6 / 29 < 0.5 and latest close > 10 ) )"
      },
      zeroVolume: {
        scan_clause:
          "( {45603} ( latest close >= 1 and latest volume = 0 ) )"
      },
      nifty50CloseAbove20: {
        scan_clause:
          "( {33492} ( latest close > 20 ) )"
      },
      allCashCloseAbove20: {
        scan_clause:
          "( {cash} ( latest close > 20 ) )"
      }
    };

    const homeResponse = await axios.get(homeUrl, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(homeResponse.data);
    const csrfToken = $('meta[name="csrf-token"]').attr("content");
    if (!csrfToken) throw new Error("CSRF token not found!");

    const sessionCookies = homeResponse.headers["set-cookie"].join("; ");

    const headers = {
      "x-csrf-token": csrfToken,
      "User-Agent": "Mozilla/5.0",
      Referer: homeUrl,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: sessionCookies
    };

    const scanEntries = Object.entries(scans);
    const responses = await Promise.all(
      scanEntries.map(([key, scan]) =>
        axios.post(apiUrl, scan, { headers })
      )
    );

    const result = {};
    const sideMap = {
      niftyGainers: "gainerNifty500",
      niftyLosers: "loserNifty500",
      advanceBuy: "advanceBuy",
      advanceSell: "advanceSell",
      fiftyTwoWeekHigh: "fiftyTwoWeekHigh",
      fiftyEmaSupport: "fiftyEmaSupport",
      vcpPattern: "vcpPattern",
      zeroVolume: "zeroVolume",
      nifty50CloseAbove20: "nifty50CloseAbove20",
      allCashCloseAbove20: "allCashCloseAbove20"
    };

    for (let i = 0; i < responses.length; i++) {
      const [key] = scanEntries[i];
      const data = responses[i].data.data || [];
      result[key] = data.map(stock => ({
        ...stock,
        side: sideMap[key] || key
      }));
    }

    // New momentum strength using median
    const calcMomentum = (stocks) => {
      const volumes = stocks.map(s => s.volume).sort((a, b) => a - b);
      const mid = Math.floor(volumes.length / 2);
      const median = volumes.length % 2 === 0
        ? (volumes[mid - 1] + volumes[mid]) / 2
        : volumes[mid];

      return stocks.map(s => ({
        ...s,
        momentumStrength: +(s.volume / (median || 1)).toFixed(2)
      }));
    };

    result.buy = calcMomentum(result.buy || []);
    result.sell = calcMomentum(result.sell || []);
    result.advanceBuy = calcMomentum(result.advanceBuy || []);
    result.advanceSell = calcMomentum(result.advanceSell || []);

    const allStocks = Object.values(result).flat();
    res.json(allStocks);
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ error: error.message || "Failed to fetch stock data" });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
