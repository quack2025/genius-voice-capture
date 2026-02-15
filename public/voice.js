/**
 * Genius Voice Capture Widget v1.6
 * Standalone widget for embedding voice recording in surveys (Alchemer, etc.)
 *
 * Usage — Alchemer JavaScript Action (recommended):
 *   Paste this JS in the JavaScript Action field:
 *
 *   var c=document.createElement('div');
 *   c.dataset.project='proj_xxx';
 *   c.dataset.session='SESSION_ID';
 *   c.dataset.question='q1';
 *   c.dataset.lang='es';
 *   var s=document.scripts;
 *   s[s.length-1].parentNode.appendChild(c);
 *   if(window.GeniusVoice){GeniusVoice.init(c)}
 *   else{var j=document.createElement('script');
 *   j.src='https://voiceapi.survey-genius.ai/voice.js';
 *   document.head.appendChild(j)}
 *
 * Usage — HTML embed (generic platforms):
 *   <div id="genius-voice" data-project="proj_xxx" data-session="SESSION_ID"
 *        data-question="q1" data-lang="es"></div>
 *   <script src="https://voiceapi.survey-genius.ai/voice.js"></script>
 */
(function () {
    'use strict';

    // Capture script reference immediately (before any async)
    var scriptTag = document.currentScript;

    /**
     * Initialize a single container element as a widget.
     * Can be called externally via window.GeniusVoice.init(el)
     */
    function initContainer(container) {
        if (!container || !container.dataset) return;
        if (container.dataset.gvInit === '1') return; // already initialized
        if (!container.dataset.project) {
            console.warn('[GeniusVoice] Container missing data-project attribute');
            return;
        }
        container.dataset.gvInit = '1';
        initWidget(container);
    }

    /**
     * Scan the page for all uninitialized containers and init them.
     * Called on first load and can be called externally via window.GeniusVoice.scan()
     */
    function scanAndInit() {
        // Find all elements with data-project (excluding script tags and already-init'd)
        var containers = document.querySelectorAll('[data-project^="proj_"]:not(script):not([data-gv-init="1"])');
        for (var i = 0; i < containers.length; i++) {
            initContainer(containers[i]);
        }

        // If nothing found and we have a script tag with data-project, auto-create
        if (containers.length === 0 && scriptTag && scriptTag.dataset.project) {
            var container = document.createElement('div');
            var attrs = ['project', 'session', 'question', 'lang', 'maxDuration', 'api', 'target'];
            for (var j = 0; j < attrs.length; j++) {
                if (scriptTag.dataset[attrs[j]]) {
                    container.dataset[attrs[j]] = scriptTag.dataset[attrs[j]];
                }
            }
            if (scriptTag.parentNode) {
                scriptTag.parentNode.insertBefore(container, scriptTag);
                initContainer(container);
            }
        }
    }

    // Expose global API for dynamic loading (Alchemer JS Actions)
    window.GeniusVoice = {
        init: initContainer,
        scan: scanAndInit
    };

    function initWidget(container) {
        var projectKey = container.dataset.project;
        if (!projectKey) {
            console.error('[GeniusVoice] Missing data-project attribute');
            return;
        }

        var sessionId = container.dataset.session || getSessionFromUrl() || generateFallbackId();
        var questionId = container.dataset.question || null;
        var maxDuration = parseInt(container.dataset.maxDuration, 10) || 120;
        var lang = container.dataset.lang || 'es';
        var apiUrl = container.dataset.api || getScriptOrigin() || 'https://voiceapi.survey-genius.ai';
        var targetSelector = container.dataset.target || null;

        // --- i18n ---
        var texts = {
            es: {
                record: 'Grabar respuesta',
                stop: 'Detener',
                recording: 'Grabando...',
                transcribing: 'Transcribiendo...',
                transcribingLong: 'Procesando, un momento...',
                success: 'Respuesta guardada',
                error: 'Error al transcribir',
                retry: 'Intentar de nuevo',
                rerecord: 'Grabar de nuevo',
                permissionDenied: 'Se necesita acceso al micr\u00f3fono',
                notSupported: 'Tu navegador no soporta grabaci\u00f3n de audio',
                maxReached: 'Duraci\u00f3n m\u00e1xima alcanzada'
            },
            en: {
                record: 'Record answer',
                stop: 'Stop',
                recording: 'Recording...',
                transcribing: 'Transcribing...',
                transcribingLong: 'Processing, one moment...',
                success: 'Answer saved',
                error: 'Transcription error',
                retry: 'Try again',
                rerecord: 'Record again',
                permissionDenied: 'Microphone access required',
                notSupported: 'Your browser does not support audio recording',
                maxReached: 'Maximum duration reached'
            },
            pt: {
                record: 'Gravar resposta',
                stop: 'Parar',
                recording: 'Gravando...',
                transcribing: 'Transcrevendo...',
                transcribingLong: 'Processando, um momento...',
                success: 'Resposta salva',
                error: 'Erro na transcri\u00e7\u00e3o',
                retry: 'Tentar novamente',
                rerecord: 'Gravar novamente',
                permissionDenied: '\u00c9 necess\u00e1rio acesso ao microfone',
                notSupported: 'Seu navegador n\u00e3o suporta grava\u00e7\u00e3o de \u00e1udio',
                maxReached: 'Dura\u00e7\u00e3o m\u00e1xima atingida'
            }
        };
        var t = texts[lang] || texts.es;

        // --- State ---
        var state = 'idle'; // idle | recording | uploading | success | error
        var mediaRecorder = null;
        var audioChunks = [];
        var timerInterval = null;
        var seconds = 0;
        var transcriptionText = '';
        var errorMsg = '';
        var showBranding = false;
        var configLoaded = false;

        // --- Write transcription to host form field ---
        function writeToFormField(text) {
            var targetEl = null;
            try {
                if (targetSelector) {
                    targetEl = document.querySelector(targetSelector);
                }
                if (!targetEl && container.parentElement) {
                    targetEl = container.parentElement.querySelector(
                        '.sg-question-options textarea, .sg-question-options input[type="text"]'
                    );
                }
                if (targetEl) {
                    targetEl.value = text || '';
                    targetEl.dispatchEvent(new Event('input', { bubbles: true }));
                    targetEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } catch (e) {
                console.warn('[GeniusVoice] Could not write to form field:', e);
            }
            try {
                container.dispatchEvent(new CustomEvent('geniusvoice:transcribed', {
                    bubbles: true,
                    detail: { text: text || '', questionId: questionId, sessionId: sessionId }
                }));
            } catch (e) { /* CustomEvent not supported */ }
        }

        // --- Hide host form field (widget replaces the textarea visually) ---
        try {
            if (container.parentElement) {
                var hostField = container.parentElement.querySelector('.sg-question-options');
                if (hostField) hostField.style.cssText = 'height:0;overflow:hidden;opacity:0;pointer-events:none;margin:0;padding:0;';
            }
        } catch (e) { /* non-Alchemer environment, ignore */ }

        // --- Shadow DOM ---
        if (typeof container.attachShadow !== 'function') {
            container.textContent = t.notSupported;
            return;
        }
        var shadow = container.attachShadow({ mode: 'closed' });

        var styleEl = document.createElement('style');
        styleEl.textContent = getStyles();
        shadow.appendChild(styleEl);

        var wrapper = document.createElement('div');
        wrapper.className = 'gv-widget';
        shadow.appendChild(wrapper);

        // --- Render ---
        function render() {
            wrapper.innerHTML = '';
            switch (state) {
                case 'idle': renderIdle(); break;
                case 'recording': renderRecording(); break;
                case 'uploading': renderUploading(); break;
                case 'success': renderSuccess(); break;
                case 'error': renderError(); break;
            }
            renderBranding();
        }

        function renderIdle() {
            // Check browser support (includes MediaRecorder for iOS Safari <14.6)
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
                var msg = el('div', { className: 'gv-msg gv-error-msg' });
                msg.textContent = t.notSupported;
                wrapper.appendChild(msg);
                return;
            }
            var btn = el('button', { className: 'gv-btn gv-btn-record', onclick: startRecording });
            btn.innerHTML = micSvg() + ' <span>' + t.record + '</span>';
            wrapper.appendChild(btn);
        }

        function renderRecording() {
            var top = el('div', { className: 'gv-recording-indicator' });
            top.innerHTML = '<span class="gv-pulse"></span> <span class="gv-timer">' + formatTime(seconds) + '</span>';
            wrapper.appendChild(top);

            var btn = el('button', { className: 'gv-btn gv-btn-stop', onclick: stopRecording });
            btn.innerHTML = stopSvg() + ' <span>' + t.stop + '</span>';
            wrapper.appendChild(btn);
        }

        function renderUploading() {
            var elapsed = uploadStartedAt ? (Date.now() - uploadStartedAt) / 1000 : 0;
            var msg = elapsed > 15 ? t.transcribingLong : t.transcribing;
            wrapper.innerHTML = '<div class="gv-uploading"><div class="gv-spinner"></div><span>' + msg + '</span></div>';
        }

        function renderSuccess() {
            var check = el('div', { className: 'gv-success-icon' });
            check.innerHTML = checkSvg();
            wrapper.appendChild(check);

            var msgEl = el('div', { className: 'gv-msg gv-success-msg' });
            msgEl.textContent = t.success;
            wrapper.appendChild(msgEl);

            if (transcriptionText) {
                var preview = el('div', { className: 'gv-preview' });
                preview.textContent = transcriptionText.length > 200
                    ? transcriptionText.substring(0, 200) + '...'
                    : transcriptionText;
                wrapper.appendChild(preview);
            }

            var btn = el('button', { className: 'gv-btn gv-btn-secondary', onclick: resetWidget });
            btn.textContent = t.rerecord;
            wrapper.appendChild(btn);
        }

        function renderError() {
            var msgEl = el('div', { className: 'gv-msg gv-error-msg' });
            msgEl.textContent = errorMsg || t.error;
            wrapper.appendChild(msgEl);
            var btn = el('button', { className: 'gv-btn gv-btn-retry', onclick: resetWidget });
            btn.textContent = t.retry;
            wrapper.appendChild(btn);
        }

        function renderBranding() {
            if (!showBranding) return;
            var badge = el('div', { className: 'gv-branding' });
            var link = el('a', { href: 'https://survey-genius.ai', target: '_blank' });
            link.textContent = 'Powered by Survey Genius';
            badge.appendChild(link);
            wrapper.appendChild(badge);
        }

        function applyTheme(theme) {
            if (!theme) return;
            var css = [];
            if (theme.primary_color) {
                css.push('.gv-btn-record{background:' + theme.primary_color + '}');
                css.push('.gv-btn-record:hover{background:' + theme.primary_color + ';filter:brightness(0.9)}');
                css.push('.gv-spinner{border-top-color:' + theme.primary_color + '}');
            }
            if (theme.background) {
                css.push('.gv-widget{background:' + theme.background + '}');
            }
            if (theme.border_radius != null) {
                css.push('.gv-widget{border-radius:' + theme.border_radius + 'px}');
            }
            if (theme.text_color) {
                css.push('.gv-widget{color:' + theme.text_color + '}');
            }
            if (css.length) {
                var s = document.createElement('style');
                s.textContent = css.join('\n');
                shadow.appendChild(s);
            }
        }

        // --- Recording logic ---
        function startRecording() {
            if (state !== 'idle') return; // Guard against double-click
            state = 'recording'; // Set immediately to prevent race
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(function (stream) {
                    try {
                        var mimeType = getMimeType();
                        var options = mimeType ? { mimeType: mimeType } : {};

                        mediaRecorder = new MediaRecorder(stream, options);
                        audioChunks = [];
                        seconds = 0;

                        mediaRecorder.ondataavailable = function (e) {
                            if (e.data.size > 0) audioChunks.push(e.data);
                        };

                        mediaRecorder.onstop = function () {
                            stream.getTracks().forEach(function (track) { track.stop(); });
                            var blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                            uploadAudio(blob);
                        };

                        mediaRecorder.start(1000);
                    } catch (e) {
                        // Stop stream tracks to release microphone if MediaRecorder setup fails
                        stream.getTracks().forEach(function (track) { track.stop(); });
                        errorMsg = t.error;
                        state = 'error';
                        render();
                        return;
                    }

                    timerInterval = setInterval(function () {
                        seconds++;
                        if (seconds >= maxDuration) {
                            stopRecording();
                            // Show brief max-reached notice in uploading state
                            var notice = wrapper.querySelector('.gv-uploading span');
                            if (notice) notice.textContent = t.maxReached;
                            return;
                        }
                        var timerEl = wrapper.querySelector('.gv-timer');
                        if (timerEl) timerEl.textContent = formatTime(seconds);
                    }, 1000);

                    render();
                })
                .catch(function (err) {
                    errorMsg = (err && err.name === 'NotFoundError')
                        ? t.notSupported   // No microphone hardware
                        : t.permissionDenied;
                    state = 'error';
                    render();
                });
        }

        function stopRecording() {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                clearInterval(timerInterval);
                mediaRecorder.stop();
                state = 'uploading';
                render();
            }
        }

        // --- Upload ---
        var uploadStartedAt = 0;

        function uploadAudio(blob, attempt) {
            attempt = attempt || 1;
            if (attempt === 1) uploadStartedAt = Date.now();
            var ext = blob.type.indexOf('webm') !== -1 ? 'webm'
                : blob.type.indexOf('mp4') !== -1 ? 'mp4'
                : 'webm';

            var formData = new FormData();
            formData.append('audio', blob, 'recording.' + ext);
            formData.append('session_id', sessionId);
            if (questionId) formData.append('question_id', questionId);
            formData.append('duration_seconds', String(seconds));
            formData.append('language', lang);

            // Show "processing" message after 15s of waiting
            var longTimer = setTimeout(function () {
                if (state === 'uploading') render();
            }, 15000);

            // Abort fetch after 120s to prevent indefinite hang
            var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            var fetchTimeout = setTimeout(function () {
                if (controller) controller.abort();
            }, 120000);

            fetch(apiUrl + '/api/transcribe', {
                method: 'POST',
                headers: { 'x-project-key': projectKey },
                body: formData,
                signal: controller ? controller.signal : undefined
            })
            .then(function (response) {
                if (!response.ok) throw new Error('Server error: ' + response.status);
                return response.json();
            })
            .then(function (data) {
                clearTimeout(fetchTimeout);
                clearTimeout(longTimer);
                if (state !== 'uploading') return; // Guard: ignore if retry already resolved
                if (data.success && data.status === 'completed') {
                    transcriptionText = data.transcription || '';
                    state = 'success';
                    writeToFormField(transcriptionText);
                } else {
                    errorMsg = data.error || t.error;
                    state = 'error';
                }
                render();
            })
            .catch(function () {
                clearTimeout(longTimer);
                clearTimeout(fetchTimeout);
                if (state !== 'uploading') return; // Guard: ignore if retry already resolved
                if (attempt < 2) {
                    setTimeout(function () { uploadAudio(blob, attempt + 1); }, 3000);
                    return;
                }
                errorMsg = t.error;
                state = 'error';
                render();
            });
        }

        function resetWidget() {
            clearInterval(timerInterval);
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                try { mediaRecorder.stop(); } catch (e) { /* ignore */ }
            }
            mediaRecorder = null;
            state = 'idle';
            transcriptionText = '';
            errorMsg = '';
            seconds = 0;
            writeToFormField('');
            render();
        }

        // --- Fetch widget config (non-blocking) ---
        fetch(apiUrl + '/api/widget-config/' + projectKey)
            .then(function (r) { return r.json(); })
            .then(function (cfg) {
                configLoaded = true;
                if (cfg.max_duration) maxDuration = cfg.max_duration;
                if (cfg.show_branding) showBranding = true;
                if (cfg.theme) applyTheme(cfg.theme);
                render();
            })
            .catch(function () { /* use defaults on error */ });

        // --- Initialize widget ---
        render();
    }

    // --- Shared helpers (outside initWidget, no per-instance state) ---
    function getSessionFromUrl() {
        try {
            var params = new URLSearchParams(window.location.search);
            return params.get('sguid') || params.get('snc') || null;
        } catch (e) { return null; }
    }

    function generateFallbackId() {
        return 'gv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    function getScriptOrigin() {
        try {
            var scripts = document.getElementsByTagName('script');
            for (var i = 0; i < scripts.length; i++) {
                if (scripts[i].src && scripts[i].src.indexOf('voice.js') !== -1) {
                    var url = new URL(scripts[i].src);
                    return url.origin;
                }
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    function getMimeType() {
        if (typeof MediaRecorder === 'undefined') return '';
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
        if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
        if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
        return '';
    }

    function formatTime(s) {
        var m = Math.floor(s / 60);
        var sec = s % 60;
        return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
    }

    function el(tag, attrs) {
        var e = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                if (k === 'className') e.className = attrs[k];
                else if (k.indexOf('on') === 0) e.addEventListener(k.substring(2), attrs[k]);
                else e.setAttribute(k, attrs[k]);
            });
        }
        return e;
    }

    // --- SVG Icons ---
    function micSvg() {
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>';
    }

    function stopSvg() {
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
    }

    function checkSvg() {
        return '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    }

    // --- Styles ---
    function getStyles() {
        return [
            ':host { display: block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
            '.gv-widget { padding: 16px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; text-align: center; max-width: 400px; }',
            '.gv-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; border: none; border-radius: 8px; font-size: 15px; font-weight: 500; cursor: pointer; transition: all 0.2s; }',
            '.gv-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }',
            '.gv-btn:active { transform: translateY(0); }',
            '.gv-btn-record { background: #6366f1; color: #fff; }',
            '.gv-btn-record:hover { background: #4f46e5; }',
            '.gv-btn-stop { background: #ef4444; color: #fff; }',
            '.gv-btn-stop:hover { background: #dc2626; }',
            '.gv-btn-secondary { background: #f1f5f9; color: #334155; margin-top: 12px; }',
            '.gv-btn-secondary:hover { background: #e2e8f0; }',
            '.gv-btn-retry { background: #f59e0b; color: #fff; margin-top: 12px; }',
            '.gv-btn-retry:hover { background: #d97706; }',
            '.gv-btn svg { flex-shrink: 0; }',
            '.gv-recording-indicator { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 16px; font-size: 24px; font-weight: 600; color: #ef4444; font-variant-numeric: tabular-nums; }',
            '.gv-pulse { display: inline-block; width: 12px; height: 12px; background: #ef4444; border-radius: 50%; animation: gv-pulse-anim 1s ease-in-out infinite; }',
            '@keyframes gv-pulse-anim { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.3); } }',
            '.gv-uploading { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 20px 0; color: #64748b; font-size: 15px; }',
            '.gv-spinner { width: 24px; height: 24px; border: 3px solid #e2e8f0; border-top-color: #6366f1; border-radius: 50%; animation: gv-spin 0.8s linear infinite; }',
            '@keyframes gv-spin { to { transform: rotate(360deg); } }',
            '.gv-success-icon { color: #22c55e; margin-bottom: 8px; }',
            '.gv-msg { font-size: 15px; font-weight: 500; margin-bottom: 4px; }',
            '.gv-success-msg { color: #16a34a; }',
            '.gv-error-msg { color: #dc2626; margin-bottom: 12px; }',
            '.gv-preview { font-size: 13px; color: #64748b; background: #f8fafc; padding: 12px; border-radius: 8px; margin-top: 12px; text-align: left; line-height: 1.5; max-height: 120px; overflow-y: auto; }',
            '.gv-branding { margin-top: 10px; text-align: center; font-size: 11px; }',
            '.gv-branding a { color: #94a3b8; text-decoration: none; }',
            '.gv-branding a:hover { color: #6366f1; text-decoration: underline; }'
        ].join('\n');
    }

    // --- Bootstrap: wait for DOM if needed, then scan all containers ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scanAndInit);
    } else {
        scanAndInit();
    }
})();
