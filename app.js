(function () {
  'use strict';

  // === CONFIG ===
  var CFG = window.HERMES_CONFIG || {};
  var DEFAULT_URL = CFG.serverUrl || window.location.origin;
  var DEFAULT_KEY = CFG.apiKey || '';
  var DEFAULT_MODE = CFG.mode || 'streaming';   // 'streaming' | 'responses'
  var DEFAULT_TURNS = CFG.maxTurns || 8;
  var DEFAULT_INST = CFG.instructions || '';
  var TIMEOUT_MS = 900000; // 15 min (inference is slow)

  // Session ID rules: letters, numbers, hyphens, underscores, 3-64 chars
  var SESSION_ID_RE = /^[a-zA-Z0-9_-]{3,64}$/;

  // === MARKED CONFIG (Kindle-safe) ===
  // marked.js v4 UMD build - disable async (Kindle doesn't support async imports)
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,      // GitHub-style line breaks
      gfm: true,         // GitHub Flavored Markdown
      headerIds: false,  // No auto-generated IDs
      mangle: false     // Don't mangle email addresses
    });
  }

  // === STATE ===
  var state = {
    serverUrl: DEFAULT_URL,
    apiKey: DEFAULT_KEY,
    mode: DEFAULT_MODE,    // 'streaming' | 'responses'
    maxTurns: DEFAULT_TURNS,

    sessions: [],       // [{id, mode, preview, time, lastResponseId?, messageCount?}]
    activeSession: null,     // string session ID
    messages: [],       // current view buffer [{role, content, tools}]

    // Responses-mode paging
    latestResponseId: null,
    earliestResponseId: null,
    hasEarlier: false,
    loadingEarlier: false,

    connected: false,
    sending: false,
    lastError: null,
    dark: false
  };

  // === DOM CACHE ===
  var E = {};
  function cacheDom() {
    var ids = [
      'status', 'mode-badge',
      'sessions-view', 'chat-view',
      'sessions-list', 'sessions-empty',
      'refresh-sessions-btn',
      'new-session-btn', 'new-session-form', 'new-session-input',
      'new-session-error', 'new-session-cancel', 'new-session-create',
      'rejoin-input', 'rejoin-error', 'rejoin-btn',
      'settings-toggle', 'settings-panel',
      'setting-url', 'setting-key',
      'setting-mode-streaming', 'setting-mode-responses',
      'setting-max-turns', 'setting-dark-mode', 'mode-hint',
      'test-connection-btn', 'settings-save',
      'back-btn', 'session-title', 'chat-mode-badge',
      'load-earlier', 'load-earlier-btn',
      'messages', 'typing-indicator',
      'message-input', 'send-btn'
    ];
    for (var i = 0; i < ids.length; i++) {
      E[ids[i]] = document.getElementById(ids[i]);
    }
  }

  // === PERSISTENCE ===
  var LS_META_KEY = 'hermes_tw_sessions_v2';  // only session metadata
  var LS_MSG_PREFIX = 'hermes_tw_msgs_';      // streaming mode message arrays

  function saveMeta() {
    try {
      // Only save settings, NOT sessions - server is source of truth
      localStorage.setItem(LS_META_KEY, JSON.stringify({
        serverUrl: state.serverUrl,
        apiKey: state.apiKey,
        mode: state.mode,
        maxTurns: state.maxTurns,
        dark: state.dark
      }));
    } catch (e) { /* silent fail on Kindle */ }
  }

  /** Streaming mode: persist messages for a session */
  function saveMessages(sessionId, messages) {
    try {
      // Cap stored messages to maxTurns * 2 to respect Kindle storage limits
      var cap = state.maxTurns * 4; // generous buffer
      var store = messages.slice(-cap);
      localStorage.setItem(LS_MSG_PREFIX + sessionId, JSON.stringify(store));
    } catch (e) { /* silent */ }
  }

  /** Streaming mode: load persisted messages for a session */
  function loadMessages(sessionId) {
    try {
      return JSON.parse(localStorage.getItem(LS_MSG_PREFIX + sessionId) || 'null') || [];
    } catch (e) { return []; }
  }

  /** Responses mode: remove any stored messages for a session (not needed) */
  function clearMessages(sessionId) {
    try { localStorage.removeItem(LS_MSG_PREFIX + sessionId); } catch (e) { }
  }

  function loadMeta() {
    try {
      var d = JSON.parse(localStorage.getItem(LS_META_KEY) || 'null');
      if (d) {
        state.serverUrl = d.serverUrl || DEFAULT_URL;
        state.apiKey = d.apiKey || '';
        state.mode = d.mode || DEFAULT_MODE;
        state.maxTurns = d.maxTurns || DEFAULT_TURNS;
        state.dark = !!d.dark;
        // Sessions loaded from server, not localStorage
        state.sessions = [];
      }
      applyDarkMode();
    } catch (e) { /* use defaults */ }
  }

  // === HELPERS ===
  // Twemoji handles emoji → <img> conversion
  // This is a no-op now, kept for backwards compatibility
  function replaceEmoji(text) {
    return text || '';
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderMarkdown(text) {
    if (!text) return '';
    // Use marked.js if available, otherwise fall back to basic rendering
    if (typeof marked === 'function') {
      return marked.parse(text);
    }
    // Fallback: basic markdown (code, bold, italic, line breaks)
    var h = escapeHtml(text);
    h = h.replace(/```([a-z]*)\n([\s\S]*?)```/g, function (_, _lang, code) {
      return '<pre class="code-block">' + code.trim() + '</pre>';
    });
    h = h.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/([^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    h = h.replace(/\n/g, '<br>');
    return h;
  }

  // Apply Twemoji to an element (converts emoji to <img> tags)
  function applyTwemoji(el) {
    if (typeof twemoji === 'object' && twemoji.parse) {
      twemoji.parse(el, {
        folder: 'svg',  // SVG is smaller and scales better
        ext: '.svg',
        className: 'emoji'
      });
    }
  }

  function formatTime(ts) {
    if (!ts) return '';
    var d = new Date(ts), now = new Date(), diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString();
  }

  function scrollToBottom() {
    window.scrollTo(0, document.body.scrollHeight);
  }

  function scrollIntoViewKindle(el) {
    if (!el) return;
    try {
      if (el.scrollIntoView) { el.scrollIntoView(false); }
      else {
        var r = el.getBoundingClientRect();
        window.scrollTo(0, (window.pageYOffset || 0) + r.top - 50);
      }
    } catch (e) { window.scrollTo(0, document.body.scrollHeight); }
  }

  // Validate session ID format
  function validateSessionId(id) {
    if (!id || !id.trim()) return 'Session ID cannot be empty.';
    if (!SESSION_ID_RE.test(id.trim())) {
      return 'Only letters, numbers, hyphens (-) and underscores (_) allowed. 3-64 chars.';
    }
    return null; // valid
  }

  // === SESSION MANAGEMENT ===
  function findSession(id) {
    for (var i = 0; i < state.sessions.length; i++) {
      if (state.sessions[i].id === id) return state.sessions[i];
    }
    return null;
  }

  function upsertSession(id, mode) {
    var s = findSession(id);
    if (!s) {
      s = { id: id, mode: mode || state.mode, preview: '', time: Date.now(), lastResponseId: null };
      state.sessions.unshift(s);
    }
    return s;
  }

  function touchSession(id, preview, responseId) {
    var s = upsertSession(id);
    if (preview) s.preview = preview.substring(0, 80);
    if (responseId) s.lastResponseId = responseId;
    s.time = Date.now();
    // Bubble to top
    var idx = state.sessions.indexOf(s);
    if (idx > 0) { state.sessions.splice(idx, 1); state.sessions.unshift(s); }
    saveMeta();
  }

  function deleteSession(id) {
    clearMessages(id);
    state.sessions = state.sessions.filter(function (s) { return s.id !== id; });
    saveMeta();
  }

  // === SERVER SESSIONS API ===
  // Fetches recent sessions via the official Hermes API (/api/sessions)
  // Proxied through the typewriter proxy to the gateway's api_server.
  // Requires API key authentication (same as completions API)
  function fetchServerSessions(callback) {
    if (!state.serverUrl) {
      if (callback) callback(null);
      return;
    }
    var ctrl = new AbortController();
    var tid = setTimeout(function () { ctrl.abort(); }, 8000);

    // Official Hermes endpoint (proxied): GET /api/sessions
    fetch(state.serverUrl + '/api/sessions?limit=15', {
      headers: headers(), // Include Authorization header
      signal: ctrl.signal
    })
      .then(function (r) {
        clearTimeout(tid);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var serverSessions = data.data || []; // official shape: {object:"list", data:[...]}
        console.log('[hermes] Fetched ' + serverSessions.length + ' sessions from server');
        if (callback) callback(serverSessions);
      })
      .catch(function (err) {
        clearTimeout(tid);
        console.log('[hermes] Failed to fetch sessions:', err.message);
        if (callback) callback(null);
      });
  }

  // Set sessions from server response (server is source of truth, no local merge)
  function setSessionsFromServer(serverSessions) {
    if (!serverSessions || serverSessions.length === 0) {
      state.sessions = [];
      return;
    }
    
    var sessions = [];
    for (var j = 0; j < serverSessions.length; j++) {
      var ss = serverSessions[j];
      
      // Handle timestamp: use started_at_iso (from our endpoint) or started_at (raw timestamp)
      var sessionTime = Date.now();
      // Official /api/sessions shape: started_at is a unix timestamp (float)
      if (ss.started_at) {
        sessionTime = ss.started_at * 1000; // Unix timestamp (seconds) to ms
      } else if (ss.started_at_iso) {
        sessionTime = new Date(ss.started_at_iso).getTime();
      }
      
      sessions.push({
        id: ss.id,
        mode: state.mode, // Use current mode setting
        preview: ss.preview || '',
        title: ss.title || null,
        source: ss.source || null,
        message_count: ss.message_count || 0,
        model: ss.model || null,
        time: sessionTime
      });
    }
    
    state.sessions = sessions;
  }

  // === API HEADERS ===
  function headers(includeSession) {
    var h = { 'Content-Type': 'application/json' };
    if (state.apiKey) h['Authorization'] = 'Bearer ' + state.apiKey;
    if (includeSession && state.activeSession) {
      h['X-Hermes-Session-Id'] = state.activeSession;
    }
    return h;
  }

  // === HEALTH CHECK ===
  function checkHealth(manual) {
    if (manual) E['test-connection-btn'].textContent = '[...]';
    var ctrl = new AbortController();
    var tid = setTimeout(function () { ctrl.abort(); }, 6000);
    // Use /v1/models — requires auth, so a 401 correctly shows as disconnected
    fetch(state.serverUrl + '/v1/models', { headers: headers(), signal: ctrl.signal })
      .then(function (r) {
        clearTimeout(tid);
        state.connected = r.ok;
        state.lastError = r.ok ? null : 'Auth failed (' + r.status + ')';
        renderStatus();
        if (manual) E['test-connection-btn'].textContent = r.ok ? '[OK!]' : '[ERR ' + r.status + ']';
      })
      .catch(function (err) {
        clearTimeout(tid);
        state.connected = false;
        state.lastError = err.message || 'Connection failed';
        renderStatus();
        if (manual) E['test-connection-btn'].textContent = '[FAIL]';
      })
      .finally(function () {
        if (manual) setTimeout(function () { E['test-connection-btn'].textContent = '[TEST]'; }, 2500);
      });
  }

  // === SEND MESSAGE (mode dispatcher) ===
  function sendMessage(text) {
    if (state.sending || !text.trim()) return;
    state.sending = true;
    updateInputState();

    var userMsg = { role: 'user', content: text, tools: [] };
    state.messages.push(userMsg);
    renderMessages();

    var session = findSession(state.activeSession);
    if (!session) return;

    if (session.mode === 'streaming') {
      doStreaming(text, session);
    } else {
      doResponses(text, session);
    }
  }

  // ─── STREAMING MODE ─────────────────────────────────────────────────────────
  function doStreaming(text, session) {
    var ctrl = new AbortController();
    var tid = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    var assistantMsg = { role: 'assistant', content: '', tools: [] };
    state.messages.push(assistantMsg);
    showTyping(true);  // Show typing indicator during streaming
    renderMessages();

    var body = {
      model: 'hermes-agent',
      messages: [{ role: 'user', content: text }],
      stream: true
    };

    console.log('[hermes] Streaming POST /v1/chat/completions, session:', session.id);
    fetch(state.serverUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: headers(true), // include X-Hermes-Session-Id
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
      .then(function (r) {
        clearTimeout(tid);
        if (!r.ok) {
          return r.text().then(function (t) {
            throw new Error('HTTP ' + r.status + ': ' + (t.substring(0, 200) || 'error'));
          });
        }
        return pumpChatStream(r, assistantMsg);
      })
      .then(function () {
        // Persist messages to localStorage (streaming mode only)
        saveMessages(session.id, state.messages);
        touchSession(session.id, assistantMsg.content);
        // Enforce maxTurns view (don't discard, just show notice)
        enforceMaxTurns();
        renderMessages();
      })
      .catch(function (err) {
        var errMsg = err.message || String(err);
        console.error('[hermes] Stream error:', errMsg);
        state.lastError = errMsg;
        state.messages.push({ role: 'error', content: errMsg, tools: [] });
        renderMessages();
      })
      .finally(function () {
        state.sending = false;
        showTyping(false);
        updateInputState();
        removeCursor();
      });
  }

  function pumpChatStream(response, msg) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';

    function read() {
      return reader.read().then(function (result) {
        if (result.done) {
          if (buf.trim()) processChatSSE(buf.split('\n'), msg);
          return;
        }
        buf += decoder.decode(result.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop() || '';
        processChatSSE(lines, msg);
        return read();
      });
    }
    return read();
  }

  function processChatSSE(lines, msg) {
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line === 'data: [DONE]') continue;
      if (line.indexOf('data:') !== 0) continue;
      try {
        var d = JSON.parse(line.substring(5).trim());
        var delta = d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
        if (!delta) continue;

        // Detect tool progress injected as `emoji label` by the server
        // Format: \n`{emoji} {label}`\n
        var toolMatch = delta.match(/\n?`([^`]+)`\s?\n?/);
        if (toolMatch) {
          var raw = toolMatch[1];
          // Extract emoji (first unicode char) and label (rest after space)
          // Twemoji will convert emoji to image when rendered
          var parts = raw.split(/\s+/);
          var icon = parts[0] || '[*]';  // Keep raw emoji - Twemoji handles it
          var label = parts.slice(1).join(' ') || raw;
          msg.tools.push({ name: label, icon: icon, isComplete: true });
          console.log('[hermes] Tool indicator:', label);
          // Update typing indicator to show tool name
          updateTypingTool(label);
        } else {
          msg.content += delta;  // Keep raw emoji - Twemoji converts later
        }
        updateLastMessage(msg);
      } catch (e) { /* partial chunk — ignore */ }
    }
  }

  // ─── RESPONSES MODE ──────────────────────────────────────────────────────────
  function doResponses(text, session) {
    showTyping(true);
    var ctrl = new AbortController();
    var tid = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);

    var body = {
      model: 'hermes-agent',
      input: text,
      store: true,
      instructions: DEFAULT_INST
    };
    // Use conversation name = session ID for server-side response chaining
    body.conversation = session.id;

    console.log('[hermes] Blocking POST /v1/responses, conversation:', session.id);
    fetch(state.serverUrl + '/v1/responses', {
      method: 'POST',
      headers: headers(false), // no session header — responses uses conversation param
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
      .then(function (r) {
        clearTimeout(tid);
        if (!r.ok) {
          return r.text().then(function (t) {
            throw new Error('HTTP ' + r.status + ': ' + (t.substring(0, 200) || 'error'));
          });
        }
        return r.json();
      })
      .then(function (data) {
        var msg = parseResponseData(data);
        state.messages.push(msg);

        if (data.id) {
          state.latestResponseId = data.id;
          // previous_response_id tells us if there's earlier history
          if (data.previous_response_id && !state.earliestResponseId) {
            state.earliestResponseId = data.previous_response_id;
          }
          touchSession(session.id, msg.content, data.id);
        }

        // Check if we need "load earlier" based on turn count
        updateHasEarlier();
        renderMessages();
      })
      .catch(function (err) {
        var errMsg = err.message || String(err);
        console.error('[hermes] Responses error:', errMsg);
        state.lastError = errMsg;
        state.messages.push({ role: 'error', content: errMsg, tools: [] });
        renderMessages();
      })
      .finally(function () {
        state.sending = false;
        showTyping(false);
        updateInputState();
      });
  }

  // ─── RESPONSES MODE: HISTORY PAGING ──────────────────────────────────────────
  function updateHasEarlier() {
    var session = findSession(state.activeSession);
    if (!session || session.mode === 'streaming') {
      state.hasEarlier = false;
    } else {
      // Show load-earlier if server has older responses OR we've hit maxTurns
      var turnPairs = Math.floor(state.messages.length / 2);
      state.hasEarlier = !!state.earliestResponseId && (turnPairs >= state.maxTurns);
    }
    updateLoadEarlierUI();
  }

  function loadEarlier() {
    if (state.loadingEarlier || !state.earliestResponseId) return;
    state.loadingEarlier = true;
    E['load-earlier-btn'].textContent = '[Loading...]';

    fetch(state.serverUrl + '/v1/responses/' + state.earliestResponseId, { headers: headers(false) })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var msgs = responseToMessages(data);
        state.messages = msgs.concat(state.messages);
        state.earliestResponseId = data.previous_response_id || null;
        updateHasEarlier();
        renderMessages();
      })
      .catch(function (err) {
        E['load-earlier-btn'].textContent = '[ERR: ' + (err.message || 'Failed') + ']';
        setTimeout(function () { E['load-earlier-btn'].textContent = '[Load earlier messages...]'; }, 2000);
      })
      .finally(function () {
        state.loadingEarlier = false;
        E['load-earlier-btn'].textContent = '[Load earlier messages...]';
      });
  }

  /** Load the latest response for a session (responses mode) */
  function loadLatestForSession(session) {
    if (!session.lastResponseId) {
      state.hasEarlier = false;
      updateLoadEarlierUI();
      return;
    }
    fetch(state.serverUrl + '/v1/responses/' + session.lastResponseId, { headers: headers(false) })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        state.messages = responseToMessages(data);
        state.latestResponseId = data.id;
        state.earliestResponseId = data.previous_response_id || null;
        updateHasEarlier();
        renderMessages();
      })
      .catch(function (err) {
        console.warn('[hermes] Could not load session history:', err.message);
        state.hasEarlier = false;
        updateLoadEarlierUI();
      });
  }

  // ─── RESPONSE PARSING ────────────────────────────────────────────────────────
  function parseResponseData(data) {
    var msg = { role: 'assistant', content: '', tools: [] };
    if (data.output && Array.isArray(data.output)) {
      for (var i = 0; i < data.output.length; i++) {
        var item = data.output[i];
        if (item.type === 'function_call') {
          var name = item.name || 'tool';
          var args = '';
          try {
            var p = JSON.parse(item.arguments || '{}');
            var k = Object.keys(p);
            if (k.length > 0) args = String(p[k[0]]).substring(0, 60);
          } catch (e) { args = (item.arguments || '').substring(0, 60); }
          msg.tools.push({ name: name, icon: '[*]', args: args, isComplete: true, callId: item.call_id || '' });
        } else if (item.type === 'function_call_output') {
          for (var j = msg.tools.length - 1; j >= 0; j--) {
            if (msg.tools[j].callId === item.call_id) {
              msg.tools[j].output = (item.output || '').substring(0, 200);
              break;
            }
          }
        } else if (item.type === 'message') {
          var content = item.content;
          if (Array.isArray(content)) {
            for (var k2 = 0; k2 < content.length; k2++) {
              if (content[k2].type === 'output_text') {
                msg.content += replaceEmoji(content[k2].text || '');
              }
            }
          } else if (typeof content === 'string') {
            msg.content += replaceEmoji(content);
          }
        }
      }
    }
    return msg;
  }

  function responseToMessages(data) {
    var msgs = [];
    // Extract user turn from input field
    if (data.input) {
      var txt = '';
      if (typeof data.input === 'string') {
        txt = data.input;
      } else if (Array.isArray(data.input)) {
        for (var i = 0; i < data.input.length; i++) {
          if (data.input[i] && data.input[i].content) { txt = data.input[i].content; break; }
        }
      }
      if (txt) msgs.push({ role: 'user', content: txt, tools: [] });
    }
    // Extract assistant turn from output
    if (data.output) {
      var m = parseResponseData(data);
      if (m.content || m.tools.length) msgs.push(m);
    }
    return msgs;
  }

  // ─── ENFORCE STREAMING TURN LIMIT ────────────────────────────────────────────
  function enforceMaxTurns() {
    var session = findSession(state.activeSession);
    if (!session || session.mode !== 'streaming') return;
    // Only visual trim — messages array remains full for localStorage
    // (renderMessages handles this by slicing)
  }

  // === RENDERING ===
  function renderStatus() {
    var icon = state.connected ? '\u25CF' : '\u25CB'; // ● / ○
    var s = icon + (state.connected ? ' ONLINE' : ' OFFLINE');
    if (state.lastError && !state.connected) s = '\u25CB OFFLINE: ' + state.lastError.substring(0, 20);
    E['status'].textContent = s;
    E['status'].className = 'status status--' + (state.connected ? 'online' : 'offline');
  }

  function renderModeBadge() {
    var m = state.mode;
    if (E['mode-badge']) { E['mode-badge'].textContent = m === 'streaming' ? '\u25CE STREAM' : '\u2630 RESP'; }
    if (E['chat-mode-badge']) { E['chat-mode-badge'].textContent = m === 'streaming' ? '\u25CE' : '\u2630'; }
    if (E['mode-hint']) {
      E['mode-hint'].textContent = m === 'streaming'
        ? 'SSE stream. Local storage (last ' + state.maxTurns + ' turns shown).'
        : 'Blocking. History paged from server. Minimal local storage.';
    }
  }

  function showView(name) {
    E['sessions-view'].style.display = name === 'sessions' ? '' : 'none';
    E['chat-view'].style.display = name === 'chat' ? '' : 'none';
    if (name === 'sessions') renderSessionsList();
  }

  function renderSessionsList() {
    // Show loading state
    E['sessions-list'].innerHTML = '<div class="loading-state"><p class="muted">Loading sessions...</p></div>';
    E['sessions-empty'].style.display = 'none';
    
    // Check if we have an API key before fetching
    if (!state.apiKey) {
      E['sessions-list'].innerHTML = '';
      E['sessions-empty'].style.display = '';
      E['sessions-empty'].innerHTML = '<p>API key required.</p><p class="muted">Open [SETTINGS] and enter your API key.</p>';
      return;
    }
    
    // Clear local sessions - server is source of truth
    state.sessions = [];
    
    // Fetch from server, then render
    fetchServerSessions(function(serverSessions) {
      if (serverSessions) {
        // Replace sessions entirely from server
        setSessionsFromServer(serverSessions);
      } else {
        // Auth failed or network error - show message
        E['sessions-list'].innerHTML = '';
        E['sessions-empty'].style.display = '';
        E['sessions-empty'].innerHTML = '<p>Failed to load sessions.</p><p class="muted">Check your API key in [SETTINGS].</p>';
        return;
      }
      _renderSessionsListInner();
    });
  }
  
  function _renderSessionsListInner() {
    E['sessions-list'].innerHTML = '';
    if (state.sessions.length === 0) {
      E['sessions-empty'].style.display = '';
      return;
    }
    E['sessions-empty'].style.display = 'none';
    var frag = document.createDocumentFragment();
    for (var i = 0; i < state.sessions.length; i++) {
      (function (s) {
        var btn = document.createElement('button');
        btn.className = 'thread-item' + (s.id === state.activeSession ? ' thread-item--active' : '');

        // Session name or title
        var nm = document.createElement('span');
        nm.className = 'thread-name';
        // Show title if available, otherwise show ID
        nm.textContent = s.title || s.id;
        btn.appendChild(nm);

        // Source badge (discord, telegram, cli, api_server)
        if (s.source) {
          var src = document.createElement('span');
          src.className = 'session-source-pill';
          src.textContent = s.source.substring(0, 3); // 'dis', 'tel', 'cli', 'api'
          btn.appendChild(src);
        }

        if (s.preview) {
          var pv = document.createElement('span');
          pv.className = 'thread-preview';
          pv.textContent = s.preview;
          btn.appendChild(pv);
        }
        
        // Meta: message count + time
        var meta = document.createElement('span');
        meta.className = 'thread-meta';
        var metaText = '';
        if (s.message_count) metaText += s.message_count + ' msgs';
        if (s.time) {
          if (metaText) metaText += ' • ';
          metaText += formatTime(s.time);
        }
        meta.textContent = metaText;
        btn.appendChild(meta);
        
        // Delete button (2-step confirm for Kindle compatibility)
        var del = document.createElement('button');
        del.className = 'btn btn--sm btn--delete';
        del.textContent = '[DEL]';
        del.setAttribute('aria-label', 'Delete session ' + s.id);
        
        var confirmTimeout = null;
        del.onclick = function (ev) {
          ev.stopPropagation();
          if (del.textContent === '[SURE?]') {
            deleteSession(s.id);
            renderSessionsList();
          } else {
            del.textContent = '[SURE?]';
            del.style.background = 'var(--ink)';
            del.style.color = 'var(--paper)';
            // Revert after 3 seconds if not confirmed
            if (confirmTimeout) clearTimeout(confirmTimeout);
            confirmTimeout = setTimeout(function() {
              del.textContent = '[DEL]';
              del.style.background = '';
              del.style.color = '';
            }, 3000);
          }
        };
        btn.appendChild(del);

        btn.onclick = function () { openSession(s.id); };
        frag.appendChild(btn);
      })(state.sessions[i]);
    }
    E['sessions-list'].appendChild(frag);
  }

  function renderMessages() {
    E['messages'].innerHTML = '';
    if (state.messages.length === 0) {
      var emp = document.createElement('div');
      emp.className = 'empty-state';
      emp.innerHTML = '<p class="muted">Start typing below.</p>';
      E['messages'].appendChild(emp);
      return;
    }

    // Streaming mode: only render the last maxTurns * 2 messages for perf
    var msgs = state.messages;
    var session = findSession(state.activeSession);
    if (session && session.mode === 'streaming' && msgs.length > state.maxTurns * 2) {
      // Show a "... N older messages ..." note at top
      msgs = msgs.slice(-(state.maxTurns * 2));
      var note = document.createElement('div');
      note.className = 'load-earlier-note';
      note.textContent = '[... older messages not shown — scroll stored locally ...]';
      E['messages'].appendChild(note);
    }

    var frag = document.createDocumentFragment();
    for (var i = 0; i < msgs.length; i++) {
      frag.appendChild(buildMessageEl(msgs[i]));
    }
    E['messages'].appendChild(frag);
    scrollToBottom();
  }

  function buildMessageEl(msg) {
    var el = document.createElement('article');
    el.className = 'message message--' + msg.role;

    var role = document.createElement('span');
    role.className = 'message-role';
    role.textContent = msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Hermes' : 'Error';
    el.appendChild(role);

    // Tool badges
    if (msg.tools && msg.tools.length > 0) {
      var tc = document.createElement('div');
      tc.className = 'tools-container';
      for (var i = 0; i < msg.tools.length; i++) {
        var b = document.createElement('span');
        b.className = 'badge' + (msg.tools[i].isComplete ? ' badge--complete' : ' badge--active');
        b.textContent = (msg.tools[i].icon || '[*]') + ' ' + msg.tools[i].name;
        tc.appendChild(b);
      }
      el.appendChild(tc);
      setTimeout(function () { tc.scrollLeft = tc.scrollWidth; }, 0);
    }

    if (msg.content) {
      var c = document.createElement('div');
      c.className = 'message-content';
      c.innerHTML = renderMarkdown(msg.content);
      el.appendChild(c);
    }

    // Apply Twemoji to convert emoji to images (Kindle-safe)
    applyTwemoji(el);

    return el;
  }

  function updateLastMessage(msg) {
    var all = E['messages'].querySelectorAll('.message');
    var last = all[all.length - 1];
    if (!last) { renderMessages(); return; }

    // Live-update tool badges
    var tc = last.querySelector('.tools-container');
    if (msg.tools && msg.tools.length > 0) {
      if (!tc) {
        tc = document.createElement('div');
        tc.className = 'tools-container';
        var roleEl = last.querySelector('.message-role');
        if (roleEl && roleEl.nextSibling) {
          last.insertBefore(tc, roleEl.nextSibling);
        } else {
          last.appendChild(tc);
        }
      }
      tc.innerHTML = '';
      for (var i = 0; i < msg.tools.length; i++) {
        var b = document.createElement('span');
        b.className = 'badge' + (msg.tools[i].isComplete ? ' badge--complete' : ' badge--active');
        b.textContent = (msg.tools[i].icon || '[*]') + ' ' + msg.tools[i].name;
        tc.appendChild(b);
      }
      tc.scrollLeft = tc.scrollWidth;
    }

    // Live-update content with streaming cursor
    var c = last.querySelector('.message-content');
    if (!c) {
      c = document.createElement('div');
      c.className = 'message-content';
      last.appendChild(c);
    }
    c.innerHTML = renderMarkdown(msg.content) + '<span class="streaming-cursor">_</span>';
    
    // Apply Twemoji to new content
    applyTwemoji(c);
    
    scrollToBottom();
  }

  function removeCursor() {
    var cs = document.querySelectorAll('.streaming-cursor');
    for (var i = 0; i < cs.length; i++) {
      if (cs[i].parentNode) cs[i].parentNode.removeChild(cs[i]);
    }
  }

  // === TYPING INDICATOR ===
  var _typingInterval = null;
  var _typingDots = 0;
  var _lastToolName = null;
  
  function showTyping(on, toolName) {
    if (on) {
      E['typing-indicator'].style.display = '';
      // Track tool name for display
      _lastToolName = toolName || null;
      // Start animated ellipsis (e-ink safe - no CSS animations)
      if (_typingInterval) clearInterval(_typingInterval);
      _typingDots = 0;
      _typingInterval = setInterval(function () {
        _typingDots = (_typingDots + 1) % 4;
        var dots = ['', '.', '..', '...'][_typingDots];
        var text = _lastToolName 
          ? _lastToolName.toUpperCase() + dots 
          : 'HERMES IS WRITING' + dots;
        E['typing-indicator'].querySelector('.muted').textContent = text;
      }, 500);
      scrollToBottom();
    } else {
      E['typing-indicator'].style.display = 'none';
      _lastToolName = null;
      if (_typingInterval) {
        clearInterval(_typingInterval);
        _typingInterval = null;
      }
    }
  }
  
  function updateTypingTool(toolName) {
    // Update the typing indicator to show current tool
    // Make sure typing indicator is visible during tool calls
    if (E['typing-indicator'].style.display === 'none') {
      showTyping(true, toolName);
    } else if (_typingInterval) {
      _lastToolName = toolName;
    }
  }

  function updateInputState() {
    E['message-input'].disabled = state.sending;
    E['send-btn'].disabled = state.sending;
    E['send-btn'].textContent = state.sending ? '[...]' : '[SEND]';
  }

  function updateLoadEarlierUI() {
    E['load-earlier'].style.display = state.hasEarlier ? '' : 'none';
  }

  function applyDarkMode() {
    var root = document.documentElement;
    if (state.dark) {
      root.classList.add('dark-mode');
      root.classList.remove('light-mode');
    } else {
      root.classList.remove('dark-mode');
      root.classList.add('light-mode');
    }
  }

  function toggleSettings() {
    var isOff = E['settings-panel'].style.display === 'none';
    E['settings-panel'].style.display = isOff ? '' : 'none';
    if (isOff) {
      E['setting-url'].value = state.serverUrl;
      E['setting-key'].value = state.apiKey;
      E['setting-max-turns'].value = state.maxTurns;
      E['setting-dark-mode'].checked = !!state.dark;
      E['setting-mode-' + state.mode].checked = true;
      renderModeBadge();
    }
  }

  function saveSettings() {
    state.serverUrl = E['setting-url'].value.trim() || DEFAULT_URL;
    state.apiKey = E['setting-key'].value.trim();
    state.maxTurns = parseInt(E['setting-max-turns'].value, 10) || DEFAULT_TURNS;
    state.dark = !!E['setting-dark-mode'].checked;
    
    var m = 'streaming';
    if (E['setting-mode-responses'].checked) m = 'responses';
    state.mode = m;

    // PROPAGATE TO ACTIVE SESSION:
    // If we're already in a session, the user likely wants to change ITS mode too.
    if (state.activeSession) {
      var s = findSession(state.activeSession);
      if (s) {
        s.mode = m;
        // If switching to responses, we don't need local messages.
        // If switching to streaming, we'll keep what's on screen but new turns will be SSE.
      }
    }

    applyDarkMode();
    saveMeta();
    toggleSettings(); // Close panel
    renderModeBadge();
    checkHealth(false);
    renderSessionsList();
  }

  // === SESSION OPEN ===
  function openSession(id) {
    var session = upsertSession(id);
    state.activeSession = id;
    state.messages = [];
    state.latestResponseId = null;
    state.earliestResponseId = null;
    state.hasEarlier = false;
    state.lastError = null;

    E['session-title'].textContent = id;
    E['chat-mode-badge'].textContent = session.mode === 'streaming' ? '\u25CE' : '\u2630';
    showView('chat');
    updateLoadEarlierUI();

    if (session.mode === 'streaming') {
      // Load from localStorage, then refresh history from the server
      // (official endpoint; fills gaps for sessions started on other devices)
      state.messages = loadMessages(id);
      renderMessages();
      loadSessionHistory(id);
    } else {
      // Load from server via Responses API
      loadLatestForSession(session);
    }

    E['message-input'].focus();
  }

  // ─── SESSION HISTORY (official /api/sessions/{id}/messages) ─────────────────
  // Loads the last N turns of a session from the server and merges them with
  // any locally stored messages (Kindle localStorage is volatile and capped —
  // the server is the source of truth for anything older).
  // Data shape (per official API):
  //   { "object": "list", "session_id": "...", "data": [ { role, content,
  //     tool_call_id, tool_calls, tool_name, timestamp, ... }, ... ] }
  // role:"tool" rows carry tool_call_id — attach them to the preceding
  // assistant message's matching tool_call instead of rendering standalone.
  function loadSessionHistory(id, callback) {
    if (!state.serverUrl) { if (callback) callback(null); return; }
    var ctrl = new AbortController();
    var tid = setTimeout(function () { ctrl.abort(); }, 12000);

    fetch(state.serverUrl + '/api/sessions/' + id + '/messages?limit=100&order=latest', {
      headers: headers(false),
      signal: ctrl.signal
    })
      .then(function (r) {
        clearTimeout(tid);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var rows = data.data || [];
        console.log('[hermes] History fetch: ' + rows.length + ' messages for ' + id);

        // Build a chronological turn list, merging tool rows into assistant msgs.
        var msgs = [];
        var pending = null; // assistant message awaiting tool outputs
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          if (row.role === 'user') {
            if (pending) { if (pending.content || pending.tools.length) msgs.push(pending); pending = null; }
            msgs.push({ role: 'user', content: row.content || '', tools: [] });
          } else if (row.role === 'assistant') {
            if (pending) { if (pending.content || pending.tools.length) msgs.push(pending); }
            pending = { role: 'assistant', content: row.content || '', tools: [] };
            // The official API embeds tool_calls on the assistant row:
            // tool_calls: [ { function: { name, arguments } } ]
            var tcs = row.tool_calls || [];
            for (var t = 0; t < tcs.length; t++) {
              var fn = (tcs[t] && tcs[t].function) || {};
              var args = '';
              try {
                var p = JSON.parse(fn.arguments || '{}');
                var k = Object.keys(p);
                if (k.length > 0) args = String(p[k[0]]).substring(0, 60);
              } catch (e) { args = (fn.arguments || '').substring(0, 60); }
              pending.tools.push({
                name: fn.name || row.tool_name || 'tool',
                icon: '[*]', args: args, isComplete: true,
                callId: tcs[t].id || tcs[t].call_id || ''
              });
            }
          } else if (row.role === 'tool') {
            // Tool output row — attach to the pending assistant message's call
            var out = (row.content || '').substring(0, 200);
            if (pending) {
              var attached = false;
              for (var j = 0; j < pending.tools.length; j++) {
                if (pending.tools[j].callId && pending.tools[j].callId === row.tool_call_id) {
                  pending.tools[j].output = out;
                  attached = true;
                  break;
                }
              }
              if (!attached && row.tool_name) {
                // Orphan output (call row not in our window) — synthesize a badge
                pending.tools.push({ name: row.tool_name, icon: '[>]', args: '', output: out, isComplete: true, callId: row.tool_call_id || '' });
              }
            }
          }
          // role:"error"/other rows are skipped — not part of a readable turn
        }
        if (pending) { if (pending.content || pending.tools.length) msgs.push(pending); }

        if (state.activeSession === id) {
          // Server history supersedes local: it covers gaps (turns that happened
          // on other devices) and is authoritative. Local messages not present in
          // the server window (e.g. current in-flight turn) are preserved on top.
          var localMsgs = state.messages || [];
          // The last user message may be the just-sent one not yet on the server.
          var lastLocalUser = null;
          for (var m = localMsgs.length - 1; m >= 0; m--) {
            if (localMsgs[m].role === 'user') { lastLocalUser = localMsgs[m]; break; }
          }
          var lastServerUser = null;
          for (var s2 = msgs.length - 1; s2 >= 0; s2--) {
            if (msgs[s2].role === 'user') { lastServerUser = msgs[s2]; break; }
          }
          var tail = [];
          if (lastLocalUser && (!lastServerUser || lastLocalUser.content !== lastServerUser.content)) {
            // in-flight or unsynced local tail: keep local messages from that point
            var idx = localMsgs.indexOf(lastLocalUser);
            if (idx >= 0) tail = localMsgs.slice(idx);
          }
          state.messages = msgs.concat(tail);
          renderMessages();
          // Persist the merged view for offline re-open
          if (findSession(id) && findSession(id).mode === 'streaming') saveMessages(id, state.messages);
        }
        if (callback) callback(msgs);
      })
      .catch(function (err) {
        clearTimeout(tid);
        console.warn('[hermes] History fetch failed:', err.message);
        if (callback) callback(null);
      });
  }

  // === FORM VALIDATION HELPERS ===
  function showFormError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? '' : 'none';
  }

  // === EVENT BINDING ===
  function bindEvents() {
    // Refresh sessions
    E['refresh-sessions-btn'].addEventListener('click', function () {
      E['refresh-sessions-btn'].textContent = '[...]';
      renderSessionsList();
      setTimeout(function () { E['refresh-sessions-btn'].textContent = '[\u21BB]'; }, 1000);
    });
    
    // New session
    E['new-session-btn'].addEventListener('click', function () {
      E['new-session-form'].style.display = '';
      E['new-session-input'].value = '';
      showFormError(E['new-session-error'], '');
      E['new-session-input'].focus();
    });
    E['new-session-cancel'].addEventListener('click', function () {
      E['new-session-form'].style.display = 'none';
    });

    function tryCreateSession() {
      var id = E['new-session-input'].value.trim();
      var err = validateSessionId(id);
      if (err) { showFormError(E['new-session-error'], err); return; }
      showFormError(E['new-session-error'], '');
      E['new-session-form'].style.display = 'none';
      upsertSession(id, state.mode); // stamp with current mode
      saveMeta();
      openSession(id);
    }

    E['new-session-create'].addEventListener('click', tryCreateSession);
    E['new-session-input'].addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); tryCreateSession(); }
    });

    // Rejoin
    function tryRejoin() {
      var id = E['rejoin-input'].value.trim();
      var err = validateSessionId(id);
      if (err) { showFormError(E['rejoin-error'], err); return; }
      showFormError(E['rejoin-error'], '');
      E['rejoin-input'].value = '';
      // If session doesn't exist locally, create stub with current mode
      if (!findSession(id)) upsertSession(id, state.mode);
      saveMeta();
      openSession(id);
    }
    E['rejoin-btn'].addEventListener('click', tryRejoin);
    E['rejoin-input'].addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); tryRejoin(); }
    });

    // Mode switch hints (Live update while toggling radios)
    var updateHint = function () {
      var m = E['setting-mode-responses'].checked ? 'responses' : 'streaming';
      E['mode-hint'].textContent = m === 'streaming'
        ? 'SSE stream. Local storage (last ' + (E['setting-max-turns'].value || state.maxTurns) + ' turns shown).'
        : 'Blocking. History paged from server. Minimal local storage.';
    };
    E['setting-mode-streaming'].addEventListener('change', updateHint);
    E['setting-mode-responses'].addEventListener('change', updateHint);
    E['setting-max-turns'].addEventListener('input', updateHint);

    E['settings-toggle'].addEventListener('click', toggleSettings);
    E['settings-save'].addEventListener('click', saveSettings);

    E['test-connection-btn'].addEventListener('click', function () {
      state.serverUrl = E['setting-url'].value.trim() || state.serverUrl;
      checkHealth(true);
    });

    // Back - refresh sessions when returning to list
    E['back-btn'].addEventListener('click', function () {
      showView('sessions');
      renderSessionsList(); // Refresh from server
    });

    // Load earlier (responses mode paging)
    E['load-earlier-btn'].addEventListener('click', loadEarlier);

    // Send
    E['send-btn'].addEventListener('click', function () {
      var text = E['message-input'].value;
      if (text.trim()) {
        sendMessage(text.trim());
        E['message-input'].value = '';
        autoGrow();
      }
    });
    E['message-input'].addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); E['send-btn'].click(); }
    });
    E['message-input'].addEventListener('input', autoGrow);
    E['message-input'].addEventListener('focus', function () {
      setTimeout(function () { scrollIntoViewKindle(E['message-input']); }, 150);
    });

    // Escape closes forms
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        if (E['new-session-form'].style.display !== 'none') {
          E['new-session-form'].style.display = 'none';
        } else if (E['settings-panel'].style.display !== 'none') {
          E['settings-panel'].style.display = 'none';
        }
      }
    });
  }

  function autoGrow() {
    var el = E['message-input'];
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  }

  // === INIT ===
  function init() {
    window.onerror = function (msg, src, ln) {
      console.error('[hermes]', msg, src, ln);
      return false;
    };
    window.addEventListener('unhandledrejection', function (e) {
      console.error('[hermes] Promise error:', e.reason);
    });

    cacheDom();
    loadMeta();

    renderModeBadge();
    bindEvents();
    renderSessionsList();
    checkHealth();
    setInterval(checkHealth, 30000);
    
    // If no API key, open settings on first load
    if (!state.apiKey) {
      toggleSettings();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
