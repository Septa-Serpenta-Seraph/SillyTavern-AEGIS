(function() {
    const VALKYRIE_URL = 'http://127.0.0.1:5005/strike';
    var DEFAULT_SETTINGS = {
    bridgeUrl: 'http://127.0.0.1:5005',
    defaultTimeout: 30,
    extendedTimeout: 300,
    debounceThreshold: 3,
    enabled: true,
    useBase64: true
};
    console.log("%c[AEGIS]: V15 — EXTENDED TIMEOUT + DEBOUNCE + CODE-BLOCK EXCLUSION", "color: #a855f7; font-weight: bold;");

    let lastSeenMesId = -1;
    let settled = false;
    let dirty = true;
    let lastLogTime = 0;
    let armedAt = Date.now();
    let approvalPending = false;
    const firedStrikes = new Set();

    // --- DEBOUNCE STATE ---
    let pendingDaemonCmd = null;
    let pendingDaemonMesId = null;
    let pendingStableCount = 0;
    var STABLE_THRESHOLD = getSettings().debounceThreshold || 3;

    // --- INJECT STYLES ---
    const style = document.createElement('style');
    style.textContent = `
        .aegis-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.75);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: sans-serif;
        }
        .aegis-modal {
            background: #1a1a2e;
            border: 2px solid #a855f7;
            border-radius: 12px;
            padding: 24px 32px;
            max-width: 500px;
            width: 90%;
            color: #e0e0e0;
            box-shadow: 0 0 30px rgba(168, 85, 247, 0.4);
        }
        .aegis-modal h2 {
            color: #a855f7;
            margin: 0 0 8px 0;
            font-size: 18px;
        }
        .aegis-modal .aegis-label {
            color: #888;
            font-size: 13px;
            margin-bottom: 12px;
        }
        .aegis-modal .aegis-cmd {
            background: #0d0d1a;
            border: 1px solid #333;
            border-radius: 6px;
            padding: 12px;
            font-family: monospace;
            font-size: 15px;
            color: #f43f5e;
            margin-bottom: 20px;
            word-break: break-all;
        }
        .aegis-modal .aegis-buttons {
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            flex-wrap: wrap;
        }
        .aegis-modal button {
            padding: 10px 24px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            transition: opacity 0.2s;
        }
        .aegis-modal button:hover { opacity: 0.85; }
        .aegis-approve {
            background: #22c55e;
            color: #000;
        }
        .aegis-extended {
            background: #b8860b;
            color: #fff;
        }
        .aegis-deny {
            background: #f43f5e;
            color: #fff;
        }
    `;
    document.head.appendChild(style);

    // --- CUSTOM APPROVAL MODAL (with extended option) ---
    // Returns: 'approve', 'extended', or 'denied'
    function requestApproval(cmd) {
        return new Promise((resolve) => {
            if (approvalPending) {
                console.log("[AEGIS] Approval already pending, skipping: " + cmd);
                resolve('denied');
                return;
            }
            approvalPending = true;

            const overlay = document.createElement('div');
            overlay.className = 'aegis-overlay';
            overlay.innerHTML = `
                <div class="aegis-modal">
                    <h2>⚡ AEGIS APPROVAL REQUIRED</h2>
                    <div class="aegis-label">Narusya wants to execute:</div>
                    <div class="aegis-cmd">${cmd.replace(/</g, '<').replace(/>/g, '>')}</div>
                    <div class="aegis-buttons">
                        <button class="aegis-deny">✖ Deny</button>
                        <button class="aegis-extended">⏱️ Approve (5 min)</button>
                        <button class="aegis-approve">✔ Approve</button>
                    </div>
                </div>
            `;

            function cleanup(result) {
                overlay.remove();
                approvalPending = false;
                resolve(result);
            }

            overlay.querySelector('.aegis-approve').addEventListener('click', () => cleanup('approve'));
            overlay.querySelector('.aegis-extended').addEventListener('click', () => cleanup('extended'));
            overlay.querySelector('.aegis-deny').addEventListener('click', () => cleanup('denied'));
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) cleanup('denied');
            });

            function onKey(e) {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', onKey);
                    cleanup('denied');
                }
            }
            document.addEventListener('keydown', onKey);

            document.body.appendChild(overlay);
            console.log("[AEGIS] Approval modal shown for: " + cmd);

            setTimeout(() => {
                if (approvalPending) {
                    console.log("[AEGIS] Approval timed out (60s): " + cmd);
                    cleanup('denied');
                }
            }, 60000);
        });
    }

    // --- GET SILLYTAVERN CONTEXT ---
    function getSTContext() {
        try {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                return SillyTavern.getContext();
            }
        } catch(e) {}
        return null;
    }

    // --- SETTINGS MANAGEMENT ---
    function getSettings() {
        try {
            var raw = localStorage.getItem('aegis_settings');
            if (raw) return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
        } catch(e) {}
        return Object.assign({}, DEFAULT_SETTINGS);
    }

    function saveSettings(s) {
        localStorage.setItem('aegis_settings', JSON.stringify(s));
    }

    function syncUI() {
        var s = getSettings();
        var g = function(id) { return document.getElementById(id); };
        if (g('aegis_bridge_url')) g('aegis_bridge_url').value = s.bridgeUrl;
        if (g('aegis_default_timeout')) g('aegis_default_timeout').value = s.defaultTimeout;
        if (g('aegis_extended_timeout')) g('aegis_extended_timeout').value = s.extendedTimeout;
        if (g('aegis_debounce')) g('aegis_debounce').value = s.debounceThreshold;
        if (g('aegis_enabled')) g('aegis_enabled').checked = s.enabled;
        if (g('aegis_base64')) g('aegis_base64').checked = s.useBase64;
    }

    function bindUI() {
    var ids = ['aegis_bridge_url','aegis_default_timeout','aegis_extended_timeout','aegis_debounce','aegis_enabled','aegis_base64'];
    for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        if (el) el.addEventListener('change', function() {
            var s = getSettings();
            s.bridgeUrl = (document.getElementById('aegis_bridge_url').value || '').replace(/\/+$/, '');
            s.defaultTimeout = parseInt(document.getElementById('aegis_default_timeout').value) || 30;
            s.extendedTimeout = parseInt(document.getElementById('aegis_extended_timeout').value) || 300;
            s.debounceThreshold = parseInt(document.getElementById('aegis_debounce').value) || 3;
            s.enabled = document.getElementById('aegis_enabled').checked;
            s.useBase64 = document.getElementById('aegis_base64').checked;
            saveSettings(s);
        });
    }
    var testBtn = document.getElementById('aegis_test_btn');
    if (testBtn) {
        testBtn.addEventListener('click', function() {
            var s = getSettings();
            fetch(s.bridgeUrl + '/strike', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cmd: 'echo BRIDGE_OK', timeout: 5 })
            }).then(function(r) { return r.json(); }).then(function(d) {
                if (window.toastr) window.toastr.success(d.output, 'AEGIS Online');
            }).catch(function(e) {
                if (window.toastr) window.toastr.error(e.message, 'AEGIS Offline');
            });
        });
    }
    // -- health check badge --
    var badge = document.getElementById('aegis_status_badge');
    if (badge) {
        var s = getSettings();
        fetch(s.bridgeUrl + '/health', { method: 'GET' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.status === 'ok') {
                badge.textContent = 'Connected';
                badge.className = 'aegis-status-badge online';
                badge.style.background = '#2ecc71';
            } else {
                badge.textContent = 'Error';
                badge.className = 'aegis-status-badge offline';
                badge.style.background = '#e74c3c';
            }
        }).catch(function() {
            badge.textContent = 'Offline';
            badge.className = 'aegis-status-badge offline';
            badge.style.background = '#e74c3c';
        });
    }
}

let _aegisPanelLoaded = false;
async function loadPanel() {
    if (_aegisPanelLoaded) return;
    if (document.getElementById('aegis_settings')) {
        _aegisPanelLoaded = true;
        return;
    }
    _aegisPanelLoaded = true;
    try {
        var r = await fetch('/scripts/extensions/third-party/SillyTavern-AEGIS/settings.html');
        if (r.ok) {
            var html = await r.text();
            var container = document.getElementById('extensions_settings');
            if (container) {
                container.insertAdjacentHTML('beforeend', html);
                syncUI();
                bindUI();
            }
        }
    } catch(e) { console.log('[AEGIS] Settings panel not found.'); }
}

    // --- GET TEXT EXCLUDING CODE BLOCKS ---
    function getTextExcludingCode(element) {
        const parts = [];
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    let parent = node.parentElement;
                    while (parent && parent !== element) {
                        const tag = parent.tagName.toLowerCase();
                        if (tag === 'code' || tag === 'pre') {
                            return NodeFilter.FILTER_REJECT;
                        }
                        parent = parent.parentElement;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );
        while (walker.nextNode()) {
            parts.push(walker.currentNode.textContent);
        }
        return parts.join('\n');
    }

    // --- INJECT RESULT INTO CHAT ---
    async function injectResult(cmd, data) {
        const status = data.status || 'unknown';
        const output = data.output || '(no output)';
        const timestamp = data.timestamp || new Date().toISOString();
        const returnCode = data.return_code !== undefined ? data.return_code : '?';
        const timeoutUsed = data.timeout_used || 30;

        const msg = [
            `[TERMINAL OUTPUT]`,
            `Command: ${cmd}`,
            `Status: ${status} (exit: ${returnCode})`,
            `Timeout: ${timeoutUsed}s`,
            `Time: ${timestamp}`,
            `Output:`,
            output.substring(0, 4000),
        ].join('\n');

        const ctx = getSTContext();

        if (ctx && typeof ctx.executeSlashCommands === 'function') {
            try {
                const escaped = msg.replace(/\|/g, '\\|');
                await ctx.executeSlashCommands('/sendas name="AEGIS Terminal" ' + escaped);
                console.log("[AEGIS] Result injected via /sendas (visible to AI).");
                return;
            } catch(e) {
                console.log("[AEGIS] /sendas failed:", e.message);
            }
        }

        if (ctx && typeof ctx.executeSlashCommands === 'function') {
            try {
                await ctx.executeSlashCommands('/comment ' + msg);
                console.log("[AEGIS] Result injected via /comment.");
                return;
            } catch(e) {
                console.log("[AEGIS] /comment failed:", e.message);
            }
        }

        if (ctx && ctx.chat && typeof ctx.addOneMessage === 'function') {
            try {
                const messageObj = {
                    name: 'AEGIS Terminal',
                    is_user: false,
                    is_system: false,
                    send_date: new Date().toISOString(),
                    mes: msg,
                    extra: { isSmallSys: false }
                };
                ctx.chat.push(messageObj);
                ctx.addOneMessage(messageObj);
                await ctx.saveChat();
                console.log("[AEGIS] Result injected via direct chat push.");
                return;
            } catch(e) {
                console.log("[AEGIS] Direct push failed:", e.message);
            }
        }

        console.log("[AEGIS] All injection methods failed. Output:\n" + msg);
        if (window.toastr) {
            window.toastr.info(output.substring(0, 300), "AEGIS [" + cmd + "]", { timeOut: 15000 });
        }
    }

    // --- SEND STRIKE ---
    async function sendStrike(command, timeout) {
        timeout = timeout || 30;
        console.log("%c[AEGIS]: !! STRIKING !! -> " + command + " (timeout: " + timeout + "s)", "color: #f43f5e; font-weight: bold;");
        if (window.toastr) window.toastr.warning("Executing: " + command + " (" + timeout + "s)", "AEGIS ⚡", { timeOut: 3000 });

        try {
            var s = getSettings();
            var payload = { timeout: timeout };
            if (s.useBase64) {
                payload.cmd = btoa(unescape(encodeURIComponent(command)));
                payload.encoded = true;
            } else {
                payload.cmd = command;
            }
            const response = await fetch(s.bridgeUrl + '/strike', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();

            if (data.status === 'blocked') {
                if (window.toastr) window.toastr.error(data.output, "AEGIS SHIELD 🛡️");
            } else if (data.status === 'timeout') {
                if (window.toastr) window.toastr.warning(data.output, "AEGIS ⏱️ Timeout", { timeOut: 10000 });
            } else {
                if (window.toastr) window.toastr.success(
                    (data.output || '').substring(0, 100),
                    "AEGIS ✓ " + command,
                    { timeOut: 8000 }
                );
            }

            await injectResult(command, data);

        } catch (e) {
            console.error("[AEGIS ERROR]:", e.message);
            if (window.toastr) window.toastr.error(e.message, "AEGIS Error");
            await injectResult(command, { status: 'error', output: e.message, timestamp: new Date().toISOString() });
        }
    }

    // --- HANDLE DAEMON STRIKE ---
    async function handleDaemonStrike(cmd) {
        console.log("[AEGIS] Awaiting approval for: " + cmd);
        const result = await requestApproval(cmd);
        if (result === 'approve') {
            console.log("[AEGIS] APPROVED (30s): " + cmd);
            await sendStrike(cmd, 30);
        } else if (result === 'extended') {
            console.log("[AEGIS] APPROVED EXTENDED (300s): " + cmd);
            await sendStrike(cmd, 300);
        } else {
            console.log("[AEGIS] DENIED: " + cmd);
            if (window.toastr) window.toastr.info("Denied: " + cmd, "AEGIS");
        }
    }

    // --- HANDLE MEISTER STRIKE ---
    async function handleMeisterStrike(cmd) {
        console.log("[AEGIS] Meister STRIKE (auto, 30s): " + cmd);
        await sendStrike(cmd, 30);
    }

    // --- EXTRACT COMMAND ---
    function extractStrike(text) {
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('[STRIKE]')) {
                const cmd = trimmed.substring('[STRIKE]'.length).trim();
                if (cmd.length > 0) return cmd;
            }
        }
        return null;
    }

    // --- SCAN ---
    function scanForStrike() {
        if (!dirty && !pendingDaemonCmd) return;
        dirty = false;
        if (approvalPending) return;

        const elapsed = Date.now() - armedAt;
        if (!settled && elapsed < 5000) return;

        const allMessages = document.querySelectorAll('.mes[mesid]:not([mesid=""])');
        const now = Date.now();

        if (now - lastLogTime > 30000) {
            const userCount = document.querySelectorAll('.mes[is_user="true"]').length;
            console.log("[AEGIS] Heartbeat: " + allMessages.length + " msgs, " + userCount + " user, lastSeen=" + lastSeenMesId);
            lastLogTime = now;
        }

        if (allMessages.length === 0) return;

        const lastMsg = allMessages[allMessages.length - 1];
        const mesId = parseInt(lastMsg.getAttribute('mesid'), 10);
        const isUser = lastMsg.getAttribute('is_user') === 'true';

        if (!settled) {
            lastSeenMesId = mesId;
            settled = true;
            console.log("%c[AEGIS]: Settled. Baseline mesid: " + lastSeenMesId + " (" + allMessages.length + " msgs)", "color: #22c55e; font-weight: bold;");
            return;
        }

        const mesBody = lastMsg.querySelector('.mes_text');
        const text = mesBody ? getTextExcludingCode(mesBody) : "";

        // --- STREAMING RE-SCAN (daemon messages, same mesId) ---
        if (mesId === lastSeenMesId && !isUser) {
            if (lastMsg.dataset.aegisStrikeFired) return;
            const cmd = extractStrike(text);
            if (cmd) {
                if (pendingDaemonMesId === mesId && pendingDaemonCmd === cmd) {
                    pendingStableCount++;
                    console.log("[AEGIS] Debounce: stable " + pendingStableCount + "/" + STABLE_THRESHOLD + " — \"" + cmd + "\"");
                    if (pendingStableCount >= STABLE_THRESHOLD) {
                        const dedupKey = mesId + ':' + cmd;
                        if (firedStrikes.has(dedupKey)) return;
                        firedStrikes.add(dedupKey);
                        lastMsg.dataset.aegisStrikeFired = 'true';
                        pendingDaemonCmd = null;
                        pendingDaemonMesId = null;
                        pendingStableCount = 0;
                        console.log("[AEGIS] Daemon STRIKE (debounced, stable): " + cmd);
                        handleDaemonStrike(cmd);
                    }
                } else {
                    pendingDaemonCmd = cmd;
                    pendingDaemonMesId = mesId;
                    pendingStableCount = 1;
                    console.log("[AEGIS] Debounce: new/changed command — \"" + cmd + "\" (reset to 1/" + STABLE_THRESHOLD + ")");
                }
            }
            return;
        }

        if (pendingDaemonMesId !== null && mesId !== pendingDaemonMesId) {
            console.log("[AEGIS] Debounce cancelled — new message replaced pending mesId " + pendingDaemonMesId);
            pendingDaemonCmd = null;
            pendingDaemonMesId = null;
            pendingStableCount = 0;
        }

        if (mesId <= lastSeenMesId) return;

        const cmd = extractStrike(text);

        if (cmd) {
            const dedupKey = mesId + ':' + cmd;
            if (firedStrikes.has(dedupKey)) {
                lastSeenMesId = mesId;
                return;
            }
            firedStrikes.add(dedupKey);
            lastSeenMesId = mesId;

            if (isUser) {
                handleMeisterStrike(cmd);
            } else {
                lastMsg.dataset.aegisStrikeFired = 'true';
                console.log("[AEGIS] Daemon STRIKE (immediate, new msg): " + cmd);
                handleDaemonStrike(cmd);
            }
            return;
        }

        lastSeenMesId = mesId;
    }

    const observer = new MutationObserver(() => { dirty = true; });
    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(scanForStrike, 1000);

    const panelObserver = new MutationObserver(() => {
        if (document.getElementById('extensions_settings') && !document.getElementById('aegis_settings')) {
            loadPanel();
        }
    });
    panelObserver.observe(document.body, { childList: true, subtree: true });


    console.log("[AEGIS]: ARMED. V16. Extended timeout. Debounce (3s). Code-block exclusion. Dedup. Meister=auto(30s). Daemon=modal(30s/300s).");
})();
