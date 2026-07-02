/* ═══════════════════════════════════════════════════════════════
   FreshSense Pro — Application Logic
   Simulated ESP32 data · Chart.js analytics · Live UI updates
   Structured for easy WebSocket / REST API integration
   ═══════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ─── CONFIGURATION ──────────────────────────────────────────
    const CONFIG = {
        // ╔═══════════════════════════════════════════════════════╗
        // ║  ESP32 CONNECTION SETTINGS                           ║
        // ║  Set these to your ESP32's IP address when ready     ║
        // ╚═══════════════════════════════════════════════════════╝
        ESP32_API_URL: null,        // e.g. 'http://192.168.1.100/api'
        ESP32_WS_URL: null,         // e.g. 'ws://192.168.1.100/ws'
        UPDATE_INTERVAL: 3000,      // ms between data updates
        CHART_MAX_POINTS: 24,       // data points shown on chart
        LOG_MAX_ENTRIES: 20,
        RECONNECT_DELAY: 5000,      // ms before WebSocket reconnect attempt
    };

    // ─── CONNECTION STATE ───────────────────────────────────────
    // 'disconnected' | 'connecting' | 'connected' | 'demo'
    let connectionMode = 'disconnected';
    let simulationTimer = null;
    let wsConnection = null;
    let restPollTimer = null;

    // ─── SENSOR STATE ───────────────────────────────────────────
    const state = {
        temperature: null,
        humidity: null,
        gasLevel: null,
        boxOpen: null,
        fanOn: false,
        ledOn: false,
        buzzerOn: false,
        freshness: 0,
        wifiConnected: false,
        overallStatus: 'disconnected', // disconnected | fresh | warning | spoiled
        history: {
            labels: [],
            temperature: [],
            humidity: [],
            gas: [],
        },
        logs: [],
    };

    // ─── DOM REFERENCES ─────────────────────────────────────────
    const dom = {
        tempValue:        document.getElementById('temp-value'),
        tempBadge:        document.getElementById('temp-badge'),
        humidityValue:    document.getElementById('humidity-value'),
        humidityBadge:    document.getElementById('humidity-badge'),
        gasValue:         document.getElementById('gas-value'),
        gasBadge:         document.getElementById('gas-badge'),
        boxValue:         document.getElementById('box-value'),
        boxBadge:         document.getElementById('box-badge'),
        freshnessFill:    document.getElementById('freshness-fill'),
        freshnessPercent: document.getElementById('freshness-percent'),
        fanStatusText:    document.getElementById('fan-status-text'),
        ledStatusText:    document.getElementById('led-status-text'),
        buzzerStatusText: document.getElementById('buzzer-status-text'),
        toggleFan:        document.getElementById('toggle-fan'),
        toggleLed:        document.getElementById('toggle-led'),
        toggleBuzzer:     document.getElementById('toggle-buzzer'),
        controlFan:       document.getElementById('control-fan'),
        controlLed:       document.getElementById('control-led'),
        controlBuzzer:    document.getElementById('control-buzzer'),
        logFeed:          document.getElementById('log-feed'),
        systemChip:       document.getElementById('system-status-chip'),
        chipText:         null,
        heroTitle:        document.getElementById('hero-title'),
        heroSubtitle:     document.getElementById('hero-subtitle'),
        heroStatusValue:  document.getElementById('hero-status-value'),
        heroStatusIcon:   document.getElementById('hero-status-icon'),
        heroStatusCard:   document.getElementById('hero-status-card'),
        wifiStatus:       document.getElementById('wifi-status'),
        trendsChart:      document.getElementById('trends-chart'),
        chartTabLive:     document.getElementById('chart-tab-live'),
        chartTabHistory:  document.getElementById('chart-tab-history'),
        connectOverlay:   document.getElementById('connect-overlay'),
        btnConnectEsp:    document.getElementById('btn-connect-esp'),
        btnStartDemo:     document.getElementById('btn-start-demo'),
        btnDisconnect:    document.getElementById('btn-disconnect'),
        espIpInput:       document.getElementById('esp-ip-input'),
        connectionMethod: document.getElementById('connection-method'),
        connectError:     document.getElementById('connect-error'),
        cardTemperature:  document.getElementById('card-temperature'),
        cardHumidity:     document.getElementById('card-humidity'),
        cardGas:          document.getElementById('card-gas'),
        cardBox:          document.getElementById('card-box'),
    };

    dom.chipText = dom.systemChip.querySelector('.status-chip__text');

    // ─── CHART INITIALIZATION ───────────────────────────────────
    let trendChart = null;

    function initChart() {
        const ctx = dom.trendsChart.getContext('2d');

        trendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Temperature (°C)',
                        data: [],
                        borderColor: '#0058bc',
                        backgroundColor: 'rgba(0, 88, 188, 0.08)',
                        borderWidth: 2.5,
                        tension: 0.4,
                        fill: true,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        pointHoverBackgroundColor: '#0058bc',
                        pointHoverBorderColor: '#fff',
                        pointHoverBorderWidth: 2,
                    },
                    {
                        label: 'Humidity (%)',
                        data: [],
                        borderColor: '#a1befd',
                        backgroundColor: 'rgba(161, 190, 253, 0.06)',
                        borderWidth: 2,
                        borderDash: [6, 4],
                        tension: 0.4,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        pointHoverBackgroundColor: '#a1befd',
                    },
                    {
                        label: 'Gas (ppm)',
                        data: [],
                        borderColor: '#ffb595',
                        backgroundColor: 'rgba(255, 181, 149, 0.06)',
                        borderWidth: 2,
                        tension: 0.4,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        pointHoverBackgroundColor: '#ffb595',
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            font: { family: 'Inter', size: 11, weight: '600' },
                            color: '#414755',
                            padding: 20,
                            usePointStyle: true,
                            pointStyleWidth: 8,
                        },
                    },
                    tooltip: {
                        backgroundColor: 'rgba(255,255,255,0.95)',
                        titleColor: '#1a1c1d',
                        bodyColor: '#414755',
                        borderColor: 'rgba(193,198,215,0.3)',
                        borderWidth: 1,
                        titleFont: { family: 'Inter', size: 12, weight: '700' },
                        bodyFont: { family: 'Inter', size: 11 },
                        padding: 14,
                        cornerRadius: 12,
                        displayColors: true,
                        boxPadding: 6,
                    },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            font: { family: 'Inter', size: 10, weight: '700' },
                            color: '#c1c6d7',
                            maxRotation: 0,
                            maxTicksLimit: 6,
                        },
                        border: { display: false },
                    },
                    y: {
                        grid: {
                            color: 'rgba(193, 198, 215, 0.10)',
                            drawBorder: false,
                        },
                        ticks: {
                            font: { family: 'Inter', size: 10, weight: '600' },
                            color: '#c1c6d7',
                            padding: 8,
                        },
                        border: { display: false },
                    },
                },
            },
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // CONNECTION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════

    /**
     * Show the disconnected (idle) state on all UI elements
     */
    function showDisconnectedUI() {
        connectionMode = 'disconnected';
        state.wifiConnected = false;
        state.overallStatus = 'disconnected';

        // Show overlay
        dom.connectOverlay.classList.remove('hidden');
        dom.btnDisconnect.classList.add('hidden');
        dom.connectError.classList.add('hidden');

        // Metric cards → show dashes
        dom.tempValue.innerHTML = '—<span class="metric-card__unit">°C</span>';
        dom.humidityValue.innerHTML = '—<span class="metric-card__unit">%</span>';
        dom.gasValue.innerHTML = '— <span class="metric-card__unit">ppm</span>';
        dom.boxValue.textContent = '—';

        // Badges → offline
        dom.tempBadge.textContent = 'Offline';
        dom.tempBadge.style.color = '#ba1a1a';
        dom.humidityBadge.textContent = 'Offline';
        dom.humidityBadge.style.color = '#ba1a1a';
        dom.gasBadge.textContent = 'Offline';
        dom.gasBadge.style.color = '#ba1a1a';
        dom.gasBadge.className = 'metric-card__badge';
        dom.boxBadge.textContent = 'Offline';
        dom.boxBadge.style.background = 'rgba(255, 218, 214, 0.5)';
        dom.boxBadge.style.color = '#93000a';

        // Add dimmed class to metric cards
        dom.cardTemperature.classList.add('metric-card--offline');
        dom.cardHumidity.classList.add('metric-card--offline');
        dom.cardGas.classList.add('metric-card--offline');
        dom.cardBox.classList.add('metric-card--offline');

        // Freshness → empty
        dom.freshnessFill.style.width = '0%';
        dom.freshnessPercent.textContent = 'No Data';
        dom.freshnessPercent.style.color = 'var(--on-surface-variant)';

        // Controls → disabled
        dom.fanStatusText.textContent = 'Offline';
        dom.fanStatusText.className = 'control-item__status';
        dom.ledStatusText.textContent = 'Offline';
        dom.ledStatusText.className = 'control-item__status';
        dom.buzzerStatusText.textContent = 'Offline';
        dom.buzzerStatusText.className = 'control-item__status';
        dom.controlFan.classList.add('control-item--muted');
        dom.controlLed.classList.add('control-item--muted');
        dom.controlBuzzer.classList.add('control-item--muted');
        setTogglesDisabled(true);

        // System chip → disconnected
        dom.systemChip.className = 'status-chip status-chip--disconnected';
        dom.chipText.textContent = 'Not Connected';

        // Hero → disconnected
        dom.heroSubtitle.textContent = 'No device connected. Connect your ESP32 or start demo mode.';
        dom.heroStatusValue.textContent = 'Offline';
        dom.heroStatusValue.style.color = 'var(--on-surface-variant)';
        dom.heroStatusIcon.style.background = 'var(--surface-container-low)';
        dom.heroStatusIcon.style.color = 'var(--on-surface-variant)';
        dom.heroStatusIcon.querySelector('.material-symbols-outlined').textContent = 'link_off';

        // Wi-Fi → disconnected
        updateWifiStatus();

        // Logs → initial message
        state.logs = [
            { text: 'Awaiting device connection...', type: 'info', time: 'Now' },
        ];
        renderLogs();

        // Clear chart data
        state.history = { labels: [], temperature: [], humidity: [], gas: [] };
        if (trendChart) {
            trendChart.data.labels = [];
            trendChart.data.datasets.forEach(ds => { ds.data = []; });
            trendChart.update('none');
        }
    }

    /**
     * Transition UI to connected / live state
     */
    function showConnectedUI(mode) {
        connectionMode = mode;
        state.wifiConnected = true;

        // Hide overlay, show disconnect button
        dom.connectOverlay.classList.add('hidden');
        dom.btnDisconnect.classList.remove('hidden');
        dom.connectError.classList.add('hidden');

        // Remove offline dimming from metric cards
        dom.cardTemperature.classList.remove('metric-card--offline');
        dom.cardHumidity.classList.remove('metric-card--offline');
        dom.cardGas.classList.remove('metric-card--offline');
        dom.cardBox.classList.remove('metric-card--offline');

        // Enable toggles
        setTogglesDisabled(false);

        // Reset badge colors
        dom.tempBadge.style.color = '';
        dom.humidityBadge.style.color = '';
        dom.gasBadge.style.color = '';

        updateWifiStatus();
        addLog(mode === 'demo' ? 'Demo simulation started' : 'Connected to ESP32', 'success');
    }

    function setTogglesDisabled(disabled) {
        dom.toggleFan.querySelector('input').disabled = disabled;
        dom.toggleLed.querySelector('input').disabled = disabled;
        dom.toggleBuzzer.querySelector('input').disabled = disabled;
        if (disabled) {
            dom.toggleFan.classList.add('apple-toggle--disabled');
            dom.toggleLed.classList.add('apple-toggle--disabled');
            dom.toggleBuzzer.classList.add('apple-toggle--disabled');
        } else {
            dom.toggleFan.classList.remove('apple-toggle--disabled');
            dom.toggleLed.classList.remove('apple-toggle--disabled');
            dom.toggleBuzzer.classList.remove('apple-toggle--disabled');
        }
    }

    /**
     * Disconnect from everything and return to idle
     */
    function disconnect() {
        // Stop simulation
        if (simulationTimer) { clearInterval(simulationTimer); simulationTimer = null; }
        if (restPollTimer) { clearInterval(restPollTimer); restPollTimer = null; }
        if (wsConnection) { wsConnection.close(); wsConnection = null; }

        // Reset state
        state.temperature = null;
        state.humidity = null;
        state.gasLevel = null;
        state.boxOpen = null;
        state.fanOn = false;
        state.ledOn = false;
        state.buzzerOn = false;
        state.freshness = 0;

        // Clear sparklines
        if (sparkTemp) sparkTemp.data = [];
        if (sparkHumidity) sparkHumidity.data = [];
        if (sparkGas) sparkGas.data = [];

        showDisconnectedUI();
        addLog('Device disconnected', 'warning');
    }

    // ═══════════════════════════════════════════════════════════════
    // DEMO / SIMULATION MODE
    // ═══════════════════════════════════════════════════════════════

    function startDemoMode() {
        // Set initial simulated values
        state.temperature = 22.4;
        state.humidity = 45.2;
        state.gasLevel = 112;
        state.boxOpen = false;
        state.fanOn = true;
        state.ledOn = true;
        state.buzzerOn = false;
        state.freshness = 88;

        showConnectedUI('demo');

        // Fill initial chart history
        const now = new Date();
        for (let i = CONFIG.CHART_MAX_POINTS - 1; i >= 0; i--) {
            const t = new Date(now - i * 3600000);
            state.history.labels.push(formatTime(t));
            state.history.temperature.push(randomInRange(20, 26));
            state.history.humidity.push(randomInRange(40, 55));
            state.history.gas.push(randomInRange(80, 180));
        }
        refreshChartFromState();

        // Fill initial sparklines
        for (let i = 0; i < 20; i++) {
            updateSparkline(sparkTemp, randomInRange(20, 26), 15, 35);
            updateSparkline(sparkHumidity, randomInRange(40, 55), 25, 80);
            updateSparkline(sparkGas, randomInRange(80, 180), 40, 420);
        }

        // Initial UI update
        updateUI();

        // Start periodic simulation
        simulationTimer = setInterval(() => {
            simulateData();
            updateSparkline(sparkTemp, state.temperature, 15, 35);
            updateSparkline(sparkHumidity, state.humidity, 25, 80);
            updateSparkline(sparkGas, state.gasLevel, 40, 420);
        }, CONFIG.UPDATE_INTERVAL);
    }

    function simulateData() {
        // Drift values realistically
        state.temperature = clamp(state.temperature + randomDrift(0.3), 18, 32);
        state.humidity    = clamp(state.humidity + randomDrift(0.8), 30, 75);
        state.gasLevel    = clamp(Math.round(state.gasLevel + randomDrift(5)), 50, 400);

        // Occasionally toggle box
        if (Math.random() < 0.05) {
            state.boxOpen = !state.boxOpen;
            addLog(
                state.boxOpen ? 'Storage chamber opened' : 'Storage chamber sealed',
                state.boxOpen ? 'warning' : 'info'
            );
        }

        // Calculate freshness
        const tempPenalty = Math.max(0, (state.temperature - 25) * 4);
        const humPenalty  = Math.max(0, (state.humidity - 55) * 2);
        const gasPenalty  = Math.max(0, (state.gasLevel - 150) * 0.2);
        state.freshness = clamp(Math.round(100 - tempPenalty - humPenalty - gasPenalty), 0, 100);

        // Determine overall status
        if (state.freshness >= 60) {
            state.overallStatus = 'fresh';
        } else if (state.freshness >= 30) {
            state.overallStatus = 'warning';
        } else {
            state.overallStatus = 'spoiled';
        }

        // Generate alerts based on thresholds
        if (state.temperature > 28 && Math.random() < 0.3) {
            addLog('Temperature exceeding safe threshold', 'error');
        }
        if (state.humidity > 60 && Math.random() < 0.3) {
            addLog('Humidity rising above threshold', 'warning');
        }
        if (state.gasLevel > 200 && Math.random() < 0.3) {
            addLog('Spoilage risk detected — elevated gas', 'error');
        }
        if (state.freshness >= 80 && Math.random() < 0.08) {
            addLog('System returned to safe state', 'success');
        }

        // Push to chart & refresh UI
        updateChartData();
        updateUI();
    }

    // ═══════════════════════════════════════════════════════════════
    // ESP32 REAL CONNECTION — REST API
    // ═══════════════════════════════════════════════════════════════

    async function connectViaREST(ip) {
        const baseUrl = `http://${ip}`;
        CONFIG.ESP32_API_URL = baseUrl;

        connectionMode = 'connecting';
        dom.connectError.classList.add('hidden');

        try {
            // Test connection
            const res = await fetch(baseUrl + '/sensors', { signal: AbortSignal.timeout(5000) });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();

            // Connection successful — apply initial data
            applyESP32Data(data);
            showConnectedUI('rest');

            // Start polling
            restPollTimer = setInterval(async () => {
                try {
                    const r = await fetch(baseUrl + '/sensors', { signal: AbortSignal.timeout(5000) });
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    const d = await r.json();
                    applyESP32Data(d);
                    updateChartData();
                    updateUI();
                    updateSparkline(sparkTemp, state.temperature, 15, 35);
                    updateSparkline(sparkHumidity, state.humidity, 25, 80);
                    updateSparkline(sparkGas, state.gasLevel, 40, 420);
                } catch (err) {
                    console.error('ESP32 poll error:', err);
                    addLog('Connection interrupted — retrying...', 'error');
                }
            }, CONFIG.UPDATE_INTERVAL);

        } catch (err) {
            console.error('ESP32 connection error:', err);
            dom.connectError.textContent = 'Could not reach ESP32 at ' + ip + '. Check IP and network.';
            dom.connectError.classList.remove('hidden');
            connectionMode = 'disconnected';
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // ESP32 REAL CONNECTION — WebSocket
    // ═══════════════════════════════════════════════════════════════

    function connectViaWebSocket(ip) {
        const wsUrl = `ws://${ip}/ws`;
        CONFIG.ESP32_WS_URL = wsUrl;

        connectionMode = 'connecting';
        dom.connectError.classList.add('hidden');

        try {
            wsConnection = new WebSocket(wsUrl);

            wsConnection.onopen = () => {
                showConnectedUI('websocket');
            };

            wsConnection.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    applyESP32Data(data);
                    updateChartData();
                    updateUI();
                    updateSparkline(sparkTemp, state.temperature, 15, 35);
                    updateSparkline(sparkHumidity, state.humidity, 25, 80);
                    updateSparkline(sparkGas, state.gasLevel, 40, 420);
                } catch (e) {
                    console.error('WebSocket parse error:', e);
                }
            };

            wsConnection.onerror = () => {
                dom.connectError.textContent = 'WebSocket error. Check ESP32 IP and ensure WebSocket server is running.';
                dom.connectError.classList.remove('hidden');
            };

            wsConnection.onclose = () => {
                if (connectionMode === 'websocket') {
                    addLog('WebSocket connection lost. Reconnecting...', 'error');
                    state.wifiConnected = false;
                    updateWifiStatus();
                    setTimeout(() => {
                        if (connectionMode === 'websocket') {
                            connectViaWebSocket(ip);
                        }
                    }, CONFIG.RECONNECT_DELAY);
                }
            };

        } catch (err) {
            console.error('WebSocket connection error:', err);
            dom.connectError.textContent = 'Failed to create WebSocket connection.';
            dom.connectError.classList.remove('hidden');
            connectionMode = 'disconnected';
        }
    }

    /**
     * Apply data from ESP32 to state.
     * Adjust the property names below to match your ESP32 JSON response.
     */
    function applyESP32Data(data) {
        // Map your ESP32 JSON fields here:
        if (data.temperature !== undefined) state.temperature = data.temperature;
        if (data.humidity !== undefined)    state.humidity = data.humidity;
        if (data.gasLevel !== undefined)    state.gasLevel = data.gasLevel;
        if (data.gas !== undefined)         state.gasLevel = data.gas;       // alternate key
        if (data.boxOpen !== undefined)     state.boxOpen = data.boxOpen;
        if (data.doorOpen !== undefined)    state.boxOpen = data.doorOpen;   // alternate key
        if (data.fanOn !== undefined)       state.fanOn = data.fanOn;
        if (data.fan !== undefined)         state.fanOn = data.fan;
        if (data.ledOn !== undefined)       state.ledOn = data.ledOn;
        if (data.led !== undefined)         state.ledOn = data.led;
        if (data.buzzerOn !== undefined)    state.buzzerOn = data.buzzerOn;
        if (data.buzzer !== undefined)      state.buzzerOn = data.buzzer;
        if (data.freshness !== undefined)   state.freshness = data.freshness;

        // Calculate freshness if not provided
        if (data.freshness === undefined && state.temperature !== null) {
            const tempPenalty = Math.max(0, (state.temperature - 25) * 4);
            const humPenalty  = Math.max(0, (state.humidity - 55) * 2);
            const gasPenalty  = Math.max(0, (state.gasLevel - 150) * 0.2);
            state.freshness = clamp(Math.round(100 - tempPenalty - humPenalty - gasPenalty), 0, 100);
        }

        // Determine overall status
        if (state.freshness >= 60) {
            state.overallStatus = 'fresh';
        } else if (state.freshness >= 30) {
            state.overallStatus = 'warning';
        } else {
            state.overallStatus = 'spoiled';
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // UI UPDATE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    function updateUI() {
        if (connectionMode === 'disconnected') return;
        updateMetricCards();
        updateFreshnessMeter();
        updateControls();
        updateSystemStatus();
        updateWifiStatus();
        updateHeroSection();
    }

    function updateMetricCards() {
        // Temperature
        animateValue(dom.tempValue, `${state.temperature.toFixed(1)}<span class="metric-card__unit">°C</span>`);
        updateBadgeState(dom.tempBadge, state.temperature, 18, 28, 'Normal', 'Active Now', 'Critical');

        // Humidity
        animateValue(dom.humidityValue, `${state.humidity.toFixed(1)}<span class="metric-card__unit">%</span>`);
        updateBadgeState(dom.humidityBadge, state.humidity, 30, 60, 'Low', 'Optimal Range', 'High');

        // Gas
        animateValue(dom.gasValue, `${state.gasLevel} <span class="metric-card__unit">ppm</span>`);
        if (state.gasLevel < 150) {
            dom.gasBadge.textContent = 'Low Volatiles';
            dom.gasBadge.className = 'metric-card__badge metric-card__badge--warn';
            dom.gasBadge.style.color = '';
        } else if (state.gasLevel < 250) {
            dom.gasBadge.textContent = 'Moderate';
            dom.gasBadge.className = 'metric-card__badge';
            dom.gasBadge.style.color = '#e6a700';
        } else {
            dom.gasBadge.textContent = 'High Alert';
            dom.gasBadge.className = 'metric-card__badge';
            dom.gasBadge.style.color = '#ba1a1a';
        }

        // Box
        dom.boxValue.textContent = state.boxOpen ? 'Open' : 'Closed';
        dom.boxBadge.textContent = state.boxOpen ? 'Unsealed' : 'Secured';
        if (state.boxOpen) {
            dom.boxBadge.style.background = 'rgba(255, 218, 214, 0.5)';
            dom.boxBadge.style.color = '#93000a';
        } else {
            dom.boxBadge.style.background = 'rgba(161, 190, 253, 0.30)';
            dom.boxBadge.style.color = '#2d4c83';
        }
    }

    function updateBadgeState(badge, value, low, high, lowText, normalText, highText) {
        if (value < low) {
            badge.textContent = lowText;
            badge.style.color = '#e6a700';
        } else if (value > high) {
            badge.textContent = highText;
            badge.style.color = '#ba1a1a';
        } else {
            badge.textContent = normalText;
            badge.style.color = '';
        }
    }

    function animateValue(el, html) {
        el.innerHTML = html;
        el.classList.remove('value-updated');
        void el.offsetWidth; // trigger reflow
        el.classList.add('value-updated');
    }

    function updateFreshnessMeter() {
        dom.freshnessFill.style.width = state.freshness + '%';
        dom.freshnessPercent.textContent = state.freshness + '% Fresh';

        if (state.freshness >= 60) {
            dom.freshnessPercent.style.color = 'var(--primary)';
        } else if (state.freshness >= 30) {
            dom.freshnessPercent.style.color = '#e6a700';
        } else {
            dom.freshnessPercent.style.color = 'var(--error)';
        }
    }

    function updateControls() {
        const fanInput = dom.toggleFan.querySelector('input');
        const ledInput = dom.toggleLed.querySelector('input');
        const buzzerInput = dom.toggleBuzzer.querySelector('input');

        fanInput.checked = state.fanOn;
        ledInput.checked = state.ledOn;
        buzzerInput.checked = state.buzzerOn;

        dom.fanStatusText.textContent = state.fanOn ? 'Running' : 'Stopped';
        dom.fanStatusText.className = 'control-item__status' + (state.fanOn ? ' control-item__status--active' : '');
        dom.controlFan.classList.toggle('control-item--muted', !state.fanOn);

        dom.ledStatusText.textContent = state.ledOn ? 'Auto Mode' : 'Off';
        dom.ledStatusText.className = 'control-item__status' + (state.ledOn ? ' control-item__status--active' : '');
        dom.controlLed.classList.toggle('control-item--muted', !state.ledOn);

        dom.buzzerStatusText.textContent = state.buzzerOn ? 'Active' : 'Muted';
        dom.buzzerStatusText.className = 'control-item__status' + (state.buzzerOn ? ' control-item__status--active' : '');
        dom.controlBuzzer.classList.toggle('control-item--muted', !state.buzzerOn);
    }

    function updateSystemStatus() {
        const chip = dom.systemChip;
        chip.className = 'status-chip';

        switch (state.overallStatus) {
            case 'fresh':
                chip.classList.add('status-chip--fresh');
                dom.chipText.textContent = 'System Optimal';
                break;
            case 'warning':
                chip.classList.add('status-chip--warning');
                dom.chipText.textContent = 'Caution Active';
                break;
            case 'spoiled':
                chip.classList.add('status-chip--spoiled');
                dom.chipText.textContent = 'Critical Alert';
                break;
            default:
                chip.classList.add('status-chip--disconnected');
                dom.chipText.textContent = 'Not Connected';
        }
    }

    function updateWifiStatus() {
        const icon = dom.wifiStatus;
        if (state.wifiConnected) {
            icon.title = 'Wi-Fi Connected';
            icon.querySelector('.material-symbols-outlined').textContent = 'wifi';
            icon.style.color = '#34c759';
        } else {
            icon.title = 'Wi-Fi Disconnected';
            icon.querySelector('.material-symbols-outlined').textContent = 'wifi_off';
            icon.style.color = '#ba1a1a';
        }
    }

    function updateHeroSection() {
        switch (state.overallStatus) {
            case 'fresh':
                dom.heroSubtitle.textContent = 'All Systems Clear. Optimal preservation detected.';
                dom.heroStatusValue.textContent = 'Fresh';
                dom.heroStatusValue.style.color = 'var(--primary)';
                dom.heroStatusIcon.style.background = 'var(--primary-10)';
                dom.heroStatusIcon.style.color = 'var(--primary)';
                dom.heroStatusIcon.querySelector('.material-symbols-outlined').textContent = 'eco';
                break;
            case 'warning':
                dom.heroSubtitle.textContent = 'Attention needed. Some parameters are outside optimal range.';
                dom.heroStatusValue.textContent = 'Warning';
                dom.heroStatusValue.style.color = '#e6a700';
                dom.heroStatusIcon.style.background = 'rgba(230, 167, 0, 0.10)';
                dom.heroStatusIcon.style.color = '#e6a700';
                dom.heroStatusIcon.querySelector('.material-symbols-outlined').textContent = 'warning';
                break;
            case 'spoiled':
                dom.heroSubtitle.textContent = 'Critical condition detected. Immediate action required.';
                dom.heroStatusValue.textContent = 'Spoiled';
                dom.heroStatusValue.style.color = 'var(--error)';
                dom.heroStatusIcon.style.background = 'rgba(186, 26, 26, 0.10)';
                dom.heroStatusIcon.style.color = 'var(--error)';
                dom.heroStatusIcon.querySelector('.material-symbols-outlined').textContent = 'error';
                break;
        }
    }

    // ─── CHART UPDATE ───────────────────────────────────────────
    function updateChartData() {
        const now = new Date();
        state.history.labels.push(formatTime(now));
        state.history.temperature.push(state.temperature);
        state.history.humidity.push(state.humidity);
        state.history.gas.push(state.gasLevel);

        if (state.history.labels.length > CONFIG.CHART_MAX_POINTS) {
            state.history.labels.shift();
            state.history.temperature.shift();
            state.history.humidity.shift();
            state.history.gas.shift();
        }

        refreshChartFromState();
    }

    function refreshChartFromState() {
        if (trendChart) {
            trendChart.data.labels = state.history.labels;
            trendChart.data.datasets[0].data = state.history.temperature;
            trendChart.data.datasets[1].data = state.history.humidity;
            trendChart.data.datasets[2].data = state.history.gas;
            trendChart.update('none');
        }
    }

    // ─── LOG SYSTEM ─────────────────────────────────────────────
    function addLog(text, type) {
        const entry = { text, type, time: 'Just now' };
        state.logs.unshift(entry);
        if (state.logs.length > CONFIG.LOG_MAX_ENTRIES) state.logs.pop();
        renderLogs();
    }

    function renderLogs() {
        dom.logFeed.innerHTML = '';
        state.logs.forEach((log, i) => {
            const el = document.createElement('div');
            el.className = 'log-entry';
            el.style.animationDelay = (i * 50) + 'ms';
            el.innerHTML = `
                <div class="log-entry__dot log-entry__dot--${log.type}"></div>
                <div>
                    <p class="log-entry__text">${log.text}</p>
                    <p class="log-entry__time">${log.time}</p>
                </div>
            `;
            dom.logFeed.appendChild(el);
        });
    }

    // ─── TOGGLE EVENT HANDLERS ──────────────────────────────────
    function setupToggles() {
        dom.toggleFan.querySelector('input').addEventListener('change', (e) => {
            if (connectionMode === 'disconnected') { e.target.checked = !e.target.checked; return; }
            state.fanOn = e.target.checked;
            addLog(state.fanOn ? 'Circulation fan activated' : 'Circulation fan deactivated', state.fanOn ? 'info' : 'warning');
            updateControls();
            if (CONFIG.ESP32_API_URL) {
                fetch(CONFIG.ESP32_API_URL + '/fan', { method: 'POST', body: JSON.stringify({ on: state.fanOn }) }).catch(() => {});
            }
        });

        dom.toggleLed.querySelector('input').addEventListener('change', (e) => {
            if (connectionMode === 'disconnected') { e.target.checked = !e.target.checked; return; }
            state.ledOn = e.target.checked;
            addLog(state.ledOn ? 'RGB LED set to auto mode' : 'RGB LED turned off', 'info');
            updateControls();
            if (CONFIG.ESP32_API_URL) {
                fetch(CONFIG.ESP32_API_URL + '/led', { method: 'POST', body: JSON.stringify({ on: state.ledOn }) }).catch(() => {});
            }
        });

        dom.toggleBuzzer.querySelector('input').addEventListener('change', (e) => {
            if (connectionMode === 'disconnected') { e.target.checked = !e.target.checked; return; }
            state.buzzerOn = e.target.checked;
            addLog(state.buzzerOn ? 'Alert buzzer enabled' : 'Alert buzzer muted', state.buzzerOn ? 'info' : 'warning');
            updateControls();
            if (CONFIG.ESP32_API_URL) {
                fetch(CONFIG.ESP32_API_URL + '/buzzer', { method: 'POST', body: JSON.stringify({ on: state.buzzerOn }) }).catch(() => {});
            }
        });
    }

    // ─── CHART TAB HANDLERS ─────────────────────────────────────
    function setupChartTabs() {
        dom.chartTabLive.addEventListener('click', () => {
            dom.chartTabLive.classList.add('chart-tab--active');
            dom.chartTabHistory.classList.remove('chart-tab--active');
        });
        dom.chartTabHistory.addEventListener('click', () => {
            dom.chartTabHistory.classList.add('chart-tab--active');
            dom.chartTabLive.classList.remove('chart-tab--active');
        });
    }

    // ─── NAV LINK HANDLERS ──────────────────────────────────────
    function setupNavLinks() {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('nav-link--active'));
                link.classList.add('nav-link--active');
            });
        });

        document.querySelectorAll('.bottom-nav__item').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.bottom-nav__item').forEach(i => i.classList.remove('bottom-nav__item--active'));
                item.classList.add('bottom-nav__item--active');
            });
        });
    }

    // ─── CONNECTION BUTTON HANDLERS ─────────────────────────────
    function setupConnectionButtons() {
        // Start Demo button
        dom.btnStartDemo.addEventListener('click', () => {
            startDemoMode();
        });

        // Connect to ESP32 button
        dom.btnConnectEsp.addEventListener('click', () => {
            const ip = dom.espIpInput.value.trim();
            if (!ip) {
                dom.connectError.textContent = 'Please enter the ESP32 IP address.';
                dom.connectError.classList.remove('hidden');
                return;
            }

            const method = dom.connectionMethod.value;
            if (method === 'rest') {
                connectViaREST(ip);
            } else {
                connectViaWebSocket(ip);
            }
        });

        // Disconnect button
        dom.btnDisconnect.addEventListener('click', () => {
            disconnect();
        });
    }

    // ─── UTILITY FUNCTIONS ──────────────────────────────────────
    function randomInRange(min, max) {
        return Math.round((Math.random() * (max - min) + min) * 10) / 10;
    }

    function randomDrift(magnitude) {
        return (Math.random() - 0.5) * 2 * magnitude;
    }

    function clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    function formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // ─── AGE LOG TIMESTAMPS ─────────────────────────────────────
    function ageLogTimestamps() {
        state.logs.forEach((log) => {
            if (log.time === 'Just now') {
                log.time = '1 min ago';
            } else if (log.time === 'Now') {
                // Don't age the initial "Awaiting" message
            } else {
                const match = log.time.match(/(\d+)\s*(min|hour|mins|hours)/);
                if (match) {
                    let val = parseInt(match[1]);
                    const unit = match[2];
                    if (unit.startsWith('min')) {
                        val += 1;
                        log.time = val >= 60 ? '1 hour ago' : val + ' mins ago';
                    } else {
                        val += 1;
                        log.time = val + ' hours ago';
                    }
                }
            }
        });
    }

    // ─── MINI SPARKLINES ────────────────────────────────────────
    function createSparkline(containerId, color) {
        const container = document.getElementById(containerId);
        if (!container) return null;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('viewBox', '0 0 200 40');
        svg.style.display = 'block';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '2');
        path.setAttribute('vector-effect', 'non-scaling-stroke');

        const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        area.setAttribute('fill', color);
        area.setAttribute('opacity', '0.15');

        svg.appendChild(area);
        svg.appendChild(path);
        container.appendChild(svg);

        return { svg, path, area, data: [] };
    }

    function updateSparkline(spark, value, min, max) {
        if (!spark) return;
        spark.data.push(value);
        if (spark.data.length > 30) spark.data.shift();

        const pts = spark.data.map((v, i) => {
            const x = (i / (spark.data.length - 1 || 1)) * 200;
            const y = 40 - ((v - min) / (max - min)) * 38;
            return { x, y };
        });

        if (pts.length < 2) return;

        let d = `M${pts[0].x},${pts[0].y}`;
        for (let i = 1; i < pts.length; i++) {
            const cp1x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * 0.4;
            const cp2x = pts[i].x - (pts[i].x - pts[i - 1].x) * 0.4;
            d += ` C${cp1x},${pts[i - 1].y} ${cp2x},${pts[i].y} ${pts[i].x},${pts[i].y}`;
        }
        spark.path.setAttribute('d', d);

        const areaD = d + ` L${pts[pts.length - 1].x},40 L${pts[0].x},40 Z`;
        spark.area.setAttribute('d', areaD);
    }

    // ─── INITIALIZE ─────────────────────────────────────────────
    let sparkTemp, sparkHumidity, sparkGas;

    function init() {
        initChart();
        setupToggles();
        setupChartTabs();
        setupNavLinks();
        setupConnectionButtons();

        // Create sparklines
        sparkTemp     = createSparkline('temp-sparkline', '#0058bc');
        sparkHumidity = createSparkline('humidity-sparkline', '#a1befd');
        sparkGas      = createSparkline('gas-sparkline', '#ffb595');

        // Age log timestamps periodically
        setInterval(ageLogTimestamps, 60000);

        // ★ START IN DISCONNECTED STATE ★
        showDisconnectedUI();
    }

    // Wait for DOM + Chart.js
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
