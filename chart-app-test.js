import { createChart } from 'https://esm.sh/lightweight-charts@4.2.1';
import { RSI, MACD } from 'https://esm.sh/technicalindicators@3.1.0';

let currentTimeframe = '1m';
let currentAsset = 'BTC'; 
let updateInterval = null;
let currentHistoricalBars = []; 
const CHART_API_BASE_URL = "https://trunks-derail-brethren.ngrok-free.dev"; 

// Chart Instance Trackers
let mainChart = null, rsiChart = null, macdChart = null;

// Indicator Series Trackers
let candlestickSeries = null, volumeSeries = null;
let ema9Series = null, ema21Series = null, ema100Series = null, ema200Series = null, vwapSeries = null;
let rsiSeries = null, rsiTopLine = null, rsiBottomLine = null;
let macdLineSeries = null, macdSignalSeries = null, macdHistogramSeries = null;
let limitPriceLine = null;
let entryPriceLine = null;
let takeProfitPriceLine = null;
let stopLossPriceLine = null;

// Shared configuration rules
// Shared configuration rules
const commonOptions = {
    layout: { 
        background: { type: 'solid', color: '#0b0b0b' }, 
        textColor: '#bdbdbd' 
    },
    grid: { 
        vertLines: { color: '#141414' }, 
        horzLines: { color: '#141414' } 
    },
    rightPriceScale: { 
        autoScale: true, 
        borderVisible: true, 
        borderColor: '#2b2b2b',
        minimumWidth: 80
    },
    timeScale: { 
        visible: false, 
        borderColor: '#2b2b2b', 
        barSpacing: 12, 
        rightOffset: 5 
    }
};

function cleanArray(arr) {
    return arr.filter(item => item && item.time && item.value !== undefined && !isNaN(item.value));
}
function removePriceLine(lineRef) {
    if (candlestickSeries && lineRef) {
        candlestickSeries.removePriceLine(lineRef);
    }
    return null;
}

function makePriceLine(price, color, title, lineStyle = 2) {
    if (!candlestickSeries || !price || isNaN(price)) return null;

    return candlestickSeries.createPriceLine({
        price,
        color,
        lineWidth: 2,
        lineStyle,
        axisLabelVisible: true,
        title
    });
}
function calculateEMA(data, period) {
    let emaData = [];
    if (data.length < period) return emaData;
    const k = 2 / (period + 1);
    let sum = 0;
    for (let i = 0; i < period; i++) sum += data[i].close;
    let ema = sum / period;
    emaData.push({ time: data[period - 1].time, value: ema });
    for (let i = period; i < data.length; i++) {
        ema = data[i].close * k + ema * (1 - k);
        emaData.push({ time: data[i].time, value: ema });
    }
    return cleanArray(emaData);
}

function calculateVWAP(data) {
    let vwapData = [];
    let cumulativeValue = 0;
    let cumulativeVolume = 0;
    for (let i = 0; i < data.length; i++) {
        const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
        const volume = data[i].volume || 100;
        cumulativeValue += typicalPrice * volume;
        cumulativeVolume += volume;
        vwapData.push({ time: data[i].time, value: cumulativeValue / cumulativeVolume });
    }
    return cleanArray(vwapData);
}

function initChartInstances() {
    // Clear old instances explicitly
    if (mainChart) { mainChart.remove(); rsiChart.remove(); macdChart.remove(); }

    const mainDiv = document.getElementById('main-container');
    const rsiDiv = document.getElementById('rsi-container');
    const macdDiv = document.getElementById('macd-container');

    // 1. Build Main Candlestick Window
    mainChart = createChart(mainDiv, { ...commonOptions, width: mainDiv.clientWidth, height: mainDiv.clientHeight });
    candlestickSeries = mainChart.addCandlestickSeries({
    upColor: '#00ff66',
    downColor: '#ff2a2a',
    borderVisible: false,
    wickUpColor: '#00ff66',
    wickDownColor: '#ff2a2a'
});

    candlestickSeries.applyOptions({
        priceFormat: { type: 'price', precision: currentAsset === 'XRP' ? 4 : 2, minMove: currentAsset === 'XRP' ? 0.0001 : 0.01 }
    });
        mainChart.subscribeClick(param => {
        if (!param || param.point === undefined || !candlestickSeries) return;
        if (window.ORDER_TYPE !== 'LIMIT') return;
        if (typeof window.setExecutionPrice !== 'function') return;

        const price = candlestickSeries.coordinateToPrice(param.point.y);
        if (!price || isNaN(price)) return;

        window.setExecutionPrice(price);
    });

    // Overlays
    ema9Series = mainChart.addLineSeries({ color: '#00b4d8', lineWidth: 1.5, title: '9 EMA' });
    ema21Series = mainChart.addLineSeries({ color: '#ffb703', lineWidth: 1.5, title: '21 EMA' });
    ema100Series = mainChart.addLineSeries({ color: '#4ea8de', lineWidth: 1.5, title: '100 EMA' });
    ema200Series = mainChart.addLineSeries({ color: '#7209b7', lineWidth: 2, title: '200 EMA' });
    vwapSeries = mainChart.addLineSeries({ color: '#d90429', lineWidth: 2, title: 'VWAP' });
    
    volumeSeries = mainChart.addHistogramSeries({ color: '#26a69a', priceFormat: { type: 'volume' }, priceScaleId: 'volume-scale' });
    mainChart.priceScale('volume-scale').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });

    // 2. Build RSI Sub-Window
    rsiChart = createChart(rsiDiv, { ...commonOptions, width: rsiDiv.clientWidth, height: rsiDiv.clientHeight });
    rsiChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.18, bottom: 0.18 } });
    
    rsiSeries = rsiChart.addLineSeries({ color: '#9d4edd', lineWidth: 1.5, title: 'RSI (14)' });
    rsiTopLine = rsiChart.addLineSeries({ color: '#3a0ca3', lineWidth: 1, lineStyle: 2, title: '' });
    rsiBottomLine = rsiChart.addLineSeries({ color: '#3a0ca3', lineWidth: 1, lineStyle: 2, title: '' });

    // 3. Build MACD Sub-Window
    macdChart = createChart(macdDiv, { 
    ...commonOptions, 
    width: macdDiv.clientWidth, 
    height: macdDiv.clientHeight
    });
    
    macdChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.15, bottom: 0.15 } });
    
    macdLineSeries = macdChart.addLineSeries({ color: '#00b4d8', lineWidth: 1.5, title: 'MACD' });
    macdSignalSeries = macdChart.addLineSeries({ color: '#ffb703', lineWidth: 1.5, title: 'Signal' });
    macdHistogramSeries = macdChart.addHistogramSeries({ title: 'Hist' });

    // --- TIMELINE SYNCHRONIZATION LOOP ---
    let isSyncing = false;
    const syncTimelines = (masterChart, targets) => {
        masterChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
            if (isSyncing || !range) return;
            isSyncing = true;
            targets.forEach(t => {
                if(t && t.timeScale) t.timeScale().setVisibleLogicalRange(range);
            });
            isSyncing = false;
        });
    };
    syncTimelines(mainChart, [rsiChart, macdChart]);
}

function getAssetFallbackPrice(asset) {
    if (asset === 'BTC') return 76500;
    if (asset === 'ETH') return 2100;
    if (asset === 'SOL') return 145;
    if (asset === 'XRP') return 1.39; 
    return 100;
}

function extractPriceFromFeed(matrix, assetKey) {
    if (!matrix) return null;
    const targets = [assetKey, assetKey.toLowerCase(), `${assetKey}/USD`, `${assetKey}USD`];
    for (const t of targets) {
        if (matrix[t] !== undefined && matrix[t] !== null) {
            const parsed = parseFloat(matrix[t]);
            if (!isNaN(parsed) && parsed > 0) return parsed;
        }
    }
    return null;
}

async function fetchRealCandles(timeframe, asset) {
        const response = await fetch(`${CHART_API_BASE_URL}/api/candles/${asset}?tf=${timeframe}`, {
        headers: {
            "ngrok-skip-browser-warning": "true"
        }
    });
    if (!response.ok) {
        throw new Error(`Candle fetch failed: ${response.status}`);
    }

    const candles = await response.json();

    return candles
        .map(candle => ({
            time: Number(candle.time),
            open: Number(candle.open),
            high: Number(candle.high),
            low: Number(candle.low),
            close: Number(candle.close),
            volume: Number(candle.volume || 0)
        }))
        .filter(candle =>
            candle.time &&
            !isNaN(candle.open) &&
            !isNaN(candle.high) &&
            !isNaN(candle.low) &&
            !isNaN(candle.close)
        );
}

function generateHistoricalBars(timeframe, asset, startingPrice) {
    let basePrice = typeof startingPrice === 'number' ? startingPrice : parseFloat(startingPrice);
    if (isNaN(basePrice)) basePrice = getAssetFallbackPrice(asset);

    const now = Math.floor(Date.now() / 1000);
    const interval = timeframe === '5m' ? 300 : timeframe === '1h' ? 3600 : timeframe === '1d' ? 86400 : 60;
    const volatilityFactor = basePrice * 0.0015;
    const bars = [];

    let currentTime = Math.floor((now - (249 * interval)) / interval) * interval;

    for (let i = 0; i < 250; i++) {
        const open = basePrice;
        const drift = (Math.random() * volatilityFactor * 2) - volatilityFactor;
        const close = open + drift;
        const high = Math.max(open, close) + (Math.random() * volatilityFactor * 0.2);
        const low = Math.min(open, close) - (Math.random() * volatilityFactor * 0.2);

        bars.push({
            time: currentTime,
            open: parseFloat(open.toFixed(4)),
            high: parseFloat(high.toFixed(4)),
            low: parseFloat(low.toFixed(4)),
            close: parseFloat(close.toFixed(4)),
            volume: Math.floor(Math.random() * 500) + 100
        });

        basePrice = close;
        currentTime += interval;
    }

    return bars;
}

async function loadChartWorkspace() {
    try {
        initChartInstances();

        let realAnchorPrice = null;
        try {
                        const response = await fetch(`${CHART_API_BASE_URL}/api/prices`, {
                headers: {
                    "ngrok-skip-browser-warning": "true"
                }
            });
            const priceMatrix = await response.json();
            realAnchorPrice = extractPriceFromFeed(priceMatrix, currentAsset);
        } catch (e) {
            console.warn("Local backend connection skipped. Processing static feeds.");
        }
        
        if (!realAnchorPrice) realAnchorPrice = getAssetFallbackPrice(currentAsset);

        currentHistoricalBars = await fetchRealCandles(currentTimeframe, currentAsset);
        
        refreshChartOverlays();
        updateRowLayouts(); 
        
        mainChart.priceScale('right').applyOptions({ autoScale: true });
        mainChart.timeScale().fitContent();

        // Strong MACD nudge - this should finally move it
        setTimeout(() => {
            const range = mainChart.timeScale().getVisibleLogicalRange();
            if (range) {
                if (rsiChart) rsiChart.timeScale().setVisibleLogicalRange(range);
                if (macdChart) macdChart.timeScale().setVisibleLogicalRange(range);
            }
        }, 250);

        initPriceLoop();

    } catch (err) {
        console.error("Critical sandbox crash caught:", err);
    }
}

function isToggleChecked(id, defaultValue = false) {
    const toggle = document.getElementById(id);
    return toggle ? toggle.checked : defaultValue;
}

function refreshChartOverlays() {
    if (!candlestickSeries) return;
    candlestickSeries.setData(currentHistoricalBars);

    ema9Series.setData(isToggleChecked('toggle-ema9') ? calculateEMA(currentHistoricalBars, 9) : []);
    ema21Series.setData(isToggleChecked('toggle-ema21') ? calculateEMA(currentHistoricalBars, 21) : []);
    ema100Series.setData(isToggleChecked('toggle-ema100') ? calculateEMA(currentHistoricalBars, 100) : []);
    ema200Series.setData(isToggleChecked('toggle-ema200') ? calculateEMA(currentHistoricalBars, 200) : []);
    vwapSeries.setData(isToggleChecked('toggle-vwap') ? calculateVWAP(currentHistoricalBars) : []);

    if (isToggleChecked('toggle-volume', true)) {
        volumeSeries.setData(currentHistoricalBars.map(b => ({
            time: b.time, value: b.volume, color: b.close >= b.open ? '#00ff6622' : '#ff2a2a22'
        })));
    } else {
        volumeSeries.setData([]);
    }

    // RSI
    if (isToggleChecked('toggle-rsi', true) && currentHistoricalBars.length > 14) {
        const closePrices = currentHistoricalBars.map(b => b.close);
        const rsiValues = RSI.calculate({ values: closePrices, period: 14 });
        
        const rsiMapped = [];
        const offset = Math.max(0, currentHistoricalBars.length - rsiValues.length);
        
        for (let i = 0; i < rsiValues.length; i++) {
            const barIdx = offset + i;
            if (barIdx < currentHistoricalBars.length) {
                rsiMapped.push({ 
                    time: currentHistoricalBars[barIdx].time, 
                    value: rsiValues[i] 
                });
            }
        }

        rsiSeries.setData(cleanArray(rsiMapped));
        rsiTopLine.setData(currentHistoricalBars.map(b => ({ time: b.time, value: 70 })));
        rsiBottomLine.setData(currentHistoricalBars.map(b => ({ time: b.time, value: 30 })));
    } else {
        rsiSeries.setData([]); 
        rsiTopLine.setData([]); 
        rsiBottomLine.setData([]);
    }

    // MACD - FIXED ALIGNMENT
    if (isToggleChecked('toggle-macd', true) && currentHistoricalBars.length > 26) {
        const closePrices = currentHistoricalBars.map(b => b.close);
        const macdValues = MACD.calculate({ 
            values: closePrices, 
            fastPeriod: 12, 
            slowPeriod: 26, 
            signalPeriod: 9, 
            SimpleMAOscillator: false, 
            SimpleMASignal: false 
        });

const macdLineData = currentHistoricalBars.map(b => ({ time: b.time }));
const macdSignalData = currentHistoricalBars.map(b => ({ time: b.time }));
const macdHistData = currentHistoricalBars.map(b => ({ time: b.time }));

const offset = Math.max(0, currentHistoricalBars.length - macdValues.length);

macdValues.forEach((res, idx) => {
    const barIdx = offset + idx;
    if (barIdx >= currentHistoricalBars.length) return;

    const time = currentHistoricalBars[barIdx].time;

    if (res.macd !== undefined && !isNaN(res.macd)) {
        macdLineData[barIdx] = { time, value: res.macd };
    }

    if (res.signal !== undefined && !isNaN(res.signal)) {
        macdSignalData[barIdx] = { time, value: res.signal };
    }

    if (res.histogram !== undefined && !isNaN(res.histogram)) {
        macdHistData[barIdx] = {
            time,
            value: res.histogram,
            color: res.histogram >= 0 ? '#00ff66cc' : '#ff2a2acc'
        };
    }
});

        macdLineSeries.setData(macdLineData);
        macdSignalSeries.setData(macdSignalData);
        macdHistogramSeries.setData(macdHistData);
    } else {
        macdLineSeries.setData([]); 
        macdSignalSeries.setData([]); 
        macdHistogramSeries.setData([]);
    }

// Force strong re-sync
setTimeout(() => {
    if (mainChart) {
        const range = mainChart.timeScale().getVisibleLogicalRange();
        if (range) {
            if (rsiChart) rsiChart.timeScale().setVisibleLogicalRange(range);
            if (macdChart) macdChart.timeScale().setVisibleLogicalRange(range);
        }
    }
}, 100);
}

function initPriceLoop() {
    if (updateInterval) clearInterval(updateInterval);

    updateInterval = setInterval(async () => {
        try {
            let livePrice = null;
            try {
                                const response = await fetch(`${CHART_API_BASE_URL}/api/prices`, {
                    headers: {
                        "ngrok-skip-browser-warning": "true"
                    }
                });
                const priceMatrix = await response.json();
                livePrice = extractPriceFromFeed(priceMatrix, currentAsset);
            } catch (e) {
                let lastClose = currentHistoricalBars[currentHistoricalBars.length - 1]?.close || getAssetFallbackPrice(currentAsset);
                livePrice = lastClose + ((Math.random() - 0.5) * (lastClose * 0.001));
            }

            if (!livePrice || isNaN(livePrice)) return;

            let interval = currentTimeframe === '5m' ? 300 : currentTimeframe === '1h' ? 3600 : currentTimeframe === '1d' ? 86400 : 60;
            const nowSeconds = Math.floor(Date.now() / 1000);
            const currentBarTime = Math.floor(nowSeconds / interval) * interval;

            let lastBar = currentHistoricalBars[currentHistoricalBars.length - 1];
            let liveVolTick = Math.floor(Math.random() * 30) + 5;

            if (lastBar && lastBar.time === currentBarTime) {
                lastBar.close = livePrice; lastBar.high = Math.max(lastBar.high, livePrice);
                lastBar.low = Math.min(lastBar.low, livePrice); lastBar.volume += liveVolTick; 
            } else {
                const newBar = {
                    time: currentBarTime, open: lastBar ? lastBar.close : livePrice,
                    high: livePrice, low: livePrice, close: livePrice, volume: liveVolTick
                };
                currentHistoricalBars.push(newBar);
                if (currentHistoricalBars.length > 300) currentHistoricalBars.shift();
            }

            const updatedLastBar = currentHistoricalBars[currentHistoricalBars.length - 1];
            
            candlestickSeries.update({
                time: updatedLastBar.time,
                open: parseFloat(updatedLastBar.open), high: parseFloat(updatedLastBar.high),
                low: parseFloat(updatedLastBar.low), close: parseFloat(updatedLastBar.close)
            });

            if (isToggleChecked('toggle-volume', true)) {
                volumeSeries.update({ time: updatedLastBar.time, value: updatedLastBar.volume, color: updatedLastBar.close >= updatedLastBar.open ? '#00ff6622' : '#ff2a2a22' });
            }

            if (document.getElementById('toggle-ema9')?.checked) ema9Series.update(calculateEMA(currentHistoricalBars, 9).pop());
            if (document.getElementById('toggle-ema21')?.checked) ema21Series.update(calculateEMA(currentHistoricalBars, 21).pop());
            if (document.getElementById('toggle-ema100')?.checked) ema100Series.update(calculateEMA(currentHistoricalBars, 100).pop());
            if (document.getElementById('toggle-ema200')?.checked) ema200Series.update(calculateEMA(currentHistoricalBars, 200).pop());
            if (document.getElementById('toggle-vwap')?.checked) vwapSeries.update(calculateVWAP(currentHistoricalBars).pop());

            if (isToggleChecked('toggle-rsi', true) && currentHistoricalBars.length > 14) {
                const closePrices = currentHistoricalBars.map(b => b.close);
                const rsiValues = RSI.calculate({ values: closePrices, period: 14 });
                if (rsiValues.length > 0) {
                    rsiSeries.update({ time: updatedLastBar.time, value: rsiValues[rsiValues.length - 1] });
                    rsiTopLine.update({ time: updatedLastBar.time, value: 70 });
                    rsiBottomLine.update({ time: updatedLastBar.time, value: 30 });
                }
            }
            
            if (isToggleChecked('toggle-macd', true) && currentHistoricalBars.length > 26) {
                const closePrices = currentHistoricalBars.map(b => b.close);
                const macdValues = MACD.calculate({ values: closePrices, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
                if (macdValues.length > 0) {
                    const lastMacd = macdValues[macdValues.length - 1];
                    if (lastMacd.macd !== undefined) macdLineSeries.update({ time: updatedLastBar.time, value: lastMacd.macd });
                    if (lastMacd.signal !== undefined) macdSignalSeries.update({ time: updatedLastBar.time, value: lastMacd.signal });
                    if (lastMacd.histogram !== undefined) {
                        macdHistogramSeries.update({ time: updatedLastBar.time, value: lastMacd.histogram, color: lastMacd.histogram >= 0 ? '#00ff66cc' : '#ff2a2acc' });
                    }
                }
            }
        } catch (err) {
            console.error("Polled price frame tick processing error:", err);
        }
    }, 1000);
}

// --- UI EVENT BINDINGS & DRAGGABLE VIEW ENGINE ---
function updateRowLayouts() {
    const rsiChecked = document.getElementById('toggle-rsi')?.checked || false;
    const macdChecked = document.getElementById('toggle-macd')?.checked || false;

    const mainDiv = document.getElementById('main-container');
    const rsiDiv = document.getElementById('rsi-container');
    const macdDiv = document.getElementById('macd-container');
    
    const rsiSplitter = document.getElementById('rsi-splitter');
    const macdSplitter = document.getElementById('macd-splitter');

    // Show/hide panels
    rsiDiv.style.display = rsiChecked ? 'block' : 'none';
    rsiSplitter.style.display = rsiChecked ? 'block' : 'none';
    macdDiv.style.display = macdChecked ? 'block' : 'none';
    macdSplitter.style.display = macdChecked ? 'block' : 'none';

    // Height distribution
    if (rsiChecked && macdChecked) {
        mainDiv.style.flexGrow = "50";
        rsiDiv.style.flexGrow = "25";
        macdDiv.style.flexGrow = "25";
    } else if (rsiChecked) {
        mainDiv.style.flexGrow = "65";
        rsiDiv.style.flexGrow = "35";
    } else if (macdChecked) {
        mainDiv.style.flexGrow = "65";
        macdDiv.style.flexGrow = "35";
    } else {
        mainDiv.style.flexGrow = "100";
    }
clearTimeout(window._layoutTimer);

window._layoutTimer = setTimeout(() => {
    triggerChartResize();
}, 120);
}

function triggerChartResize() {
    const mainDiv = document.getElementById('main-container');
    const rsiDiv = document.getElementById('rsi-container');
    const macdDiv = document.getElementById('macd-container');

    if (mainChart && mainDiv && mainDiv.clientWidth > 0 && mainDiv.clientHeight > 0) {
        mainChart.resize(mainDiv.clientWidth, mainDiv.clientHeight);
    }
    if (rsiChart && rsiDiv && rsiDiv.clientWidth > 0 && rsiDiv.clientHeight > 0) {
        rsiChart.resize(rsiDiv.clientWidth, rsiDiv.clientHeight);
    }
    if (macdChart && macdDiv && macdDiv.clientWidth > 0 && macdDiv.clientHeight > 0) {
        macdChart.resize(macdDiv.clientWidth, macdDiv.clientHeight);
    }
requestAnimationFrame(() => {
        if (!mainChart) return;

        const range = mainChart.timeScale().getVisibleLogicalRange();

        if (range) {
            if (rsiChart) rsiChart.timeScale().setVisibleLogicalRange(range);
            if (macdChart) macdChart.timeScale().setVisibleLogicalRange(range);
        }
    });
}

function forceResyncAndFit() {
    setTimeout(() => {
        triggerChartResize();
        
        if (mainChart) {
            const range = mainChart.timeScale().getVisibleLogicalRange();
            if (range) {
                if (rsiChart) rsiChart.timeScale().setVisibleLogicalRange(range);
                if (macdChart) macdChart.timeScale().setVisibleLogicalRange(range);
            } else {
                mainChart.timeScale().fitContent();
            }
            
            mainChart.priceScale('right').applyOptions({ autoScale: true });
        }
    }, 80);
}


// --- ACTIVE EVENT ENGINE FOR TRADINGVIEW SPLIT INTERACTIVITY ---
let activeSplitter = null;
let startY = 0;
let startTopFlex = 0;
let startBottomFlex = 0;

function initSplitterDrag(splitterId, topContainerId, bottomContainerId) {
    const splitter = document.getElementById(splitterId);
    if (!splitter) return;
    
    splitter.addEventListener('mousedown', (e) => {
        activeSplitter = splitter;
        startY = e.clientY;
        
        const topContainer = document.getElementById(topContainerId);
        const bottomContainer = document.getElementById(bottomContainerId);
        
        startTopFlex = parseFloat(window.getComputedStyle(topContainer).flexGrow) || 1;
        startBottomFlex = parseFloat(window.getComputedStyle(bottomContainer).flexGrow) || 1;
        
        splitter.classList.add('dragging');
        e.preventDefault();
    });
}

window.addEventListener('mousemove', (e) => {
    if (!activeSplitter) return;
    
    const deltaY = e.clientY - startY;
    const workspaceHeight = document.getElementById('workspace').clientHeight;
    const flexDelta = (deltaY / workspaceHeight) * 100; 
    
    let topTarget, bottomTarget;
    if (activeSplitter.id === 'rsi-splitter') {
        topTarget = document.getElementById('main-container');
        bottomTarget = document.getElementById('rsi-container');
    } else if (activeSplitter.id === 'macd-splitter') {
        const rsiActive = document.getElementById('toggle-rsi')?.checked;
        topTarget = rsiActive ? document.getElementById('rsi-container') : document.getElementById('main-container');
        bottomTarget = document.getElementById('macd-container');
    }
    
    if (topTarget && bottomTarget) {
        const newTopFlex = Math.max(startTopFlex + flexDelta, 10); 
        const newBottomFlex = Math.max(startBottomFlex - flexDelta, 10);
        
        topTarget.style.flexGrow = newTopFlex;
        bottomTarget.style.flexGrow = newBottomFlex;
        
        triggerChartResize();
    }
});

window.addEventListener('mouseup', () => {
    if (activeSplitter) {
        activeSplitter.classList.remove('dragging');
        activeSplitter = null;
    }
});

// Initialize Drag Interactivity Controls
initSplitterDrag('rsi-splitter', 'main-container', 'rsi-container');
initSplitterDrag('macd-splitter', 'rsi-container', 'macd-container');

document.querySelectorAll('.tf-btn').forEach(button => {
    button.addEventListener('click', (e) => {
        document.querySelectorAll('.tf-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        currentTimeframe = e.target.getAttribute('data-tf') || '1m';
        loadChartWorkspace();
    });
});

['toggle-ema9', 'toggle-ema21', 'toggle-ema100', 'toggle-ema200', 'toggle-vwap', 'toggle-volume'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => refreshChartOverlays());
});

['toggle-rsi', 'toggle-macd'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
        updateRowLayouts();
        refreshChartOverlays();
        forceResyncAndFit();     // ← This is the important new line
    });
});


loadChartWorkspace();

window.addEventListener('resize', () => {
    const mainDiv = document.getElementById('main-container');
    const rsiDiv = document.getElementById('rsi-container');
    const macdDiv = document.getElementById('macd-container');
    if (mainChart && mainDiv && mainDiv.clientWidth > 0 && mainDiv.clientHeight > 0) mainChart.resize(mainDiv.clientWidth, mainDiv.clientHeight);
    if (rsiChart && rsiDiv && rsiDiv.clientWidth > 0 && rsiDiv.clientHeight > 0) rsiChart.resize(rsiDiv.clientWidth, rsiDiv.clientHeight);
    if (macdChart && macdDiv && macdDiv.clientWidth > 0 && macdDiv.clientHeight > 0) macdChart.resize(macdDiv.clientWidth, macdDiv.clientHeight);
});
window.RebelChart = {
    switchAsset(assetKey) {
    if (!assetKey) return;
    currentAsset = assetKey;
    loadChartWorkspace();
},

    updateLivePrice(price) {
    const livePrice = Number(price);
    if (!livePrice || isNaN(livePrice) || !candlestickSeries || currentHistoricalBars.length === 0) return;

    const interval = currentTimeframe === '5m' ? 300 : currentTimeframe === '15m' ? 900 : currentTimeframe === '1h' ? 3600 : currentTimeframe === '1d' ? 86400 : 60;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const currentBarTime = Math.floor(nowSeconds / interval) * interval;

    let lastBar = currentHistoricalBars[currentHistoricalBars.length - 1];

    if (lastBar && lastBar.time === currentBarTime) {
        lastBar.close = livePrice;
        lastBar.high = Math.max(lastBar.high, livePrice);
        lastBar.low = Math.min(lastBar.low, livePrice);
    } else {
        lastBar = {
            time: currentBarTime,
            open: currentHistoricalBars[currentHistoricalBars.length - 1].close,
            high: livePrice,
            low: livePrice,
            close: livePrice,
            volume: 0
        };

        currentHistoricalBars.push(lastBar);
        if (currentHistoricalBars.length > 300) currentHistoricalBars.shift();
    }

    candlestickSeries.update({
        time: lastBar.time,
        open: lastBar.open,
        high: lastBar.high,
        low: lastBar.low,
        close: lastBar.close
    });

    if (isToggleChecked('toggle-volume', true) && volumeSeries) {
        volumeSeries.update({
            time: lastBar.time,
            value: lastBar.volume || 0,
            color: lastBar.close >= lastBar.open ? '#00ff6622' : '#ff2a2a22'
        });
    }
},

    clearTradeLines() {
        limitPriceLine = removePriceLine(limitPriceLine);
        entryPriceLine = removePriceLine(entryPriceLine);
        takeProfitPriceLine = removePriceLine(takeProfitPriceLine);
        stopLossPriceLine = removePriceLine(stopLossPriceLine);
    },

    showLimitLine(price, precision = 2) {
        limitPriceLine = removePriceLine(limitPriceLine);
        if (!price || isNaN(price)) return;

        limitPriceLine = makePriceLine(
            price,
            '#ffb703',
            `LIMIT $${Number(price).toFixed(precision)}`,
            2
        );
    },

    showPositionLines(position, precision = 2) {
        limitPriceLine = removePriceLine(limitPriceLine);
        entryPriceLine = removePriceLine(entryPriceLine);
        takeProfitPriceLine = removePriceLine(takeProfitPriceLine);
        stopLossPriceLine = removePriceLine(stopLossPriceLine);

        if (!position || !position.hasPosition) return;

        const sideLabel = position.side === 'BUY' ? 'LONG' : 'SHORT';

        entryPriceLine = makePriceLine(
            position.entryPrice,
            '#00ff66',
            `ENTRY ${sideLabel} $${Number(position.entryPrice).toFixed(precision)}`,
            0
        );

        if (position.tpPrice > 0) {
            takeProfitPriceLine = makePriceLine(
                position.tpPrice,
                '#00ff66',
                `TP $${Number(position.tpPrice).toFixed(precision)}`,
                2
            );
        }

        if (position.slPrice > 0) {
            stopLossPriceLine = makePriceLine(
                position.slPrice,
                '#ff2a2a',
                `SL $${Number(position.slPrice).toFixed(precision)}`,
                2
            );
        }
    },

    updateEntryLine(position, floatingPnl, precision = 2) {
        if (!position || !position.hasPosition) return;

        entryPriceLine = removePriceLine(entryPriceLine);

        const sideLabel = position.side === 'BUY' ? 'LONG' : 'SHORT';
        const pnlValue = Number(floatingPnl) || 0;
        const pnlColor = pnlValue >= 0 ? '#00ff66' : '#ff2a2a';
        const pnlText = pnlValue >= 0
            ? `+$${pnlValue.toFixed(2)}`
            : `-$${Math.abs(pnlValue).toFixed(2)}`;

        entryPriceLine = makePriceLine(
            position.entryPrice,
            pnlColor,
            `ENTRY ${sideLabel} | ${pnlText}`,
            0
        );
    }
};
