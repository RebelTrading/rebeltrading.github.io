import { createChart } from 'lightweight-charts';
import { RSI, MACD } from 'technicalindicators';

let currentTimeframe = '1m';
let currentAsset = 'BTC'; 
let updateInterval = null;
let currentHistoricalBars = []; 

// Chart Instance Trackers
let mainChart = null, rsiChart = null, macdChart = null;

// Indicator Series Trackers
let candlestickSeries = null, volumeSeries = null;
let ema9Series = null, ema21Series = null, ema100Series = null, ema200Series = null, vwapSeries = null;
let rsiSeries = null, rsiTopLine = null, rsiBottomLine = null;
let macdLineSeries = null, macdSignalSeries = null, macdHistogramSeries = null;

// Shared configuration rules
const commonOptions = {
    layout: { background: { type: 'solid', color: '#0b0b0b' }, textColor: '#bdbdbd' },
    grid: { vertLines: { color: '#141414' }, horzLines: { color: '#141414' } },
    rightPriceScale: { autoScale: true, borderVisible: true, borderColor: '#2b2b2b' },
    timeScale: { visible: false, borderColor: '#2b2b2b', barSpacing: 12, rightOffset: 5 }
};

function cleanArray(arr) {
    return arr.filter(item => item && item.time && item.value !== undefined && !isNaN(item.value));
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
        upColor: '#00ff66', downColor: '#ff2a2a', borderVisible: false, wickUpColor: '#00ff66', wickDownColor: '#ff2a2a'
    });
    candlestickSeries.applyOptions({
        priceFormat: { type: 'price', precision: currentAsset === 'XRP' ? 4 : 2, minMove: currentAsset === 'XRP' ? 0.0001 : 0.01 }
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
    // ENHANCEMENT: Lock scale padding to leave room above/below the RSI boundary limits
    rsiChart.priceScale('right').applyOptions({
        scaleMargins: { top: 0.18, bottom: 0.18 }
    });
    
    rsiSeries = rsiChart.addLineSeries({ color: '#9d4edd', lineWidth: 1.5, title: 'RSI (14)' });
    rsiTopLine = rsiChart.addLineSeries({ color: '#3a0ca3', lineWidth: 1, lineStyle: 2, title: '' });
    rsiBottomLine = rsiChart.addLineSeries({ color: '#3a0ca3', lineWidth: 1, lineStyle: 2, title: '' });

    // 3. Build MACD Sub-Window
    macdChart = createChart(macdDiv, { 
        ...commonOptions, 
        width: macdDiv.clientWidth, 
        height: macdDiv.clientHeight,
        timeScale: { ...commonOptions.timeScale, visible: true } 
    });
    
    macdChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.15, bottom: 0.15 } });
    // ENHANCEMENT: Keep historical histogram bars centered and away from top/bottom clipping
    macdChart.priceScale('right').applyOptions({
        scaleMargins: { top: 0.15, bottom: 0.15 }
    });
    
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
    syncTimelines(rsiChart, [mainChart, macdChart]);
    syncTimelines(macdChart, [mainChart, rsiChart]);
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

function generateHistoricalBars(timeframe, asset, startingPrice) {
    let basePrice = typeof startingPrice === 'number' ? startingPrice : parseFloat(startingPrice);
    if (isNaN(basePrice)) basePrice = getAssetFallbackPrice(asset);

    let now = Math.floor(Date.now() / 1000);
    let interval = timeframe === '5m' ? 300 : timeframe === '1h' ? 3600 : timeframe === '1d' ? 86400 : 60;
    let volatilityFactor = basePrice * 0.0015; 
    let tempBars = [];

    for (let i = 0; i < 250; i++) {
        let drift = (Math.random() * volatilityFactor * 2) - volatilityFactor;
        let open = basePrice;
        let close = basePrice + drift;
        let high = Math.max(open, close) + (Math.random() * volatilityFactor * 0.2);
        let low = Math.min(open, close) - (Math.random() * volatilityFactor * 0.2);
        let barTime = Math.floor((now - (i * interval)) / interval) * interval;
        
        tempBars.push({
            time: barTime,
            open: parseFloat(open.toFixed(4)), high: parseFloat(high.toFixed(4)),
            low: parseFloat(low.toFixed(4)), close: parseFloat(close.toFixed(4)),
            volume: Math.floor(Math.random() * 500) + 100
        });
        basePrice = close; 
    }
    return tempBars.reverse();
}

async function loadChartWorkspace() {
    try {
        initChartInstances();

        let realAnchorPrice = null;
        try {
            const response = await fetch("http://192.168.0.66:8000/api/prices");
            const priceMatrix = await response.json();
            realAnchorPrice = extractPriceFromFeed(priceMatrix, currentAsset);
        } catch (e) {
            console.warn("Local backend connection skipped. Processing static feeds.");
        }
        
        if (!realAnchorPrice) realAnchorPrice = getAssetFallbackPrice(currentAsset);

        currentHistoricalBars = generateHistoricalBars(currentTimeframe, currentAsset, realAnchorPrice);
        
        refreshChartOverlays();
        updateRowLayouts(); // Synchronize view states on canvas loads
        
        mainChart.priceScale('right').applyOptions({ autoScale: true });
        mainChart.timeScale().fitContent();
        
        initPriceLoop(); 

    } catch (err) {
        console.error("Critical sandbox crash caught:", err);
    }
}

function refreshChartOverlays() {
    if (!candlestickSeries) return;
    candlestickSeries.setData(currentHistoricalBars);

    ema9Series.setData(document.getElementById('toggle-ema9')?.checked ? calculateEMA(currentHistoricalBars, 9) : []);
    ema21Series.setData(document.getElementById('toggle-ema21')?.checked ? calculateEMA(currentHistoricalBars, 21) : []);
    ema100Series.setData(document.getElementById('toggle-ema100')?.checked ? calculateEMA(currentHistoricalBars, 100) : []);
    ema200Series.setData(document.getElementById('toggle-ema200')?.checked ? calculateEMA(currentHistoricalBars, 200) : []);
    vwapSeries.setData(document.getElementById('toggle-vwap')?.checked ? calculateVWAP(currentHistoricalBars) : []);

    if (document.getElementById('toggle-volume')?.checked) {
        volumeSeries.setData(currentHistoricalBars.map(b => ({
            time: b.time, value: b.volume, color: b.close >= b.open ? '#00ff6622' : '#ff2a2a22'
        })));
    } else {
        volumeSeries.setData([]);
    }

    // FIX: Match array mapping directly against historical indexes from trailing end to lock leftward shifting
    if (document.getElementById('toggle-rsi')?.checked && currentHistoricalBars.length > 14) {
        const closePrices = currentHistoricalBars.map(b => b.close);
        const rsiValues = RSI.calculate({ values: closePrices, period: 14 });
        
        const rsiMapped = [];
        const offset = currentHistoricalBars.length - rsiValues.length;
        for (let i = 0; i < rsiValues.length; i++) {
            rsiMapped.push({ time: currentHistoricalBars[offset + i].time, value: rsiValues[i] });
        }

        rsiSeries.setData(cleanArray(rsiMapped));
        rsiTopLine.setData(currentHistoricalBars.map(b => ({ time: b.time, value: 70 })));
        rsiBottomLine.setData(currentHistoricalBars.map(b => ({ time: b.time, value: 30 })));
    } else {
        rsiSeries.setData([]); rsiTopLine.setData([]); rsiBottomLine.setData([]);
    }

    // FIX: Match array mapping directly against historical indexes from trailing end to lock leftward shifting
    if (document.getElementById('toggle-macd')?.checked && currentHistoricalBars.length > 26) {
        const closePrices = currentHistoricalBars.map(b => b.close);
        const macdValues = MACD.calculate({ values: closePrices, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });

        const macdLineData = []; const macdSignalData = []; const macdHistData = [];
        const offset = currentHistoricalBars.length - macdValues.length;

        macdValues.forEach((res, idx) => {
            const time = currentHistoricalBars[offset + idx].time;
            if (res.macd !== undefined) macdLineData.push({ time, value: res.macd });
            if (res.signal !== undefined) macdSignalData.push({ time, value: res.signal });
            if (res.histogram !== undefined) {
                macdHistData.push({ time, value: res.histogram, color: res.histogram >= 0 ? '#00ff66cc' : '#ff2a2acc' });
            }
        });

        macdLineSeries.setData(cleanArray(macdLineData));
        macdSignalSeries.setData(cleanArray(macdSignalData));
        macdHistogramSeries.setData(cleanArray(macdHistData));
    } else {
        macdLineSeries.setData([]); macdSignalSeries.setData([]); macdHistogramSeries.setData([]);
    }
}

function initPriceLoop() {
    if (updateInterval) clearInterval(updateInterval);

    updateInterval = setInterval(async () => {
        try {
            let livePrice = null;
            try {
                const response = await fetch("http://192.168.0.66:8000/api/prices");
                const priceMatrix = await response.json();
                livePrice = extractPriceFromFeed(priceMatrix, currentAsset);
            } catch (e) {
                let lastClose = currentHistoricalBars[currentHistoricalBars.length - 1]?.close || getAssetFallbackPrice(currentAsset);
                livePrice = lastClose + ((Math.random() - 0.5) * (lastClose * 0.001));
            }

            if (!livePrice || isNaN(livePrice)) return;

            let interval = currentTimeframe === '5m' ? 300 : currentTimeframe === '1h' ? 3600 : timeframe === '1d' ? 86400 : 60;
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

            if (document.getElementById('toggle-volume')?.checked) {
                volumeSeries.update({ time: updatedLastBar.time, value: updatedLastBar.volume, color: updatedLastBar.close >= updatedLastBar.open ? '#00ff6622' : '#ff2a2a22' });
            }

            if (document.getElementById('toggle-ema9')?.checked) ema9Series.update(calculateEMA(currentHistoricalBars, 9).pop());
            if (document.getElementById('toggle-ema21')?.checked) ema21Series.update(calculateEMA(currentHistoricalBars, 21).pop());
            if (document.getElementById('toggle-ema100')?.checked) ema100Series.update(calculateEMA(currentHistoricalBars, 100).pop());
            if (document.getElementById('toggle-ema200')?.checked) ema200Series.update(calculateEMA(currentHistoricalBars, 200).pop());
            if (document.getElementById('toggle-vwap')?.checked) vwapSeries.update(calculateVWAP(currentHistoricalBars).pop());

            if (document.getElementById('toggle-rsi')?.checked && currentHistoricalBars.length > 14) {
                const closePrices = currentHistoricalBars.map(b => b.close);
                const rsiValues = RSI.calculate({ values: closePrices, period: 14 });
                if (rsiValues.length > 0) {
                    rsiSeries.update({ time: updatedLastBar.time, value: rsiValues[rsiValues.length - 1] });
                    rsiTopLine.update({ time: updatedLastBar.time, value: 70 });
                    rsiBottomLine.update({ time: updatedLastBar.time, value: 30 });
                }
            }
            
            if (document.getElementById('toggle-macd')?.checked && currentHistoricalBars.length > 26) {
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
    const rsiChecked = document.getElementById('toggle-rsi')?.checked;
    const macdChecked = document.getElementById('toggle-macd')?.checked;

    const mainDiv = document.getElementById('main-container');
    const rsiDiv = document.getElementById('rsi-container');
    const macdDiv = document.getElementById('macd-container');
    
    const rsiSplitter = document.getElementById('rsi-splitter');
    const macdSplitter = document.getElementById('macd-splitter');

    // Toggle container display configurations
    rsiDiv.style.display = rsiChecked ? 'block' : 'none';
    rsiSplitter.style.display = rsiChecked ? 'block' : 'none';
    
    macdDiv.style.display = macdChecked ? 'block' : 'none';
    macdSplitter.style.display = macdChecked ? 'block' : 'none';

    // Distribute responsive layout weights cleanly matching selected configurations
    if (rsiChecked && macdChecked) {
        mainDiv.style.flexGrow = "60"; rsiDiv.style.flexGrow = "20"; macdDiv.style.flexGrow = "20";
        mainChart.applyOptions({ timeScale: { visible: false } });
        rsiChart.applyOptions({ timeScale: { visible: false } });
        macdChart.applyOptions({ timeScale: { visible: true } });
    } else if (rsiChecked || macdChecked) {
        mainDiv.style.flexGrow = "75";
        if (rsiChecked) {
            rsiDiv.style.flexGrow = "25"; rsiChart.applyOptions({ timeScale: { visible: true } });
        } else {
            macdDiv.style.flexGrow = "25"; macdChart.applyOptions({ timeScale: { visible: true } });
        }
        mainChart.applyOptions({ timeScale: { visible: false } });
    } else {
        mainDiv.style.flexGrow = "100";
        mainChart.applyOptions({ timeScale: { visible: true } });
    }

    triggerChartResize();
}

function triggerChartResize() {
    const mainDiv = document.getElementById('main-container');
    const rsiDiv = document.getElementById('rsi-container');
    const macdDiv = document.getElementById('macd-container');

    if (mainChart && mainDiv) mainChart.resize(mainDiv.clientWidth, mainDiv.clientHeight);
    if (rsiChart && rsiDiv) rsiChart.resize(rsiDiv.clientWidth, rsiDiv.clientHeight);
    if (macdChart && macdDiv) macdChart.resize(macdDiv.clientWidth, macdDiv.clientHeight);
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


document.querySelectorAll('.asset-btn').forEach(button => {
    button.addEventListener('click', (e) => {
        document.querySelectorAll('.asset-btn').forEach(btn => btn.classList.remove('active'));
        e.currentTarget.classList.add('active');
        currentAsset = e.currentTarget.getAttribute('data-asset');
        loadChartWorkspace();
    });
});

document.querySelectorAll('.tf-btn').forEach(button => {
    button.addEventListener('click', (e) => {
        document.querySelectorAll('.tf-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        currentTimeframe = e.target.getAttribute('data-tf');
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
    });
});

loadChartWorkspace();

window.addEventListener('resize', () => triggerChartResize());
