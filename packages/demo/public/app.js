/**
 * Autarch Dashboard — Vanilla JS
 * Connects to SSE /events, renders agent cards, handles interactions.
 */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────
  var selectedAgentId = null;
  var startTime = Date.now();
  var lastTickTimestamp = null;
  var uptimeInterval = null;
  var errorCount = 0;
  var MAX_ERRORS = 3;
  var hasReceivedFirstUpdate = false;

  // ── DOM refs ───────────────────────────────────────────────────────
  var agentCardsContainer = document.getElementById('agent-cards');
  var connectionDot = document.querySelector('.connection-dot');
  var connectionLabel = document.querySelector('.connection-label');
  var footerAgents = document.getElementById('footer-agents');
  var footerUptime = document.getElementById('footer-uptime');
  var footerCountdown = document.getElementById('footer-countdown');
  var modeBadge = document.getElementById('mode-badge');
  var marketPrice = document.getElementById('market-price');
  var activityLog = document.getElementById('activity-log');
  var tracePanel = document.getElementById('trace-panel');
  var btnDip = document.getElementById('btn-dip');
  var btnRally = document.getElementById('btn-rally');
  var btnReset = document.getElementById('btn-reset');
  var toastContainer = document.getElementById('toast-container');

  // ── Helpers ────────────────────────────────────────────────────────

  /**
   * Format a relative timestamp string.
   * @param {number|null} ts - Millisecond epoch timestamp.
   * @returns {string} Relative time string.
   */
  function formatRelativeTime(ts) {
    if (!ts) return '—';
    var diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return 'just now';
    if (diff < 60) return diff + 's ago';
    var mins = Math.floor(diff / 60);
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    return hrs + 'h ago';
  }

  /**
   * Format an absolute timestamp for title hover.
   * @param {number|null} ts - Millisecond epoch timestamp.
   * @returns {string}
   */
  function formatAbsoluteTime(ts) {
    if (!ts) return '';
    return new Date(ts).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  }

  /**
   * Format a SOL balance to 2 decimal places.
   * @param {number} balance
   * @returns {string}
   */
  function formatSol(balance) {
    return (typeof balance === 'number' ? balance : 0).toFixed(2) + ' SOL';
  }

  /**
   * Truncate a Solana address: first 4 + ... + last 4.
   * @param {string} addr
   * @returns {string}
   */
  function formatAddress(addr) {
    if (!addr || addr.length <= 8) return addr || '';
    return addr.slice(0, 4) + '...' + addr.slice(-4);
  }

  /**
   * Map agent status to CSS class for the status dot.
   * @param {string} status
   * @returns {string}
   */
  function statusDotClass(status) {
    switch (status) {
      case 'active':   return 'status-active';
      case 'cooldown': return 'status-cooldown';
      case 'idle':     return 'status-idle';
      case 'error':    return 'status-error';
      case 'stopped':  return 'status-stopped';
      default:         return 'status-idle';
    }
  }

  /**
   * Format a duration in seconds to HH:MM:SS.
   * @param {number} totalSeconds
   * @returns {string}
   */
  function formatDuration(totalSeconds) {
    var hrs = Math.floor(totalSeconds / 3600);
    var mins = Math.floor((totalSeconds % 3600) / 60);
    var secs = totalSeconds % 60;
    return (
      String(hrs).padStart(2, '0') + ':' +
      String(mins).padStart(2, '0') + ':' +
      String(secs).padStart(2, '0')
    );
  }

  // ── Activity Log State ───────────────────────────────────────────
  var lastRenderedTradeTimestamp = {};
  var entryTraceMap = new WeakMap();
  var selectedTradeEntry = null;
  var LOG_MAX_ENTRIES = 200;
  var lastConnectionState = null;

  // ── Trace Panel State ──────────────────────────────────────────
  var lastAgentsData = [];
  var tracePanelTrigger = null;
  var currentTraceView = 'tree';

  // ── Activity Log Helpers ────────────────────────────────────────

  /**
   * Check if an agent's lastDecision represents a new trade.
   * @param {{ agentId: number, lastDecision: object }} agent
   * @returns {boolean}
   */
  function isNewTrade(agent) {
    var trace = agent.lastDecision;
    if (!trace) return false;
    if (!trace.decision || trace.decision.action === 'none') return false;
    if (!trace.execution) return false;
    var lastTs = lastRenderedTradeTimestamp[agent.agentId] || 0;
    if (trace.timestamp <= lastTs) return false;
    lastRenderedTradeTimestamp[agent.agentId] = trace.timestamp;
    return true;
  }

  /**
   * Get the CSS class for an agent tag based on agentId.
   * @param {number} agentId
   * @returns {string}
   */
  function agentTagClass(agentId) {
    var idx = ((agentId - 1) % 3) + 1;
    return 'agent-tag-' + idx;
  }

  /**
   * Truncate a tx signature and return an anchor element to Solana Explorer.
   * @param {string} sig
   * @returns {HTMLAnchorElement}
   */
  function formatTxSignature(sig) {
    var truncated = sig.slice(0, 4) + '...' + sig.slice(-4);
    var a = document.createElement('a');
    a.className = 'tx-link font-mono';
    a.href = 'https://explorer.solana.com/tx/' + sig + '?cluster=devnet';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', 'View transaction ' + truncated + ' in Solana Explorer');
    a.textContent = truncated + ' \u2197';
    return a;
  }

  /**
   * Render a trade log entry.
   * @param {object} data - { agentId, agentName, action, amount, trigger, score, signature, timestamp, trace }
   * @returns {HTMLElement}
   */
  function renderTradeEntry(data) {
    var article = document.createElement('article');
    article.className = 'log-entry log-entry-trade log-entry-new';
    article.setAttribute('role', 'article');
    article.setAttribute('tabindex', '0');
    article.setAttribute('aria-label', data.agentName + ' ' + data.action + ' ' + data.amount.toFixed(2) + ' SOL, ' + formatRelativeTime(data.timestamp));

    // Line 1: timestamp | agent tag | action + amount
    var line1 = document.createElement('div');
    line1.className = 'log-entry-line1';

    var ts = document.createElement('span');
    ts.className = 'log-timestamp font-mono';
    ts.title = formatAbsoluteTime(data.timestamp);
    ts.textContent = formatRelativeTime(data.timestamp);

    var tag = document.createElement('span');
    tag.className = 'agent-tag ' + agentTagClass(data.agentId);
    tag.textContent = data.agentName;

    var actionSpan = document.createElement('span');
    actionSpan.className = 'log-action';
    actionSpan.textContent = data.action.toUpperCase() + ' ' + data.amount.toFixed(2) + ' SOL';

    line1.appendChild(ts);
    line1.appendChild(document.createTextNode(' '));
    line1.appendChild(tag);
    line1.appendChild(document.createTextNode(' '));
    line1.appendChild(actionSpan);

    // Line 2: trigger/score + tx link
    var line2 = document.createElement('div');
    line2.className = 'log-entry-line2';

    var triggerSpan = document.createElement('span');
    triggerSpan.className = 'log-trigger font-mono';
    triggerSpan.textContent = data.trigger + ' \u2022 score ' + data.score;

    line2.appendChild(triggerSpan);
    if (data.signature) {
      line2.appendChild(document.createTextNode(' '));
      line2.appendChild(formatTxSignature(data.signature));
    }

    article.appendChild(line1);
    article.appendChild(line2);

    // Store trace data
    entryTraceMap.set(article, data.trace);

    // Click and keyboard handler
    article.addEventListener('click', function () {
      selectTradeEntry(article);
    });
    article.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectTradeEntry(article);
      }
    });

    return article;
  }

  /**
   * Select a trade entry — highlight it and dispatch trace-selected event.
   * @param {HTMLElement} entry
   */
  function selectTradeEntry(entry) {
    if (selectedTradeEntry) {
      selectedTradeEntry.classList.remove('selected');
    }
    entry.classList.add('selected');
    selectedTradeEntry = entry;
    var trace = entryTraceMap.get(entry);
    document.dispatchEvent(new CustomEvent('trace-selected', { detail: trace }));
  }

  /**
   * Render a system event log entry.
   * @param {object} data - { event, agentId, message, timestamp }
   * @returns {HTMLElement}
   */
  function renderSystemEntry(data) {
    var div = document.createElement('div');
    div.className = 'log-entry log-entry-system log-entry-new';

    var ts = document.createElement('span');
    ts.className = 'log-timestamp font-mono';
    ts.title = formatAbsoluteTime(data.timestamp);
    ts.textContent = formatRelativeTime(data.timestamp);

    var tag = document.createElement('span');
    tag.className = 'agent-tag agent-tag-system';
    tag.textContent = 'System';

    var msg = document.createElement('span');
    msg.className = 'log-message';
    msg.textContent = data.message;

    div.appendChild(ts);
    div.appendChild(document.createTextNode(' '));
    div.appendChild(tag);
    div.appendChild(document.createTextNode(' '));
    div.appendChild(msg);

    return div;
  }

  /**
   * Render a hot-reload event log entry.
   * @param {object} data - { fileName, success, error, timestamp }
   * @returns {HTMLElement}
   */
  function renderHotReloadEntry(data) {
    var div = document.createElement('div');
    div.className = 'log-entry log-entry-hotreload log-entry-new';

    var ts = document.createElement('span');
    ts.className = 'log-timestamp font-mono';
    ts.title = formatAbsoluteTime(data.timestamp);
    ts.textContent = formatRelativeTime(data.timestamp);

    var tag = document.createElement('span');
    tag.className = 'agent-tag agent-tag-hotreload';
    tag.textContent = 'System';

    var msg = document.createElement('span');
    msg.className = 'log-message';
    if (data.success) {
      msg.textContent = '\u27F2 Rules reloaded: ' + (data.fileName || 'unknown') + ' modified';
    } else {
      msg.textContent = '\u27F2 Rules reload failed: ' + (data.error || 'unknown error');
    }

    div.appendChild(ts);
    div.appendChild(document.createTextNode(' '));
    div.appendChild(tag);
    div.appendChild(document.createTextNode(' '));
    div.appendChild(msg);

    return div;
  }

  /**
   * Add a log entry to the activity log (newest first), cap at 200 entries.
   * @param {HTMLElement} element
   */
  function addLogEntry(element) {
    if (!activityLog) return;

    // Remove empty state if present
    var emptyState = activityLog.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    // Prepend (newest first)
    activityLog.insertBefore(element, activityLog.firstChild);

    // Remove animation class after 200ms
    setTimeout(function () {
      element.classList.remove('log-entry-new');
    }, 200);

    // Cap at 200 entries
    var entries = activityLog.querySelectorAll('.log-entry');
    while (entries.length > LOG_MAX_ENTRIES) {
      var oldest = entries[entries.length - 1];
      oldest.remove();
      entries = activityLog.querySelectorAll('.log-entry');
    }
  }

  /**
   * Extract trade entry data from an agent's lastDecision.
   * @param {{ agentId: number, name: string, lastDecision: object }} agent
   * @returns {object}
   */
  function extractTradeData(agent) {
    var trace = agent.lastDecision;
    var topRule = trace.evaluations && trace.evaluations.length > 0
      ? trace.evaluations.reduce(function (best, ev) { return ev.score > best.score ? ev : best; }, trace.evaluations[0])
      : null;
    var triggerSummary = 'Manual';
    if (topRule && topRule.conditions && topRule.conditions.length > 0) {
      var cond = topRule.conditions.find(function (c) { return c.passed; }) || topRule.conditions[0];
      triggerSummary = cond.field + ' ' + cond.operator + ' ' + cond.threshold;
    } else if (topRule && topRule.ruleName) {
      triggerSummary = topRule.ruleName;
    }

    return {
      agentId: agent.agentId,
      agentName: agent.name,
      action: trace.decision.action,
      amount: trace.decision.amount || 0,
      trigger: triggerSummary,
      score: topRule ? topRule.score : 0,
      signature: trace.execution ? trace.execution.signature : null,
      timestamp: trace.timestamp,
      trace: trace
    };
  }

  // ── Trace Panel Rendering ──────────────────────────────────────────

  /**
   * Render a single condition line for the trace tree.
   * @param {object} condition - ConditionResult object
   * @param {boolean} isLast - Whether this is the last line in the group
   * @returns {HTMLElement}
   */
  function renderTraceConditionLine(condition, isLast) {
    var div = document.createElement('div');
    div.className = 'trace-line';
    div.style.paddingLeft = '24px';

    var connector = document.createElement('span');
    connector.className = 'trace-label';
    connector.textContent = isLast ? '└─ ' : '├─ ';

    var label = document.createElement('span');
    label.className = 'trace-label';
    label.textContent = condition.field + ' ' + condition.operator + ' ' + condition.threshold;

    var arrow = document.createElement('span');
    arrow.className = 'trace-label';
    arrow.textContent = ' → ';

    var actual = document.createElement('span');
    actual.className = 'trace-value';
    actual.textContent = String(condition.actual);

    var indicator = document.createElement('span');
    if (condition.passed) {
      indicator.className = 'trace-pass';
      indicator.textContent = '  ✓ PASS';
    } else {
      indicator.className = 'trace-fail';
      indicator.textContent = '  ✗ FAIL';
    }

    div.appendChild(connector);
    div.appendChild(label);
    div.appendChild(arrow);
    div.appendChild(actual);
    div.appendChild(indicator);
    return div;
  }

  /**
   * Render cooldown and balance check lines for a rule evaluation.
   * @param {object} evaluation - RuleEvaluation object
   * @returns {DocumentFragment}
   */
  function renderTraceCooldownLine(evaluation) {
    var frag = document.createDocumentFragment();
    var hasCooldown = evaluation.cooldown !== undefined;
    var hasBalance = evaluation.blocked !== undefined;

    // Cooldown line
    if (hasCooldown) {
      var cdDiv = document.createElement('div');
      cdDiv.className = 'trace-line';
      cdDiv.style.paddingLeft = '24px';

      var cdConn = document.createElement('span');
      cdConn.className = 'trace-label';
      cdConn.textContent = hasBalance ? '├─ ' : '└─ ';

      var cdLabel = document.createElement('span');
      cdLabel.className = 'trace-label';
      cdLabel.textContent = 'Cooldown → ';

      var cdStatus = document.createElement('span');
      if (evaluation.cooldown === 'clear') {
        cdStatus.className = 'trace-pass';
        cdStatus.textContent = '✓ CLEAR';
      } else {
        cdStatus.className = 'trace-fail';
        cdStatus.textContent = '✗ ACTIVE (' + (evaluation.cooldownRemaining || 0) + 's remaining)';
      }

      cdDiv.appendChild(cdConn);
      cdDiv.appendChild(cdLabel);
      cdDiv.appendChild(cdStatus);
      frag.appendChild(cdDiv);
    }

    // Balance line
    if (hasBalance) {
      var balDiv = document.createElement('div');
      balDiv.className = 'trace-line';
      balDiv.style.paddingLeft = '24px';

      var balConn = document.createElement('span');
      balConn.className = 'trace-label';
      balConn.textContent = '└─ ';

      var balLabel = document.createElement('span');
      balLabel.className = 'trace-label';
      balLabel.textContent = 'Balance → ';

      var balStatus = document.createElement('span');
      if (evaluation.blocked === 'insufficient_balance') {
        balStatus.className = 'trace-fail';
        balStatus.textContent = '✗ INSUFFICIENT';
      } else {
        balStatus.className = 'trace-pass';
        balStatus.textContent = '✓ OK';
      }

      balDiv.appendChild(balConn);
      balDiv.appendChild(balLabel);
      balDiv.appendChild(balStatus);
      frag.appendChild(balDiv);
    }

    return frag;
  }

  /**
   * Render the score line for a rule evaluation.
   * @param {object} evaluation - RuleEvaluation object
   * @returns {HTMLElement}
   */
  function renderTraceScoreLine(evaluation) {
    var hasActionLine = arguments.length > 1 ? arguments[1] : false;
    var div = document.createElement('div');
    div.className = 'trace-line';
    div.style.paddingLeft = '24px';

    var conn = document.createElement('span');
    conn.className = 'trace-label';
    conn.textContent = hasActionLine ? '├─ ' : '└─ ';

    var label = document.createElement('span');
    label.className = 'trace-label';
    label.textContent = 'Score → ';

    var score = document.createElement('span');
    score.className = 'trace-value';
    score.textContent = evaluation.score + '/100';

    var result = document.createElement('span');
    result.className = 'trace-action';
    result.textContent = evaluation.matched ? ' → EXECUTE' : ' → SKIP';

    div.appendChild(conn);
    div.appendChild(label);
    div.appendChild(score);
    div.appendChild(result);
    return div;
  }

  /**
   * Render the final action line for a decision trace.
   * @param {object} trace - Full DecisionTrace object
   * @returns {HTMLElement|null}
   */
  function renderTraceActionLine(trace) {
    if (!trace.execution) return null;

    var div = document.createElement('div');
    div.className = 'trace-line';
    div.style.paddingLeft = '24px';

    var conn = document.createElement('span');
    conn.className = 'trace-label';
    conn.textContent = '└─ ';

    var actionLabel = document.createElement('span');
    actionLabel.className = 'trace-action';
    var actionText = 'Action: ' + trace.decision.action.toUpperCase();
    if (trace.decision.amount !== undefined) {
      actionText += ' ' + trace.decision.amount.toFixed(2) + ' SOL';
    }
    actionLabel.textContent = actionText;

    div.appendChild(conn);
    div.appendChild(actionLabel);

    // Transaction link
    if (trace.execution.signature) {
      div.appendChild(document.createTextNode(' → tx: '));
      div.appendChild(formatTxSignature(trace.execution.signature));
    }

    // Execution status
    var execStatus = document.createElement('span');
    var status = trace.execution.status;
    if (status === 'confirmed') {
      execStatus.className = 'trace-pass';
      execStatus.textContent = '  ✓ CONFIRMED';
    } else if (status === 'simulated') {
      execStatus.className = 'trace-pass';
      execStatus.textContent = '  ✓ SIMULATED';
    } else {
      execStatus.className = 'trace-fail';
      execStatus.textContent = '  ✗ FAILED';
      if (trace.execution.error) {
        execStatus.textContent += ': ' + trace.execution.error;
      }
    }
    div.appendChild(execStatus);

    return div;
  }

  /**
   * Recursively build syntax-highlighted JSON using DOM elements.
   * @param {*} value - JSON value to highlight
   * @param {number} depth - Current indentation depth
   * @returns {DocumentFragment}
   */
  function highlightJsonValue(value, depth) {
    var frag = document.createDocumentFragment();
    var indent = '';
    for (var i = 0; i < depth; i++) indent += '  ';
    var innerIndent = indent + '  ';

    if (value === null) {
      var nullSpan = document.createElement('span');
      nullSpan.style.color = 'var(--status-info)';
      nullSpan.textContent = 'null';
      frag.appendChild(nullSpan);
    } else if (typeof value === 'boolean') {
      var boolSpan = document.createElement('span');
      boolSpan.style.color = 'var(--status-info)';
      boolSpan.textContent = String(value);
      frag.appendChild(boolSpan);
    } else if (typeof value === 'number') {
      var numSpan = document.createElement('span');
      numSpan.style.color = 'var(--status-warning)';
      numSpan.textContent = String(value);
      frag.appendChild(numSpan);
    } else if (typeof value === 'string') {
      var strSpan = document.createElement('span');
      strSpan.style.color = 'var(--status-success)';
      strSpan.textContent = '"' + value + '"';
      frag.appendChild(strSpan);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        frag.appendChild(document.createTextNode('[]'));
      } else {
        frag.appendChild(document.createTextNode('[\n'));
        for (var ai = 0; ai < value.length; ai++) {
          frag.appendChild(document.createTextNode(innerIndent));
          frag.appendChild(highlightJsonValue(value[ai], depth + 1));
          if (ai < value.length - 1) frag.appendChild(document.createTextNode(','));
          frag.appendChild(document.createTextNode('\n'));
        }
        frag.appendChild(document.createTextNode(indent + ']'));
      }
    } else if (typeof value === 'object') {
      var keys = Object.keys(value);
      if (keys.length === 0) {
        frag.appendChild(document.createTextNode('{}'));
      } else {
        frag.appendChild(document.createTextNode('{\n'));
        for (var ki = 0; ki < keys.length; ki++) {
          frag.appendChild(document.createTextNode(innerIndent));
          var keySpan = document.createElement('span');
          keySpan.style.color = 'var(--accent-blue)';
          keySpan.textContent = '"' + keys[ki] + '"';
          frag.appendChild(keySpan);
          frag.appendChild(document.createTextNode(': '));
          frag.appendChild(highlightJsonValue(value[keys[ki]], depth + 1));
          if (ki < keys.length - 1) frag.appendChild(document.createTextNode(','));
          frag.appendChild(document.createTextNode('\n'));
        }
        frag.appendChild(document.createTextNode(indent + '}'));
      }
    }

    return frag;
  }

  /**
   * Render the structured tree view for a decision trace.
   * @param {object} trace - Full DecisionTrace object
   * @returns {HTMLElement}
   */
  function renderTraceTree(trace) {
    var container = document.createElement('div');
    container.id = 'trace-tree';
    container.className = 'trace-tree-view font-mono';

    if (!trace.evaluations || trace.evaluations.length === 0) {
      var emptyDiv = document.createElement('div');
      emptyDiv.className = 'trace-line trace-label';
      emptyDiv.textContent = 'No evaluations in trace.';
      container.appendChild(emptyDiv);
      return container;
    }

    // Sort: winning rule first (matching decision.ruleIndex)
    var sortedEvals = trace.evaluations.slice();
    if (trace.decision && trace.decision.ruleIndex !== undefined) {
      sortedEvals.sort(function (a, b) {
        if (a.ruleIndex === trace.decision.ruleIndex) return -1;
        if (b.ruleIndex === trace.decision.ruleIndex) return 1;
        return 0;
      });
    }

    for (var ei = 0; ei < sortedEvals.length; ei++) {
      var evaluation = sortedEvals[ei];

      // Rule header
      var ruleHeader = document.createElement('div');
      ruleHeader.className = 'trace-line';
      var headerText = document.createElement('span');
      headerText.className = 'trace-value';
      headerText.textContent = '── Rule: "' + evaluation.ruleName + '" (score: ' + evaluation.score + ')';
      ruleHeader.appendChild(headerText);
      container.appendChild(ruleHeader);

      // Condition lines
      var conditions = evaluation.conditions || [];
      for (var ci = 0; ci < conditions.length; ci++) {
        var isLastCondition = ci === conditions.length - 1 && evaluation.cooldown === undefined && evaluation.blocked === undefined;
        container.appendChild(renderTraceConditionLine(conditions[ci], isLastCondition));
      }

      // Cooldown + balance lines
      container.appendChild(renderTraceCooldownLine(evaluation));

      // Score line
      var hasActionLine = trace.decision && evaluation.ruleIndex === trace.decision.ruleIndex && trace.execution;
      container.appendChild(renderTraceScoreLine(evaluation, hasActionLine));

      // Action line (only for winning rule)
      if (trace.decision && evaluation.ruleIndex === trace.decision.ruleIndex) {
        var actionLine = renderTraceActionLine(trace);
        if (actionLine) {
          container.appendChild(actionLine);
        }
      }

      // Spacing between rule blocks
      if (ei < sortedEvals.length - 1) {
        var spacer = document.createElement('div');
        spacer.style.height = '8px';
        container.appendChild(spacer);
      }
    }

    return container;
  }

  /**
   * Render the JSON view for a decision trace.
   * @param {object} trace - Full DecisionTrace object
   * @returns {HTMLElement}
   */
  function renderTraceJson(trace) {
    var container = document.createElement('div');
    container.id = 'trace-json';
    container.className = 'trace-json-view font-mono';
    container.hidden = true;

    var pre = document.createElement('pre');
    pre.appendChild(highlightJsonValue(trace, 0));
    container.appendChild(pre);

    return container;
  }

  /**
   * Orchestrate full trace panel build.
   * @param {object} trace - Full DecisionTrace object
   */
  function renderTracePanel(trace) {
    if (!tracePanel) return;

    // Clear existing content
    while (tracePanel.firstChild) {
      tracePanel.removeChild(tracePanel.firstChild);
    }

    // Determine agent name
    var agentName = 'Unknown';
    if (trace.agentId !== undefined) {
      var agent = lastAgentsData.find(function (a) { return a.agentId === trace.agentId; });
      if (agent) agentName = agent.name;
    }

    // Update aria-label
    tracePanel.setAttribute('aria-label', 'Reasoning trace for Agent ' + agentName);

    // Header
    var header = document.createElement('div');
    header.className = 'trace-panel-header';

    var titleDiv = document.createElement('div');
    titleDiv.className = 'trace-panel-title';

    var labelSpan = document.createElement('span');
    labelSpan.className = 'trace-panel-label';
    labelSpan.textContent = 'Reasoning Trace';

    var agentSpan = document.createElement('span');
    agentSpan.className = 'trace-panel-agent font-mono';
    agentSpan.textContent = agentName + ' \u00B7 ' + formatRelativeTime(trace.timestamp);

    titleDiv.appendChild(labelSpan);
    titleDiv.appendChild(document.createTextNode(' '));
    titleDiv.appendChild(agentSpan);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'trace-panel-close';
    closeBtn.setAttribute('aria-label', 'Close trace panel');
    closeBtn.textContent = '\u2715';
    closeBtn.addEventListener('click', function () {
      closeTracePanel();
    });

    header.appendChild(titleDiv);
    header.appendChild(closeBtn);

    // Body
    var body = document.createElement('div');
    body.className = 'trace-panel-body';

    var treeView = renderTraceTree(trace);
    var jsonView = renderTraceJson(trace);

    body.appendChild(treeView);
    body.appendChild(jsonView);

    // Footer
    var footer = document.createElement('div');
    footer.className = 'trace-panel-footer';

    var toggleBtn = document.createElement('button');
    toggleBtn.id = 'trace-toggle-btn';
    toggleBtn.className = 'trace-toggle-btn';
    toggleBtn.textContent = 'Show raw JSON';
    toggleBtn.addEventListener('click', function () {
      toggleTraceView();
    });

    footer.appendChild(toggleBtn);

    // Assemble
    tracePanel.appendChild(header);
    tracePanel.appendChild(body);
    tracePanel.appendChild(footer);
  }

  // ── Trace Panel Open/Close/Toggle ─────────────────────────────────

  /**
   * Open the trace panel with a given trace.
   * @param {object} trace - Full DecisionTrace object
   */
  function openTracePanel(trace) {
    if (!trace) return;
    tracePanelTrigger = document.activeElement;
    renderTracePanel(trace);
    if (tracePanel) {
      tracePanel.hidden = false;
    }
    currentTraceView = 'tree';
  }

  /**
   * Close the trace panel and restore focus.
   */
  function closeTracePanel() {
    if (tracePanel) {
      tracePanel.hidden = true;
    }
    if (tracePanelTrigger && tracePanelTrigger.parentNode) {
      tracePanelTrigger.focus();
    }
    tracePanelTrigger = null;

    // Deselect trade entry
    if (selectedTradeEntry) {
      selectedTradeEntry.classList.remove('selected');
      selectedTradeEntry = null;
    }

    // Deselect agent card
    if (selectedAgentId !== null) {
      var cards = agentCardsContainer ? agentCardsContainer.querySelectorAll('.agent-card') : [];
      cards.forEach(function (card) {
        card.classList.remove('selected');
        card.classList.remove('border-accent-blue');
      });
      selectedAgentId = null;
    }
  }

  /**
   * Toggle between tree and JSON views.
   */
  function toggleTraceView() {
    var treeEl = document.getElementById('trace-tree');
    var jsonEl = document.getElementById('trace-json');
    var toggleBtn = document.getElementById('trace-toggle-btn');
    if (!treeEl || !jsonEl || !toggleBtn) return;

    if (currentTraceView === 'tree') {
      treeEl.hidden = true;
      jsonEl.hidden = false;
      toggleBtn.textContent = 'Show structured view';
      currentTraceView = 'json';
    } else {
      treeEl.hidden = false;
      jsonEl.hidden = true;
      toggleBtn.textContent = 'Show raw JSON';
      currentTraceView = 'tree';
    }
  }

  // ── Connection status ──────────────────────────────────────────────

  /**
   * Update the connection status indicator.
   * @param {'connected'|'reconnecting'|'disconnected'} state
   */
  function setConnectionStatus(state) {
    if (!connectionDot || !connectionLabel) return;
    connectionDot.className = 'connection-dot';
    if (lastConnectionState !== state) {
      lastConnectionState = state;
      addLogEntry(renderSystemEntry({
        message: 'Connection ' + state,
        timestamp: Date.now()
      }));
    }
    if (state === 'connected') {
      connectionDot.classList.add('connection-connected');
      connectionLabel.textContent = 'Connected';
    } else if (state === 'reconnecting') {
      connectionDot.classList.add('connection-reconnecting', 'status-dot-pulse');
      connectionLabel.textContent = 'Reconnecting…';
    } else {
      connectionDot.classList.add('connection-disconnected');
      connectionLabel.textContent = 'Disconnected';
    }
  }

  // ── Render agent cards ─────────────────────────────────────────────

  /**
   * Render agent cards from state data.
   * @param {Array} agents - Array of AgentState objects.
   */
  function renderAgentCards(agents) {
    if (!agentCardsContainer) return;

    // Remove skeleton cards on first update
    if (!hasReceivedFirstUpdate) {
      hasReceivedFirstUpdate = true;
      var skeletons = agentCardsContainer.querySelectorAll('.skeleton');
      skeletons.forEach(function (el) { el.remove(); });
    }

    // Empty state
    if (!agents || agents.length === 0) {
      agentCardsContainer.innerHTML = '';
      var emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.style.gridColumn = '1 / -1';
      emptyDiv.textContent = 'Activity will appear here when agents start.';
      agentCardsContainer.appendChild(emptyDiv);
      updateFooterAgents(0);
      updateActivityEmptyState(true);
      return;
    }

    agentCardsContainer.innerHTML = '';
    updateActivityEmptyState(false);

    agents.forEach(function (agent) {
      var card = document.createElement('button');
      card.className = 'agent-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('data-agent-id', String(agent.agentId));
      card.setAttribute('aria-label', agent.name + ', ' + agent.status + ', ' + formatSol(agent.balance));

      if (selectedAgentId === agent.agentId) {
        card.classList.add('selected');
      }

      // Card header: name + status
      var header = document.createElement('div');
      header.className = 'card-header';

      var nameSpan = document.createElement('span');
      nameSpan.className = 'agent-name font-sans';
      nameSpan.textContent = agent.name;

      var statusIndicator = document.createElement('span');
      statusIndicator.className = 'status-indicator';

      var dot = document.createElement('span');
      dot.className = 'status-dot ' + statusDotClass(agent.status);
      dot.setAttribute('aria-hidden', 'true');
      if (agent.status === 'active') {
        dot.classList.add('status-dot-pulse');
      }

      var label = document.createElement('span');
      label.className = 'status-label';
      label.textContent = agent.status;

      statusIndicator.appendChild(dot);
      statusIndicator.appendChild(label);
      header.appendChild(nameSpan);
      header.appendChild(statusIndicator);

      // Strategy
      var strategyDiv = document.createElement('div');
      strategyDiv.className = 'strategy-label font-sans';
      strategyDiv.textContent = agent.strategy || '—';

      // Balance
      var balanceDiv = document.createElement('div');
      balanceDiv.className = 'balance font-mono';
      balanceDiv.textContent = formatSol(agent.balance);

      // Last action
      var lastActionDiv = document.createElement('div');
      lastActionDiv.className = 'last-action';

      var actionType = document.createElement('span');
      actionType.className = 'action-type';
      if (agent.lastAction && agent.lastTradeAmount) {
        actionType.textContent = agent.lastAction + ' ' + agent.lastTradeAmount.toFixed(2) + ' SOL';
      } else if (agent.lastAction) {
        actionType.textContent = agent.lastAction;
      } else {
        actionType.textContent = '—';
      }

      var actionTime = document.createElement('span');
      actionTime.className = 'action-time font-mono';
      actionTime.textContent = formatRelativeTime(agent.lastActionTimestamp);
      actionTime.title = formatAbsoluteTime(agent.lastActionTimestamp);

      lastActionDiv.appendChild(actionType);
      lastActionDiv.appendChild(actionTime);

      // Assemble card
      card.appendChild(header);
      card.appendChild(strategyDiv);
      card.appendChild(balanceDiv);
      card.appendChild(lastActionDiv);

      // Click handler — select card
      card.addEventListener('click', function () {
        selectAgent(agent.agentId);
      });

      agentCardsContainer.appendChild(card);
    });

    updateFooterAgents(agents.length);
  }

  /**
   * Select an agent card and dispatch custom event.
   * @param {number} agentId
   */
  function selectAgent(agentId) {
    selectedAgentId = agentId;

    // Update selected visual
    var cards = agentCardsContainer.querySelectorAll('.agent-card');
    cards.forEach(function (card) {
      if (Number(card.getAttribute('data-agent-id')) === agentId) {
        card.classList.add('selected');
        card.classList.add('border-accent-blue');
      } else {
        card.classList.remove('selected');
        card.classList.remove('border-accent-blue');
      }
    });

    // Dispatch custom event for trace panel
    document.dispatchEvent(new CustomEvent('agent-selected', { detail: { agentId: agentId } }));
  }

  // ── Footer updates ─────────────────────────────────────────────────

  function updateFooterAgents(count) {
    if (footerAgents) footerAgents.textContent = count + ' agent' + (count !== 1 ? 's' : '');
  }

  function updateUptime() {
    if (!footerUptime) return;
    var secs = Math.floor((Date.now() - startTime) / 1000);
    footerUptime.textContent = '↑ ' + formatDuration(secs);
  }

  function updateCountdown() {
    if (!footerCountdown || !lastTickTimestamp) {
      if (footerCountdown) footerCountdown.textContent = 'Next: —';
      return;
    }
    var elapsed = Math.floor((Date.now() - lastTickTimestamp) / 1000);
    var remaining = Math.max(0, 60 - elapsed);
    footerCountdown.textContent = 'Next: ' + remaining + 's';
  }

  // Start uptime + countdown timer
  uptimeInterval = setInterval(function () {
    updateUptime();
    updateCountdown();
  }, 1000);
  updateUptime();
  setConnectionStatus('reconnecting');

  function updateActivityEmptyState(show) {
    if (!activityLog) return;
    var existing = activityLog.querySelector('.empty-state');
    if (show) {
      if (!existing) {
        var empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'Activity will appear here when agents start.';
        activityLog.innerHTML = '';
        activityLog.appendChild(empty);
      }
    } else if (existing) {
      existing.remove();
    }
  }

  // ── Toast Notifications ──────────────────────────────────────────

  /**
   * Show a toast notification.
   * @param {'success'|'error'|'info'} type
   * @param {string} message
   */
  function showToast(type, message) {
    if (!toastContainer) return;

    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    var icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';
    toast.appendChild(icon);

    var text = document.createElement('span');
    text.className = 'toast-message';
    text.textContent = message;
    toast.appendChild(text);

    if (type === 'error') {
      var dismiss = document.createElement('button');
      dismiss.className = 'toast-dismiss';
      dismiss.textContent = '✕';
      dismiss.setAttribute('aria-label', 'Dismiss');
      dismiss.addEventListener('click', function () { toast.remove(); });
      toast.appendChild(dismiss);
    }

    // Max 3 visible — remove oldest
    while (toastContainer.children.length >= 3) {
      toastContainer.removeChild(toastContainer.firstChild);
    }

    toastContainer.appendChild(toast);

    // Auto-dismiss for non-error types
    if (type !== 'error') {
      var duration = type === 'success' ? 3000 : 5000;
      setTimeout(function () {
        if (toast.parentNode) { toast.remove(); }
      }, duration);
    }
  }

  // ── Market Control Handlers ─────────────────────────────────────

  function onMarketDip() {
    if (btnDip) btnDip.disabled = true;
    fetch('/api/market/dip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ percent: 5 })
    }).then(function (res) {
      if (btnDip) btnDip.disabled = false;
      if (res.ok) {
        showToast('success', 'Market dip injected (-5%)');
      } else {
        showToast('error', 'Failed to inject market dip');
      }
    }).catch(function () {
      if (btnDip) btnDip.disabled = false;
      showToast('error', 'Network error — could not reach server');
    });
  }

  function onMarketRally() {
    if (btnRally) btnRally.disabled = true;
    fetch('/api/market/rally', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ percent: 10 })
    }).then(function (res) {
      if (btnRally) btnRally.disabled = false;
      if (res.ok) {
        showToast('success', 'Market rally injected (+10%)');
      } else {
        showToast('error', 'Failed to inject market rally');
      }
    }).catch(function () {
      if (btnRally) btnRally.disabled = false;
      showToast('error', 'Network error — could not reach server');
    });
  }

  function onMarketReset() {
    if (btnReset) btnReset.disabled = true;
    fetch('/api/market/reset', {
      method: 'POST'
    }).then(function (res) {
      if (btnReset) btnReset.disabled = false;
      if (res.ok) {
        showToast('success', 'Market reset to baseline');
      } else {
        showToast('error', 'Failed to reset market');
      }
    }).catch(function () {
      if (btnReset) btnReset.disabled = false;
      showToast('error', 'Network error — could not reach server');
    });
  }

  // ── SSE connection ─────────────────────────────────────────────────

  var eventSource = new EventSource('/events');

  eventSource.onopen = function () {
    errorCount = 0;
    setConnectionStatus('connected');
  };

  eventSource.onerror = function () {
    errorCount++;
    if (errorCount >= MAX_ERRORS) {
      setConnectionStatus('disconnected');
    } else {
      setConnectionStatus('reconnecting');
    }
  };

  // Primary: agent state updates + trade detection
  eventSource.addEventListener('stateUpdate', function (e) {
    var data = JSON.parse(e.data);
    if (data.agents) {
      lastAgentsData = data.agents;
      renderAgentCards(data.agents);

      // Trade detection: check each agent for new trades
      data.agents.forEach(function (agent) {
        if (isNewTrade(agent)) {
          var tradeData = extractTradeData(agent);
          var entry = renderTradeEntry(tradeData);
          addLogEntry(entry);
        }
      });
    }
    if (data.timestamp) {
      lastTickTimestamp = data.timestamp;
    }
  });

  // System events: lifecycle + hot-reload
  eventSource.addEventListener('systemEvent', function (e) {
    var data = JSON.parse(e.data);

    if (data.type === 'lifecycle') {
      var message = 'Agent ' + (data.agentId || '?') + ' ' + (data.event || 'unknown');
      if (data.message) {
        message += ': ' + data.message;
      }
      var entry = renderSystemEntry({
        event: data.event,
        agentId: data.agentId,
        message: message,
        timestamp: data.timestamp
      });
      addLogEntry(entry);
    } else if (data.type === 'hotReload') {
      var hrEntry = renderHotReloadEntry({
        fileName: data.fileName,
        success: data.success,
        error: data.error,
        timestamp: data.timestamp
      });
      addLogEntry(hrEntry);
    }
  });

  // Market data updates — price display with colored change
  eventSource.addEventListener('marketUpdate', function (e) {
    var data = JSON.parse(e.data);
    if (data.marketData && marketPrice) {
      var price = data.marketData.price;
      var change = data.marketData.priceChange1m;
      var sign = change >= 0 ? '+' : '';
      // Clear existing content
      while (marketPrice.firstChild) { marketPrice.removeChild(marketPrice.firstChild); }
      // Price text
      var priceText = document.createTextNode('SOL/USD: $' + price.toFixed(2) + ' (');
      marketPrice.appendChild(priceText);
      // Colored change span
      var changeSpan = document.createElement('span');
      changeSpan.textContent = sign + change.toFixed(1) + '%';
      changeSpan.style.color = change >= 0 ? 'var(--status-success)' : 'var(--status-danger)';
      marketPrice.appendChild(changeSpan);
      marketPrice.appendChild(document.createTextNode(')'));
    }
  });

  // Connection mode changes — DEVNET / DEVNET (fallback) / SIMULATION MODE
  eventSource.addEventListener('modeChange', function (e) {
    var data = JSON.parse(e.data);
    if (!modeBadge) return;
    if (data.active) {
      modeBadge.textContent = 'SIMULATION MODE';
      modeBadge.style.color = 'var(--status-danger)';
      modeBadge.style.borderColor = 'var(--status-danger)';
    } else if (data.reason && data.reason.indexOf('fallback') !== -1) {
      modeBadge.textContent = 'DEVNET (fallback)';
      modeBadge.style.color = 'var(--status-warning)';
      modeBadge.style.borderColor = 'var(--status-warning)';
    } else {
      modeBadge.textContent = 'DEVNET';
      modeBadge.style.color = 'var(--status-success)';
      modeBadge.style.borderColor = 'var(--status-success)';
    }
  });

  // ── Keyboard: Escape closes trace panel ────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (tracePanel && !tracePanel.hidden) {
        closeTracePanel();
      }
    }
  });

  // ── Trace panel event listeners ───────────────────────────────────
  document.addEventListener('trace-selected', function (e) {
    openTracePanel(e.detail);
  });

  document.addEventListener('agent-selected', function (e) {
    var agentId = e.detail.agentId;
    var agent = lastAgentsData.find(function (a) { return a.agentId === agentId; });
    if (agent && agent.lastDecision) {
      openTracePanel(agent.lastDecision);
    }
  });

  // ── Market control button wiring ───────────────────────────────
  if (btnDip) btnDip.addEventListener('click', onMarketDip);
  if (btnRally) btnRally.addEventListener('click', onMarketRally);
  if (btnReset) btnReset.addEventListener('click', onMarketReset);

})();
