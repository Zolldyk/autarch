import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createServer } from '../src/server.js';

const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');

describe('Dashboard static files', () => {
  describe('Task 1: styles.css — CSS design tokens and base styles (AC2, AC8)', () => {
    let css: string;

    beforeAll(() => {
      css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf-8');
    });

    it('should define all background design tokens', () => {
      expect(css).toContain('--bg-primary:');
      expect(css).toContain('--bg-secondary:');
      expect(css).toContain('--bg-tertiary:');
    });

    it('should define all text design tokens', () => {
      expect(css).toContain('--text-primary:');
      expect(css).toContain('--text-secondary:');
      expect(css).toContain('--text-tertiary:');
    });

    it('should define accent tokens', () => {
      expect(css).toContain('--accent-blue:');
      expect(css).toContain('--accent-blue-hover:');
    });

    it('should define status tokens', () => {
      expect(css).toContain('--status-success:');
      expect(css).toContain('--status-warning:');
      expect(css).toContain('--status-danger:');
      expect(css).toContain('--status-info:');
    });

    it('should define border tokens', () => {
      expect(css).toContain('--border-subtle:');
      expect(css).toContain('--border-default:');
    });

    it('should define code tokens', () => {
      expect(css).toContain('--code-bg:');
      expect(css).toContain('--code-text:');
    });

    it('should set body min-width to 1024px', () => {
      expect(css).toContain('min-width: 1024px');
    });

    it('should set body background and text from tokens', () => {
      expect(css).toContain('var(--bg-primary)');
      expect(css).toContain('var(--text-primary)');
    });

    it('should define .font-mono and .font-sans utility classes', () => {
      expect(css).toContain('.font-mono');
      expect(css).toContain('.font-sans');
    });

    it('should define status dot styles with 8px size', () => {
      expect(css).toContain('.status-dot');
      expect(css).toMatch(/8px/);
    });

    it('should define status dot pulse animation', () => {
      expect(css).toContain('.status-dot-pulse');
      expect(css).toContain('@keyframes');
    });

    it('should include prefers-reduced-motion media query', () => {
      expect(css).toContain('prefers-reduced-motion: reduce');
    });

    it('should preserve focus-visible outlines', () => {
      expect(css).toContain(':focus-visible');
      expect(css).toContain('var(--accent-blue)');
    });

    it('should define skeleton pulse animation', () => {
      expect(css).toContain('.skeleton-pulse');
    });

    it('should define animation speed variables', () => {
      expect(css).toContain('--speed-fast:');
      expect(css).toContain('--speed-normal:');
      expect(css).toContain('--speed-slow:');
    });

    it('should define connection status indicator styles', () => {
      expect(css).toContain('.connection-status');
    });

    it('should define .agent-card.selected with accent-blue border (AC6)', () => {
      expect(css).toContain('.agent-card.selected');
      expect(css).toContain('var(--accent-blue)');
    });

    it('should define .border-accent-blue class (AC6)', () => {
      expect(css).toContain('.border-accent-blue');
    });

    it('should define status color mappings for all 5 states (AC5)', () => {
      expect(css).toContain('.status-active');
      expect(css).toContain('.status-idle');
      expect(css).toContain('.status-cooldown');
      expect(css).toContain('.status-error');
      expect(css).toContain('.status-stopped');
    });

    it('should define live-dot indicator style (AC3)', () => {
      expect(css).toContain('.live-dot');
    });

    it('should define empty-state styles (AC12)', () => {
      expect(css).toContain('.empty-state');
    });

    it('should not contain hardcoded hex values outside :root', () => {
      // Split CSS into :root block and rest
      const rootMatch = css.match(/:root\s*\{[^}]+\}/s);
      const rootBlock = rootMatch ? rootMatch[0] : '';
      const restOfCss = css.replace(rootBlock, '');
      // Outside :root, no standalone hex color values (allow in comments and keyframe names)
      const lines = restOfCss.split('\n').filter(line => !line.trim().startsWith('/*') && !line.trim().startsWith('*'));
      const hexPattern = /#[0-9a-fA-F]{3,8}\b/;
      const violatingLines = lines.filter(line => hexPattern.test(line));
      expect(violatingLines).toEqual([]);
    });
  });

  describe('Task 2: index.html — Dashboard HTML structure (AC1, AC3, AC7, AC9)', () => {
    let html: string;

    beforeAll(() => {
      html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');
    });

    it('should be a valid HTML5 document with meta tags', () => {
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<meta charset');
      expect(html).toContain('<meta name="viewport"');
      expect(html).toContain('<title>Autarch Dashboard</title>');
    });

    it('should load Tailwind v4 browser CDN', () => {
      expect(html).toContain('cdn.jsdelivr.net/npm/@tailwindcss/browser@4');
    });

    it('should load Google Fonts: Inter and JetBrains Mono', () => {
      expect(html).toContain('fonts.googleapis.com');
      expect(html).toContain('Inter');
      expect(html).toContain('JetBrains+Mono');
    });

    it('should link styles.css', () => {
      expect(html).toContain('styles.css');
    });

    it('should have semantic HTML structure: header, main, footer', () => {
      expect(html).toContain('<header');
      expect(html).toContain('<main');
      expect(html).toContain('<footer');
    });

    it('should have header with AUTARCH title, subtitle, live indicator, and devnet badge', () => {
      expect(html).toContain('AUTARCH');
      expect(html).toContain('Autonomous Agent Wallets');
      expect(html).toContain('live-dot');
      expect(html).toContain('LIVE');
      expect(html).toContain('devnet');
    });

    it('should have connection status indicator in header', () => {
      expect(html).toContain('connection-status');
      expect(html).toContain('connection-dot');
    });

    it('should have market controls section with aria-label', () => {
      expect(html).toContain('aria-label="Market Controls"');
    });

    it('should have agent cards section with CSS Grid and aria-label', () => {
      expect(html).toContain('aria-label="Agent Overview"');
      expect(html).toContain('grid-template-columns');
      expect(html).toContain('repeat(3, 1fr)');
    });

    it('should have 3 skeleton cards as initial loading state', () => {
      const skeletonCount = (html.match(/agent-card skeleton/g) || []).length;
      expect(skeletonCount).toBe(3);
    });

    it('should have activity log section with aria-live="polite"', () => {
      expect(html).toContain('aria-label="Activity Log"');
      expect(html).toContain('aria-live="polite"');
    });

    it('should have trace panel section initially hidden', () => {
      expect(html).toContain('id="trace-panel"');
      expect(html).toContain('aria-label="Reasoning Trace"');
      expect(html).toContain('hidden');
    });

    it('should have footer with version, network, agent count, uptime, and cycle countdown', () => {
      expect(html).toContain('id="footer-version"');
      expect(html).toContain('id="footer-agents"');
      expect(html).toContain('id="footer-uptime"');
      expect(html).toContain('id="footer-countdown"');
    });

    it('should load app.js with defer', () => {
      expect(html).toMatch(/src=["']app\.js["'][\s\S]*?defer/i);
    });

    it('should use max-w-6xl mx-auto for centering', () => {
      expect(html).toContain('max-w-6xl');
      expect(html).toContain('mx-auto');
    });

    it('should have skeleton cards with aria-hidden for accessibility (AC11)', () => {
      expect(html).toContain('aria-hidden="true"');
    });

    it('should have market control buttons with aria-labels (AC9)', () => {
      expect(html).toContain('aria-label="Simulate market dip"');
      expect(html).toContain('aria-label="Simulate market rally"');
      expect(html).toContain('aria-label="Reset market"');
    });

    it('should have trace panel with role="region" (AC6)', () => {
      expect(html).toContain('role="region"');
      expect(html).toContain('aria-label="Reasoning Trace"');
    });

    it('should have mode badge element (AC10)', () => {
      expect(html).toContain('id="mode-badge"');
    });

    it('should have market price display element', () => {
      expect(html).toContain('id="market-price"');
    });
  });

  describe('Task 3: app.js — Dashboard JavaScript (AC4, AC5, AC6, AC10, AC11, AC12)', () => {
    let js: string;

    beforeAll(() => {
      js = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf-8');
    });

    it('should create EventSource connection to /events', () => {
      expect(js).toContain('EventSource');
      expect(js).toContain('/events');
    });

    it('should handle connection states: open, error', () => {
      expect(js).toContain('.onopen');
      expect(js).toContain('.onerror');
    });

    it('should listen for stateUpdate events', () => {
      expect(js).toContain("addEventListener('stateUpdate'");
    });

    it('should have renderAgentCards function', () => {
      expect(js).toContain('renderAgentCards');
    });

    it('should render status dot variants: active, cooldown, idle, error, stopped', () => {
      expect(js).toContain('status-active');
      expect(js).toContain('status-cooldown');
      expect(js).toContain('status-idle');
      expect(js).toContain('status-error');
      expect(js).toContain('status-stopped');
    });

    it('should add pulse class only for active status', () => {
      expect(js).toContain('status-dot-pulse');
    });

    it('should handle agent card click/selection', () => {
      expect(js).toContain('selected');
      expect(js).toContain('agent-selected');
    });

    it('should format relative timestamps', () => {
      expect(js).toContain('just now');
      expect(js).toContain('ago');
    });

    it('should format SOL balance to 2 decimal places', () => {
      expect(js).toContain('toFixed(2)');
    });

    it('should update footer: agent count, uptime, countdown', () => {
      expect(js).toContain('footer-agents');
      expect(js).toContain('footer-uptime');
      expect(js).toContain('footer-countdown');
    });

    it('should handle loading → populated transition', () => {
      // On first stateUpdate, skeleton cards should be replaced
      expect(js).toContain('skeleton');
    });

    it('should handle empty state when no agents', () => {
      expect(js).toContain('Activity will appear here when agents start');
    });

    it('should format addresses as first 4 + last 4 with ellipsis', () => {
      expect(js).toMatch(/\.slice\(0,\s*4\)/);
      expect(js).toContain('...');
    });

    it('should have systemEvent listener stub', () => {
      expect(js).toContain("addEventListener('systemEvent'");
    });

    it('should have marketUpdate listener stub', () => {
      expect(js).toContain("addEventListener('marketUpdate'");
    });

    it('should have modeChange listener stub', () => {
      expect(js).toContain("addEventListener('modeChange'");
    });

    it('should update connection status indicator', () => {
      expect(js).toContain('connection-connected');
      expect(js).toContain('connection-reconnecting');
      expect(js).toContain('connection-disconnected');
    });

    it('should use textContent instead of innerHTML for user data (XSS prevention)', () => {
      // Should use textContent for setting agent names, balances, etc.
      expect(js).toContain('textContent');
      // innerHTML should only be used for card templates with static structure, not user data
    });

    it('should set aria-label on agent cards', () => {
      expect(js).toContain('aria-label');
    });

    it('should set title attribute for absolute timestamp on hover', () => {
      expect(js).toContain('.title');
    });

    it('should set border-accent-blue class on selected card (AC6)', () => {
      expect(js).toContain('border-accent-blue');
    });

    it('should dispatch agent-selected custom event (AC6)', () => {
      expect(js).toContain("'agent-selected'");
      expect(js).toContain('CustomEvent');
    });

    it('should open trace panel when agent is selected (AC6)', () => {
      expect(js).toContain('tracePanel');
      expect(js).toContain('tracePanel.hidden = false');
    });

    it('should close trace panel on Escape key (AC9)', () => {
      expect(js).toContain("e.key === 'Escape'");
      expect(js).toContain('tracePanel.hidden = true');
    });

    it('should set role="button" and tabindex on agent cards (AC9)', () => {
      expect(js).toContain("'role', 'button'");
      expect(js).toContain("'tabindex', '0'");
    });

    it('should set data-agent-id attribute on cards', () => {
      expect(js).toContain("'data-agent-id'");
    });

    it('should mark status dots as aria-hidden for accessibility (AC5)', () => {
      expect(js).toContain("'aria-hidden', 'true'");
    });

    it('should render text status label alongside dot for WCAG 1.4.1 (AC5)', () => {
      expect(js).toContain('status-label');
    });

    it('should display lastTradeAmount with balance when present (AC4)', () => {
      expect(js).toContain('lastTradeAmount');
      expect(js).toContain("agent.lastAction + ' ' + agent.lastTradeAmount.toFixed(2)");
    });

    it('should implement MAX_ERRORS threshold for connection status (AC10)', () => {
      expect(js).toContain('MAX_ERRORS');
      expect(js).toContain('errorCount >= MAX_ERRORS');
    });

    it('should reset error count on successful connection (AC10)', () => {
      expect(js).toContain('errorCount = 0');
    });

    it('should update market price display from marketUpdate events (AC10)', () => {
      expect(js).toContain('marketPrice');
      expect(js).toContain('data.marketData.price');
    });

    it('should update mode badge from modeChange events (AC10)', () => {
      expect(js).toContain('modeBadge');
      expect(js).toContain('SIMULATION MODE');
    });

    it('should format uptime as HH:MM:SS', () => {
      expect(js).toContain('formatDuration');
      expect(js).toContain("padStart(2, '0')");
    });

    it('should format absolute time for title attribute (AC4)', () => {
      expect(js).toContain('formatAbsoluteTime');
      expect(js).toContain('toISOString');
    });

    it('should remove skeleton cards only on first stateUpdate (AC11)', () => {
      expect(js).toContain('hasReceivedFirstUpdate');
      expect(js).toContain('.skeleton');
    });
  });

  describe('Task 4: Integration wiring and testing (all ACs)', () => {
    function createMockRuntime(): EventEmitter & {
      injectDip: ReturnType<typeof vi.fn>;
      injectRally: ReturnType<typeof vi.fn>;
      resetMarket: ReturnType<typeof vi.fn>;
      getStates: ReturnType<typeof vi.fn>;
    } {
      const emitter = new EventEmitter();
      return Object.assign(emitter, {
        injectDip: vi.fn(),
        injectRally: vi.fn(),
        resetMarket: vi.fn(),
        getStates: vi.fn().mockReturnValue([]),
      });
    }

    function httpGet(port: number, urlPath: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
      return new Promise((resolve, reject) => {
        http.get({ hostname: '127.0.0.1', port, path: urlPath }, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: data }));
        }).on('error', reject);
      });
    }

    let server: http.Server;
    let port: number;
    let runtime: ReturnType<typeof createMockRuntime>;

    beforeEach(async () => {
      runtime = createMockRuntime();
      const { app } = createServer({ runtime: runtime as never, port: 0 });
      server = app.listen(0);
      await new Promise<void>((r) => server.on('listening', r));
      port = (server.address() as { port: number }).port;
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('4.1: express.static() serves index.html at GET /', async () => {
      const res = await httpGet(port, '/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('<!DOCTYPE html>');
      expect(res.body).toContain('Autarch Dashboard');
    });

    it('4.1: serves styles.css', async () => {
      const res = await httpGet(port, '/styles.css');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/css/);
      expect(res.body).toContain('--bg-primary');
    });

    it('4.1: serves app.js', async () => {
      const res = await httpGet(port, '/app.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/javascript/);
      expect(res.body).toContain('EventSource');
    });

    it('4.7: HTML has no broken internal references', () => {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');
      // All local file references should exist
      const srcMatches = html.match(/(?:src|href)="([^"]+)"/g) || [];
      const localRefs = srcMatches
        .map(m => m.match(/="([^"]+)"/)?.[1] || '')
        .filter(ref => !ref.startsWith('http') && !ref.startsWith('//') && ref.length > 0);

      for (const ref of localRefs) {
        expect(fs.existsSync(path.join(PUBLIC_DIR, ref)), `Missing file: ${ref}`).toBe(true);
      }
    });

    it('4.8: styles.css has prefers-reduced-motion disabling all animations', () => {
      const css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf-8');
      expect(css).toContain('prefers-reduced-motion: reduce');
      expect(css).toContain('animation-duration: 0ms');
      expect(css).toContain('transition-duration: 0ms');
    });

    it('4.9: all 3 public files exist', () => {
      expect(fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(PUBLIC_DIR, 'styles.css'))).toBe(true);
      expect(fs.existsSync(path.join(PUBLIC_DIR, 'app.js'))).toBe(true);
    });
  });

  describe('Story 4.3: Activity Log — CSS Styles (AC1-5)', () => {
    let css: string;

    beforeAll(() => {
      css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf-8');
    });

    it('1.1: should define .log-entry base styles with border-bottom and transition', () => {
      expect(css).toContain('.log-entry');
      expect(css).toContain('var(--border-subtle)');
      expect(css).toContain('var(--speed-fast)');
    });

    it('1.2: should define .log-entry-trade clickable variant with cursor pointer and hover', () => {
      expect(css).toContain('.log-entry-trade');
      expect(css).toContain('cursor: pointer');
    });

    it('1.3: should define .log-entry-trade.selected with code-bg background', () => {
      expect(css).toContain('.log-entry-trade.selected');
      expect(css).toContain('var(--code-bg)');
    });

    it('1.4: should define .log-entry-hotreload with blue tint background', () => {
      expect(css).toContain('.log-entry-hotreload');
      expect(css).toContain('rgba(75, 158, 255, 0.05)');
    });

    it('1.5: should define .agent-tag pill styles with per-agent color variants', () => {
      expect(css).toContain('.agent-tag');
      expect(css).toContain('.agent-tag-1');
      expect(css).toContain('.agent-tag-2');
      expect(css).toContain('.agent-tag-3');
      expect(css).toContain('.agent-tag-system');
      expect(css).toContain('.agent-tag-hotreload');
    });

    it('1.6: should define .log-entry-line2 indented second-line styles', () => {
      expect(css).toContain('.log-entry-line2');
      expect(css).toContain('var(--text-tertiary)');
    });

    it('1.7: should define .tx-link styles with accent-blue and JetBrains Mono', () => {
      expect(css).toContain('.tx-link');
      expect(css).toContain('var(--accent-blue)');
    });

    it('1.8: should define @keyframes slideIn animation', () => {
      expect(css).toContain('@keyframes slideIn');
      expect(css).toContain('translateY(-10px)');
      expect(css).toContain('translateY(0)');
    });

    it('1.9: should define .log-entry-new class applying slideIn animation', () => {
      expect(css).toContain('.log-entry-new');
      expect(css).toContain('slideIn');
    });

    it('1.4 (exclusive): only .log-entry-hotreload should have a background tint', () => {
      // Verify the rgba tint only appears in the hotreload rule
      const rgbaTintMatches = css.match(/rgba\(75,\s*158,\s*255/g) || [];
      expect(rgbaTintMatches.length).toBe(1);
    });
  });

  describe('Story 4.3: Activity Log — JS Rendering (AC1-6)', () => {
    let js: string;

    beforeAll(() => {
      js = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf-8');
    });

    it('2.1: should have renderTradeEntry function building article with role and tabindex', () => {
      expect(js).toContain('renderTradeEntry');
      expect(js).toContain("'article'");
      expect(js).toContain("'role', 'article'");
      expect(js).toContain('log-entry-trade');
    });

    it('2.2: should have renderSystemEntry function with system tag', () => {
      expect(js).toContain('renderSystemEntry');
      expect(js).toContain('log-entry-system');
    });

    it('2.3: should have renderHotReloadEntry function with hotreload class', () => {
      expect(js).toContain('renderHotReloadEntry');
      expect(js).toContain('log-entry-hotreload');
    });

    it('2.4: should have addLogEntry function capping at 200 entries', () => {
      expect(js).toContain('addLogEntry');
      expect(js).toContain('200');
    });

    it('2.5: should wire stateUpdate listener for trade detection with deduplication', () => {
      expect(js).toContain('isNewTrade');
      expect(js).toContain('lastRenderedTradeTimestamp');
    });

    it('2.6: should replace systemEvent stub with full lifecycle and hotReload handler', () => {
      expect(js).not.toContain('void e;');
      expect(js).toContain('renderSystemEntry');
      expect(js).toContain('renderHotReloadEntry');
    });

    it('2.7: should handle trade entry click/keyboard with trace-selected event', () => {
      expect(js).toContain('trace-selected');
      expect(js).toContain('CustomEvent');
    });

    it('2.8: should have formatTxSignature helper creating Solana Explorer links', () => {
      expect(js).toContain('formatTxSignature');
      expect(js).toContain('explorer.solana.com');
      expect(js).toContain('noopener noreferrer');
    });

    it('2.9: should remove .log-entry-new class after animation completes', () => {
      expect(js).toContain('log-entry-new');
      expect(js).toContain('setTimeout');
    });

    it('2.5: should use textContent and createElement, never innerHTML for entries', () => {
      // Count innerHTML usage — should only appear in renderAgentCards + updateActivityEmptyState (pre-existing)
      const innerHTMLCount = (js.match(/\.innerHTML\s*=/g) || []).length;
      // Story 4.2 has 3 innerHTML usages (2 in renderAgentCards, 1 in updateActivityEmptyState). No new ones added.
      expect(innerHTMLCount).toBeLessThanOrEqual(3);
    });

    it('should use WeakMap for trace data storage, not data attributes', () => {
      expect(js).toContain('WeakMap');
      expect(js).toContain('entryTraceMap');
    });

    it('3.1: should extract trade data from stateUpdate agent lastDecision', () => {
      expect(js).toContain('lastDecision');
      expect(js).toContain("decision.action");
      expect(js).toContain("'none'");
    });

    it('3.2: should maintain per-agent lastTradeTimestamp for dedup', () => {
      expect(js).toContain('lastRenderedTradeTimestamp');
    });
  });

  describe('Story 4.3: Activity Log — Edge Cases & Behavioral Patterns', () => {
    let js: string;
    let css: string;

    beforeAll(() => {
      js = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf-8');
      css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf-8');
    });

    // ── Hot-Reload Failure Path (AC4) ──

    it('AC4: renderHotReloadEntry should handle failure case with error message', () => {
      // The function must branch on data.success to show failure text
      expect(js).toContain('data.success');
      expect(js).toContain('reload failed');
      expect(js).toContain('data.error');
    });

    it('AC4: renderHotReloadEntry should show U+27F2 unicode prefix for reload entries', () => {
      // ⟲ is U+27F2, stored as \\u27F2 escape in the JS source
      expect(js).toContain('\\u27F2');
    });

    it('AC4: renderHotReloadEntry should fall back to "unknown" when fileName is missing', () => {
      expect(js).toContain("data.fileName || 'unknown'");
    });

    // ── Trade Deduplication Logic (AC2) ──

    it('AC2: isNewTrade should reject when lastDecision is null', () => {
      // Must check for trace existence before accessing nested fields
      expect(js).toMatch(/if\s*\(\s*!trace\s*\)\s*return\s+false/);
    });

    it('AC2: isNewTrade should reject when action is none', () => {
      expect(js).toContain("action === 'none'");
    });

    it('AC2: isNewTrade should reject when execution is missing', () => {
      expect(js).toMatch(/if\s*\(\s*!trace\.execution\s*\)\s*return\s+false/);
    });

    it('AC2: isNewTrade should reject when timestamp is not newer', () => {
      expect(js).toContain('trace.timestamp <= lastTs');
    });

    it('AC2: isNewTrade should update lastRenderedTradeTimestamp on success', () => {
      // After passing all guards, must store the timestamp
      expect(js).toContain('lastRenderedTradeTimestamp[agent.agentId] = trace.timestamp');
    });

    // ── Agent Tag Color Cycling ──

    it('agent tag class should cycle through 3 colors using modulo', () => {
      // (agentId - 1) % 3 + 1 → cycles 1,2,3,1,2,3...
      expect(js).toContain('((agentId - 1) % 3) + 1');
    });

    // ── extractTradeData Edge Cases (AC2) ──

    it('extractTradeData should handle empty evaluations array gracefully', () => {
      // Must check evaluations length before reducing
      expect(js).toContain('trace.evaluations && trace.evaluations.length > 0');
    });

    it('extractTradeData should fall back to "Manual" trigger when no evaluations', () => {
      expect(js).toContain("'Manual'");
    });

    it('extractTradeData should default amount to 0 when missing', () => {
      expect(js).toContain('trace.decision.amount || 0');
    });

    it('extractTradeData should select highest-scoring rule via reduce', () => {
      expect(js).toContain('ev.score > best.score');
    });

    // ── formatTxSignature Security (AC2) ──

    it('AC2: formatTxSignature should use devnet cluster parameter', () => {
      expect(js).toContain('?cluster=devnet');
    });

    it('AC2: formatTxSignature should set target=_blank and rel=noopener noreferrer', () => {
      expect(js).toContain("a.target = '_blank'");
      expect(js).toContain("a.rel = 'noopener noreferrer'");
    });

    it('AC2: formatTxSignature should truncate to first 4 + ... + last 4', () => {
      expect(js).toContain('sig.slice(0, 4)');
      expect(js).toContain('sig.slice(-4)');
    });

    it('AC2: formatTxSignature should set aria-label for accessibility', () => {
      expect(js).toContain("'View transaction ' + truncated + ' in Solana Explorer'");
    });

    // ── addLogEntry Behavior (AC1, AC5) ──

    it('AC1: addLogEntry should prepend entries (newest first)', () => {
      expect(js).toContain('activityLog.insertBefore(element, activityLog.firstChild)');
    });

    it('AC1: addLogEntry should remove empty state before adding first entry', () => {
      expect(js).toContain(".querySelector('.empty-state')");
      expect(js).toContain('emptyState.remove()');
    });

    it('AC5: addLogEntry should remove log-entry-new class after 200ms timeout', () => {
      // setTimeout with 200ms for animation cleanup
      expect(js).toMatch(/setTimeout\(function\s*\(\)\s*\{[^}]*log-entry-new/s);
      expect(js).toContain('}, 200)');
    });

    it('AC1: addLogEntry should cap entries using LOG_MAX_ENTRIES constant', () => {
      expect(js).toContain('LOG_MAX_ENTRIES');
      expect(js).toContain('var LOG_MAX_ENTRIES = 200');
    });

    it('AC1: addLogEntry should remove oldest entries when exceeding cap', () => {
      expect(js).toContain('entries.length > LOG_MAX_ENTRIES');
      expect(js).toContain('oldest.remove()');
    });

    // ── Keyboard Accessibility (AC6) ──

    it('AC6: trade entries should respond to Enter and Space key', () => {
      expect(js).toContain("e.key === 'Enter'");
      expect(js).toContain("e.key === ' '");
      expect(js).toContain('e.preventDefault()');
    });

    it('AC6: selecting a trade entry should remove selection from previous entry', () => {
      expect(js).toContain("selectedTradeEntry.classList.remove('selected')");
    });

    it('AC6: selecting a trade entry should dispatch trace-selected CustomEvent with detail', () => {
      expect(js).toContain("new CustomEvent('trace-selected', { detail: trace })");
    });

    // ── Connection Status → System Log Entries ──

    it('connection state changes should render system log entries', () => {
      // setConnectionStatus should call addLogEntry(renderSystemEntry(...))
      expect(js).toContain("addLogEntry(renderSystemEntry({");
      expect(js).toContain("'Connection ' + state");
    });

    it('connection state changes should deduplicate via lastConnectionState', () => {
      expect(js).toContain('lastConnectionState !== state');
      expect(js).toContain('lastConnectionState = state');
    });

    // ── systemEvent Listener Dispatch (AC3, AC4) ──

    it('AC3: systemEvent listener should handle lifecycle type', () => {
      expect(js).toContain("data.type === 'lifecycle'");
    });

    it('AC4: systemEvent listener should handle hotReload type', () => {
      expect(js).toContain("data.type === 'hotReload'");
    });

    it('AC3: lifecycle event should compose message with agentId and event', () => {
      expect(js).toContain("'Agent ' + (data.agentId || '?')");
      expect(js).toContain("(data.event || 'unknown')");
    });

    it('AC3: lifecycle event should append error message when present', () => {
      expect(js).toContain("if (data.message)");
    });

    // ── stateUpdate Listener Trade Detection (AC2) ──

    it('AC2: stateUpdate listener should iterate agents for trade detection', () => {
      expect(js).toContain('data.agents.forEach');
      expect(js).toContain('isNewTrade(agent)');
    });

    it('AC2: stateUpdate listener should extract and render trade data', () => {
      expect(js).toContain('extractTradeData(agent)');
      expect(js).toContain('renderTradeEntry(tradeData)');
      expect(js).toContain('addLogEntry(entry)');
    });

    // ── CSS Structural Checks ──

    it('CSS: .log-entry-trade should have hover state with bg-tertiary', () => {
      expect(css).toContain('.log-entry-trade:hover');
      expect(css).toContain('var(--bg-tertiary)');
    });

    it('CSS: .tx-link should have hover underline', () => {
      expect(css).toContain('.tx-link:hover');
      expect(css).toContain('text-decoration: underline');
    });

    it('CSS: .agent-tag should use 0.75rem font-size and 4px border-radius', () => {
      // Parse the .agent-tag block
      const tagMatch = css.match(/\.agent-tag\s*\{[^}]+\}/);
      expect(tagMatch).not.toBeNull();
      expect(tagMatch![0]).toContain('0.75rem');
      expect(tagMatch![0]).toContain('border-radius: 4px');
    });

    it('CSS: agent tag color variants use correct design tokens', () => {
      expect(css).toContain('.agent-tag-1');
      // Agent 1 uses status-success bg
      const tag1Match = css.match(/\.agent-tag-1\s*\{[^}]+\}/);
      expect(tag1Match).not.toBeNull();
      expect(tag1Match![0]).toContain('var(--status-success)');

      // Agent 2 uses accent-blue bg
      const tag2Match = css.match(/\.agent-tag-2\s*\{[^}]+\}/);
      expect(tag2Match).not.toBeNull();
      expect(tag2Match![0]).toContain('var(--accent-blue)');

      // Agent 3 uses status-warning bg
      const tag3Match = css.match(/\.agent-tag-3\s*\{[^}]+\}/);
      expect(tag3Match).not.toBeNull();
      expect(tag3Match![0]).toContain('var(--status-warning)');
    });

    it('CSS: system tag uses text-tertiary color without background', () => {
      const systemMatch = css.match(/\.agent-tag-system\s*\{[^}]+\}/);
      expect(systemMatch).not.toBeNull();
      expect(systemMatch![0]).toContain('var(--text-tertiary)');
      expect(systemMatch![0]).not.toContain('background');
    });

    it('CSS: hotreload tag uses accent-blue color without background', () => {
      const hrMatch = css.match(/\.agent-tag-hotreload\s*\{[^}]+\}/);
      expect(hrMatch).not.toBeNull();
      expect(hrMatch![0]).toContain('var(--accent-blue)');
      expect(hrMatch![0]).not.toContain('background');
    });

    it('CSS: slideIn animation uses ease-out timing via speed-normal variable', () => {
      const logEntryNewMatch = css.match(/\.log-entry-new\s*\{[^}]+\}/);
      expect(logEntryNewMatch).not.toBeNull();
      expect(logEntryNewMatch![0]).toContain('var(--speed-normal)');
      expect(logEntryNewMatch![0]).toContain('ease-out');
    });

    it('CSS: no hardcoded hex values outside :root', () => {
      // This test exists in Story 4.2 block but re-verify after 4.3 additions
      const rootMatch = css.match(/:root\s*\{[^}]+\}/s);
      const rootBlock = rootMatch ? rootMatch[0] : '';
      const restOfCss = css.replace(rootBlock, '');
      const lines = restOfCss.split('\n').filter(line => !line.trim().startsWith('/*') && !line.trim().startsWith('*'));
      const hexPattern = /#[0-9a-fA-F]{3,8}\b/;
      const violatingLines = lines.filter(line => hexPattern.test(line));
      expect(violatingLines).toEqual([]);
    });

    // ── Accessibility (AC1) ──

    it('AC1: activity log container should have aria-live="polite"', () => {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');
      expect(html).toContain('id="activity-log"');
      expect(html).toContain('aria-live="polite"');
    });

    it('AC1: renderTradeEntry should set aria-label with agent name, action, amount, and time', () => {
      expect(js).toContain("data.agentName + ' ' + data.action + ' ' + data.amount.toFixed(2) + ' SOL, ' + formatRelativeTime(data.timestamp)");
    });

    // ── XSS Prevention ──

    it('renderTradeEntry should use textContent for all user-facing strings', () => {
      // Extract the renderTradeEntry function body
      const fnStart = js.indexOf('function renderTradeEntry');
      const fnEnd = js.indexOf('function selectTradeEntry');
      const fnBody = js.substring(fnStart, fnEnd);
      // No innerHTML in the render function
      expect(fnBody).not.toContain('innerHTML');
      // Uses textContent for setting text
      expect(fnBody).toContain('.textContent');
    });

    it('renderSystemEntry should use textContent for all user-facing strings', () => {
      const fnStart = js.indexOf('function renderSystemEntry');
      const fnEnd = js.indexOf('function renderHotReloadEntry');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).not.toContain('innerHTML');
      expect(fnBody).toContain('.textContent');
    });

    it('renderHotReloadEntry should use textContent for all user-facing strings', () => {
      const fnStart = js.indexOf('function renderHotReloadEntry');
      const fnEnd = js.indexOf('function addLogEntry');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).not.toContain('innerHTML');
      expect(fnBody).toContain('.textContent');
    });
  });

  describe('Story 4.3: SSE Data Contract Verification', () => {
    function createMockRuntime(): EventEmitter & {
      injectDip: ReturnType<typeof vi.fn>;
      injectRally: ReturnType<typeof vi.fn>;
      resetMarket: ReturnType<typeof vi.fn>;
      getStates: ReturnType<typeof vi.fn>;
    } {
      const emitter = new EventEmitter();
      return Object.assign(emitter, {
        injectDip: vi.fn(),
        injectRally: vi.fn(),
        resetMarket: vi.fn(),
        getStates: vi.fn().mockReturnValue([]),
      });
    }

    function openSseStream(port: number): { events: string[]; req: http.ClientRequest; ready: Promise<void> } {
      const events: string[] = [];
      let resolve: () => void;
      const ready = new Promise<void>((r) => (resolve = r));

      const req = http.get({ hostname: '127.0.0.1', port, path: '/events' }, (res) => {
        resolve!();
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => events.push(chunk));
      });

      return { events, req, ready };
    }

    function findEventData(events: string[], eventName: string): Record<string, unknown> | null {
      const combined = events.join('');
      const blocks = combined.split('\n\n').filter(Boolean);
      for (const block of blocks) {
        if (!block.includes(`event: ${eventName}`)) continue;
        const dataLine = block.split('\n').find(line => line.startsWith('data: '));
        if (!dataLine) continue;
        return JSON.parse(dataLine.replace('data: ', ''));
      }
      return null;
    }

    let server: http.Server;
    let port: number;
    let runtime: ReturnType<typeof createMockRuntime>;

    beforeEach(async () => {
      runtime = createMockRuntime();
      const { app } = createServer({ runtime: runtime as never, port: 0 });
      server = app.listen(0);
      await new Promise<void>((r) => server.on('listening', r));
      port = (server.address() as { port: number }).port;
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('stateUpdate event should include agents array with lastDecision for trade detection', async () => {
      const { events, req, ready } = openSseStream(port);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      const mockAgent = {
        agentId: 1,
        name: 'Alpha',
        status: 'active',
        lastDecision: {
          timestamp: Date.now(),
          decision: { action: 'buy', amount: 0.12, reason: 'test' },
          execution: { status: 'confirmed', signature: 'abc123def456' },
          evaluations: [{ ruleId: 0, ruleName: 'test-rule', score: 87, matched: true, conditions: [] }],
        },
      };
      runtime.getStates.mockReturnValue([mockAgent]);
      runtime.emit('stateUpdate', mockAgent);
      await new Promise((r) => setTimeout(r, 50));

      const payload = findEventData(events, 'stateUpdate');
      expect(payload).not.toBeNull();
      expect(payload!['type']).toBe('agentState');
      expect(Array.isArray(payload!['agents'])).toBe(true);

      const agents = payload!['agents'] as Array<Record<string, unknown>>;
      expect(agents[0]!['lastDecision']).toBeDefined();

      req.destroy();
    });

    it('systemEvent lifecycle should include agentId, event, and timestamp', async () => {
      const { events, req, ready } = openSseStream(port);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      runtime.emit('agentLifecycle', {
        agentId: 2,
        event: 'started',
        timestamp: Date.now(),
      });
      await new Promise((r) => setTimeout(r, 50));

      const payload = findEventData(events, 'systemEvent');
      expect(payload).not.toBeNull();
      expect(payload!['type']).toBe('lifecycle');
      expect(payload!['agentId']).toBe(2);
      expect(payload!['event']).toBe('started');
      expect(typeof payload!['timestamp']).toBe('number');

      req.destroy();
    });

    it('systemEvent hotReload should include fileName, success, and timestamp', async () => {
      const { events, req, ready } = openSseStream(port);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      runtime.emit('rulesReloaded', {
        agentId: 1,
        success: true,
        fileName: 'dip-buyer.json',
        timestamp: Date.now(),
      });
      await new Promise((r) => setTimeout(r, 50));

      const payload = findEventData(events, 'systemEvent');
      expect(payload).not.toBeNull();
      expect(payload!['type']).toBe('hotReload');
      expect(payload!['success']).toBe(true);
      expect(typeof payload!['timestamp']).toBe('number');

      req.destroy();
    });

    it('systemEvent hotReload failure should include error field', async () => {
      const { events, req, ready } = openSseStream(port);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      runtime.emit('rulesReloaded', {
        agentId: 1,
        success: false,
        error: 'Invalid JSON syntax',
        timestamp: Date.now(),
      });
      await new Promise((r) => setTimeout(r, 50));

      const payload = findEventData(events, 'systemEvent');
      expect(payload).not.toBeNull();
      expect(payload!['type']).toBe('hotReload');
      expect(payload!['success']).toBe(false);
      expect(payload!['error']).toBe('Invalid JSON syntax');

      req.destroy();
    });

    it('systemEvent lifecycle error should include message field', async () => {
      const { events, req, ready } = openSseStream(port);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      runtime.emit('agentLifecycle', {
        agentId: 3,
        event: 'error',
        message: 'RPC connection failed',
        timestamp: Date.now(),
      });
      await new Promise((r) => setTimeout(r, 50));

      const payload = findEventData(events, 'systemEvent');
      expect(payload).not.toBeNull();
      expect(payload!['type']).toBe('lifecycle');
      expect(payload!['event']).toBe('error');
      expect(payload!['message']).toBe('RPC connection failed');

      req.destroy();
    });

    it('systemEvent lifecycle stopped/auto-stopped variants', async () => {
      const { events, req, ready } = openSseStream(port);
      await ready;
      await new Promise((r) => setTimeout(r, 50));

      runtime.emit('agentLifecycle', {
        agentId: 1,
        event: 'auto-stopped',
        timestamp: Date.now(),
      });
      await new Promise((r) => setTimeout(r, 50));

      const payload = findEventData(events, 'systemEvent');
      expect(payload).not.toBeNull();
      expect(payload!['event']).toBe('auto-stopped');

      req.destroy();
    });
  });

  // ── Story 4.4: Reasoning Trace Panel — Structured Tree & JSON Toggle ──

  describe('Story 4.4: Trace Panel CSS Classes', () => {
    let css: string;

    beforeAll(() => {
      css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf-8');
    });

    it('should define .trace-panel-header with flex layout and border-bottom', () => {
      const match = css.match(/\.trace-panel-header\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('display: flex');
      expect(match![0]).toContain('border-bottom');
      expect(match![0]).toContain('var(--border-subtle)');
    });

    it('should define .trace-line with line-height 1.7', () => {
      const match = css.match(/\.trace-line\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('line-height: 1.7');
    });

    it('should define .trace-pass with color matching --status-success', () => {
      const match = css.match(/\.trace-pass\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('var(--status-success)');
    });

    it('should define .trace-fail with color matching --status-danger', () => {
      const match = css.match(/\.trace-fail\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('var(--status-danger)');
    });

    it('should define .trace-label with color matching --text-secondary', () => {
      const match = css.match(/\.trace-label\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('var(--text-secondary)');
    });

    it('should define .trace-value with color matching --text-primary', () => {
      const match = css.match(/\.trace-value\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('var(--text-primary)');
    });

    it('should define .trace-action with color matching --accent-blue', () => {
      const match = css.match(/\.trace-action\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('var(--accent-blue)');
    });

    it('should define .trace-json-view with background matching --code-bg', () => {
      const match = css.match(/\.trace-json-view\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('var(--code-bg)');
    });

    it('should define .trace-toggle-btn', () => {
      expect(css).toContain('.trace-toggle-btn');
    });

    it('should define .trace-panel-close with hover state', () => {
      expect(css).toContain('.trace-panel-close');
      expect(css).toContain('.trace-panel-close:hover');
    });

    it('should define .trace-panel-label with uppercase and text-secondary', () => {
      const match = css.match(/\.trace-panel-label\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('text-transform: uppercase');
      expect(match![0]).toContain('var(--text-secondary)');
    });

    it('should define .trace-panel-body with bg-secondary and border-subtle', () => {
      const match = css.match(/\.trace-panel-body\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('var(--bg-secondary)');
      expect(match![0]).toContain('var(--border-subtle)');
    });

    it('should define .trace-panel-footer with border-top and flex', () => {
      const match = css.match(/\.trace-panel-footer\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('border-top');
      expect(match![0]).toContain('display: flex');
    });

    it('should define .trace-tree-view with 16px 20px padding and 0.875rem font', () => {
      const match = css.match(/\.trace-tree-view\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('padding: 16px 20px');
      expect(match![0]).toContain('font-size: 0.875rem');
    });

    it('should define .trace-json-view pre with code-text color and 0.8125rem font', () => {
      const match = css.match(/\.trace-json-view pre\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('var(--code-text)');
      expect(match![0]).toContain('0.8125rem');
    });

    it('CSS: no hardcoded hex values outside :root after trace panel additions', () => {
      const rootMatch = css.match(/:root\s*\{[^}]+\}/s);
      const rootBlock = rootMatch ? rootMatch[0] : '';
      const restOfCss = css.replace(rootBlock, '');
      const lines = restOfCss.split('\n').filter(line => !line.trim().startsWith('/*') && !line.trim().startsWith('*'));
      const hexPattern = /#[0-9a-fA-F]{3,8}\b/;
      const violatingLines = lines.filter(line => hexPattern.test(line));
      expect(violatingLines).toEqual([]);
    });
  });

  describe('Story 4.4: Trace Panel JS Functions', () => {
    let js: string;

    beforeAll(() => {
      js = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf-8');
    });

    it('should have renderTracePanel function', () => {
      expect(js).toContain('function renderTracePanel(trace)');
    });

    it('should have renderTraceTree function', () => {
      expect(js).toContain('function renderTraceTree(trace)');
    });

    it('should have renderTraceJson function', () => {
      expect(js).toContain('function renderTraceJson(trace)');
    });

    it('should have openTracePanel function', () => {
      expect(js).toContain('function openTracePanel(trace)');
    });

    it('should have closeTracePanel function', () => {
      expect(js).toContain('function closeTracePanel()');
    });

    it('should have toggleTraceView function', () => {
      expect(js).toContain('function toggleTraceView()');
    });

    it('should have renderTraceConditionLine function', () => {
      expect(js).toContain('function renderTraceConditionLine(condition');
    });

    it('should have renderTraceCooldownLine function', () => {
      expect(js).toContain('function renderTraceCooldownLine(evaluation)');
    });

    it('should have renderTraceScoreLine function', () => {
      expect(js).toContain('function renderTraceScoreLine(evaluation)');
    });

    it('should have renderTraceActionLine function', () => {
      expect(js).toContain('function renderTraceActionLine(trace)');
    });

    it('should have highlightJsonValue function for DOM-based syntax highlighting', () => {
      expect(js).toContain('function highlightJsonValue(value, depth)');
    });
  });

  describe('Story 4.4: Trace Panel DOM Structure & Behavior', () => {
    let js: string;
    let html: string;

    beforeAll(() => {
      js = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf-8');
      html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');
    });

    it('AC1: #trace-panel should have hidden attribute by default', () => {
      expect(html).toMatch(/id="trace-panel"[^>]*hidden/);
    });

    it('AC7: #trace-panel should have role="region"', () => {
      expect(html).toMatch(/id="trace-panel"[^>]*role="region"/);
    });

    it('AC3: trace tree should use box-drawing characters', () => {
      expect(js).toContain('├─');
      expect(js).toContain('└─');
    });

    it('AC3: trace tree should render pass/fail indicators', () => {
      expect(js).toContain('✓ PASS');
      expect(js).toContain('✗ FAIL');
    });

    it('AC3: trace tree should render cooldown status', () => {
      expect(js).toContain('✓ CLEAR');
      expect(js).toContain('✗ ACTIVE');
    });

    it('AC3: trace tree should render execution status', () => {
      expect(js).toContain('✓ CONFIRMED');
      expect(js).toContain('✓ SIMULATED');
      expect(js).toContain('✗ FAILED');
    });

    it('AC4: JSON view should use pre element', () => {
      expect(js).toContain("document.createElement('pre')");
      expect(js).toContain('trace-json-view');
    });

    it('AC6: close button should have aria-label="Close trace panel"', () => {
      expect(js).toContain("'Close trace panel'");
    });

    it('AC7: renderTracePanel should update aria-label with agent name', () => {
      expect(js).toContain("'Reasoning trace for Agent '");
    });

    it('AC5: lastAgentsData variable should exist for agent trace lookup', () => {
      expect(js).toContain('var lastAgentsData = []');
    });

    it('AC6: tracePanelTrigger variable should exist for focus management', () => {
      expect(js).toContain('var tracePanelTrigger = null');
    });

    it('AC5: stateUpdate should cache agents in lastAgentsData', () => {
      expect(js).toContain('lastAgentsData = data.agents');
    });

    it('placeholder text should NOT be in selectTradeEntry or selectAgent', () => {
      const tradeEntryFn = js.substring(
        js.indexOf('function selectTradeEntry'),
        js.indexOf('function renderSystemEntry')
      );
      expect(tradeEntryFn).not.toContain('Reasoning trace will appear here.');

      const selectAgentFn = js.substring(
        js.indexOf('function selectAgent'),
        js.indexOf('function updateFooterAgents')
      );
      expect(selectAgentFn).not.toContain('Reasoning trace will appear here.');
    });

    it('AC4: toggleTraceView should switch between tree and json views', () => {
      expect(js).toContain("'Show raw JSON'");
      expect(js).toContain("'Show structured view'");
      expect(js).toContain("currentTraceView === 'tree'");
    });

    it('AC6: closeTracePanel should restore focus via tracePanelTrigger', () => {
      expect(js).toContain('tracePanelTrigger.focus()');
    });

    it('AC6: Escape handler should call closeTracePanel()', () => {
      expect(js).toContain("if (e.key === 'Escape')");
      expect(js).toContain('closeTracePanel()');
    });

    it('AC2: trace-selected event listener should call openTracePanel', () => {
      expect(js).toContain("document.addEventListener('trace-selected'");
      expect(js).toContain('openTracePanel(e.detail)');
    });

    it('AC2: agent-selected event listener should look up lastAgentsData', () => {
      expect(js).toContain("document.addEventListener('agent-selected'");
      expect(js).toContain('lastAgentsData.find');
      expect(js).toContain('agent.lastDecision');
    });

    it('should not use innerHTML with user data in trace rendering functions', () => {
      const traceSection = js.substring(
        js.indexOf('// ── Trace Panel Rendering'),
        js.indexOf('// ── Connection status')
      );
      expect(traceSection).not.toContain('innerHTML');
    });

    it('highlightJsonValue should use createElement for colored spans, not innerHTML', () => {
      const fnStart = js.indexOf('function highlightJsonValue');
      const fnEnd = js.indexOf('function renderTraceTree');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).not.toContain('innerHTML');
      expect(fnBody).toContain("document.createElement('span')");
    });

    it('AC2: renderTracePanel should build header with label, agent name, and close button', () => {
      expect(js).toContain('trace-panel-header');
      expect(js).toContain('trace-panel-label');
      expect(js).toContain('trace-panel-agent');
      expect(js).toContain('trace-panel-close');
    });

    it('AC2: renderTracePanel should build footer with toggle button', () => {
      expect(js).toContain('trace-panel-footer');
      expect(js).toContain('trace-toggle-btn');
    });

    it('AC5: openTracePanel should store document.activeElement', () => {
      expect(js).toContain('tracePanelTrigger = document.activeElement');
    });

    it('AC6: closeTracePanel should deselect trade entry and agent card', () => {
      const fnStart = js.indexOf('function closeTracePanel');
      const fnEnd = js.indexOf('function toggleTraceView');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain("classList.remove('selected')");
      expect(fnBody).toContain("classList.remove('border-accent-blue')");
    });

    it('renderTraceTree should sort winning rule first', () => {
      expect(js).toContain('trace.decision.ruleIndex');
      expect(js).toContain('sortedEvals.sort');
    });

    it('renderTraceActionLine should use formatTxSignature for tx links', () => {
      const fnStart = js.indexOf('function renderTraceActionLine');
      const fnEnd = js.indexOf('function highlightJsonValue');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain('formatTxSignature(trace.execution.signature)');
    });

    it('highlightJsonValue should color keys with --accent-blue', () => {
      expect(js).toContain("keySpan.style.color = 'var(--accent-blue)'");
    });

    it('highlightJsonValue should color strings with --status-success', () => {
      expect(js).toContain("strSpan.style.color = 'var(--status-success)'");
    });

    it('highlightJsonValue should color numbers with --status-warning', () => {
      expect(js).toContain("numSpan.style.color = 'var(--status-warning)'");
    });

    it('highlightJsonValue should color booleans/null with --status-info', () => {
      expect(js).toContain("nullSpan.style.color = 'var(--status-info)'");
      expect(js).toContain("boolSpan.style.color = 'var(--status-info)'");
    });
  });

  // ── Story 4.5: Transaction Links & Market Controls ──

  describe('Story 4.5: Toast & Market Control CSS (AC3, AC7, AC10)', () => {
    let css: string;

    beforeAll(() => {
      css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf-8');
    });

    it('should define .toast base styles with flex, border-radius, and box-shadow', () => {
      const match = css.match(/\.toast\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('display: flex');
      expect(match![0]).toContain('border-radius: 6px');
      expect(match![0]).toContain('box-shadow');
    });

    it('should define .toast-success .toast-icon with --status-success', () => {
      expect(css).toContain('.toast-success .toast-icon');
      const match = css.match(/\.toast-success \.toast-icon\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('var(--status-success)');
    });

    it('should define .toast-error .toast-icon with --status-danger', () => {
      expect(css).toContain('.toast-error .toast-icon');
      const match = css.match(/\.toast-error \.toast-icon\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('var(--status-danger)');
    });

    it('should define .toast-info .toast-icon with --status-info', () => {
      expect(css).toContain('.toast-info .toast-icon');
      const match = css.match(/\.toast-info \.toast-icon\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('var(--status-info)');
    });

    it('should define .toast-message with flex: 1', () => {
      const match = css.match(/\.toast-message\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('flex: 1');
    });

    it('should define .toast-dismiss with no background and hover state', () => {
      expect(css).toContain('.toast-dismiss');
      expect(css).toContain('.toast-dismiss:hover');
    });

    it('should define .market-sim-label with uppercase and tertiary color', () => {
      const match = css.match(/\.market-sim-label\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('text-transform: uppercase');
      expect(match![0]).toContain('var(--text-tertiary)');
      expect(match![0]).toContain('0.75rem');
    });

    it('should define .badge.cursor-pointer:hover with background', () => {
      expect(css).toContain('.badge.cursor-pointer:hover');
      const match = css.match(/\.badge\.cursor-pointer:hover\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('var(--border-default)');
    });

    it('should define .badge.cursor-pointer:active with scale transform', () => {
      expect(css).toContain('.badge.cursor-pointer:active');
      const match = css.match(/\.badge\.cursor-pointer:active\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('scale(0.97)');
    });

    it('should define .market-btn with AC7 secondary tier sizing', () => {
      expect(css).toContain('.market-btn');
      const match = css.match(/\.market-btn\s*\{[^}]+\}/);
      expect(match).not.toBeNull();
      expect(match![0]).toContain('font-size: 0.875rem');
      expect(match![0]).toContain('padding: 4px 12px');
    });

    it('CSS: no hardcoded hex values outside :root after 4.5 additions', () => {
      const rootMatch = css.match(/:root\s*\{[^}]+\}/s);
      const rootBlock = rootMatch ? rootMatch[0] : '';
      const restOfCss = css.replace(rootBlock, '');
      const lines = restOfCss.split('\n').filter(line => !line.trim().startsWith('/*') && !line.trim().startsWith('*'));
      const hexPattern = /#[0-9a-fA-F]{3,8}\b/;
      const violatingLines = lines.filter(line => hexPattern.test(line));
      expect(violatingLines).toEqual([]);
    });
  });

  describe('Story 4.5: HTML — Market Sim Label & Toast Container (AC3, AC10)', () => {
    let html: string;

    beforeAll(() => {
      html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');
    });

    it('should have #toast-container with aria-live="polite"', () => {
      expect(html).toContain('id="toast-container"');
      expect(html).toContain('aria-live="polite"');
    });

    it('should have Market Sim label text', () => {
      expect(html).toContain('Market Sim');
      expect(html).toContain('market-sim-label');
    });

    it('should have #btn-dip with aria-label', () => {
      expect(html).toContain('id="btn-dip"');
      expect(html).toContain('aria-label="Simulate market dip"');
    });

    it('should have #btn-rally with aria-label', () => {
      expect(html).toContain('id="btn-rally"');
      expect(html).toContain('aria-label="Simulate market rally"');
    });

    it('should have #btn-reset with aria-label', () => {
      expect(html).toContain('id="btn-reset"');
      expect(html).toContain('aria-label="Reset market"');
    });

    it('should have #market-price element', () => {
      expect(html).toContain('id="market-price"');
    });

    it('should have #mode-badge element', () => {
      expect(html).toContain('id="mode-badge"');
    });

    it('market buttons should have market-btn class for AC7 sizing', () => {
      expect(html).toContain('market-btn');
    });

    it('mode-badge should have initial border-color matching status-success', () => {
      expect(html).toContain('border-color: var(--status-success)');
    });
  });

  describe('Story 4.5: JS Functions — Toast, Market Handlers (AC4, AC5, AC6, AC10)', () => {
    let js: string;

    beforeAll(() => {
      js = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf-8');
    });

    it('should have showToast function', () => {
      expect(js).toContain('function showToast(type, message)');
    });

    it('should have onMarketDip function', () => {
      expect(js).toContain('function onMarketDip()');
    });

    it('should have onMarketRally function', () => {
      expect(js).toContain('function onMarketRally()');
    });

    it('should have onMarketReset function', () => {
      expect(js).toContain('function onMarketReset()');
    });

    it('onMarketDip should POST to /api/market/dip with percent: 5', () => {
      expect(js).toContain("fetch('/api/market/dip'");
      expect(js).toContain('{ percent: 5 }');
    });

    it('onMarketRally should POST to /api/market/rally with percent: 10', () => {
      expect(js).toContain("fetch('/api/market/rally'");
      expect(js).toContain('{ percent: 10 }');
    });

    it('onMarketReset should POST to /api/market/reset', () => {
      expect(js).toContain("fetch('/api/market/reset'");
    });

    it('should have button DOM refs: btnDip, btnRally, btnReset', () => {
      expect(js).toContain("var btnDip = document.getElementById('btn-dip')");
      expect(js).toContain("var btnRally = document.getElementById('btn-rally')");
      expect(js).toContain("var btnReset = document.getElementById('btn-reset')");
    });

    it('should have toastContainer DOM ref', () => {
      expect(js).toContain("var toastContainer = document.getElementById('toast-container')");
    });

    it('should wire button click listeners', () => {
      expect(js).toContain("btnDip.addEventListener('click', onMarketDip)");
      expect(js).toContain("btnRally.addEventListener('click', onMarketRally)");
      expect(js).toContain("btnReset.addEventListener('click', onMarketReset)");
    });

    it('market handlers disable button during fetch to prevent double-click', () => {
      expect(js).toContain('btnDip.disabled = true');
      expect(js).toContain('btnRally.disabled = true');
      expect(js).toContain('btnReset.disabled = true');
    });
  });

  describe('Story 4.5: Toast Behavior (AC10)', () => {
    let js: string;

    beforeAll(() => {
      js = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf-8');
    });

    it('toast max 3 check: removes oldest when container has >= 3 children', () => {
      expect(js).toContain('children.length >= 3');
    });

    it('toast auto-dismiss uses setTimeout with 3000 for success type', () => {
      expect(js).toContain('3000');
      expect(js).toContain('5000');
    });

    it('toast uses role="alert" for error type and role="status" for others', () => {
      expect(js).toContain("type === 'error' ? 'alert' : 'status'");
    });

    it('error toast has manual dismiss button with aria-label', () => {
      const fnStart = js.indexOf('function showToast');
      const fnEnd = js.indexOf('// ── Market Control Handlers');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain('toast-dismiss');
      expect(fnBody).toContain("'Dismiss'");
    });

    it('toast uses createElement and textContent, never innerHTML', () => {
      const fnStart = js.indexOf('function showToast');
      const fnEnd = js.indexOf('// ── Market Control Handlers');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).not.toContain('innerHTML');
      expect(fnBody).toContain('.textContent');
    });

    it('showToast uses cached toastContainer ref, not getElementById', () => {
      const fnStart = js.indexOf('function showToast');
      const fnEnd = js.indexOf('// ── Market Control Handlers');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).not.toContain('getElementById');
      expect(fnBody).toContain('toastContainer');
    });
  });

  describe('Story 4.5: Mode Badge SSE Enhancement (AC9)', () => {
    let js: string;

    beforeAll(() => {
      js = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf-8');
    });

    it('modeChange listener handles SIMULATION MODE text', () => {
      expect(js).toContain("modeBadge.textContent = 'SIMULATION MODE'");
    });

    it('modeChange listener handles DEVNET (fallback) for degraded mode', () => {
      expect(js).toContain("modeBadge.textContent = 'DEVNET (fallback)'");
      expect(js).toContain("'var(--status-warning)'");
    });

    it('modeChange listener handles DEVNET for normal mode', () => {
      expect(js).toContain("modeBadge.textContent = 'DEVNET'");
    });

    it('modeChange listener checks data.reason for fallback detection', () => {
      expect(js).toContain("data.reason && data.reason.indexOf('fallback') !== -1");
    });

    it('modeChange listener sets borderColor for colored badge appearance', () => {
      expect(js).toContain("modeBadge.style.borderColor = 'var(--status-danger)'");
      expect(js).toContain("modeBadge.style.borderColor = 'var(--status-warning)'");
      expect(js).toContain("modeBadge.style.borderColor = 'var(--status-success)'");
    });
  });

  describe('Story 4.5: Market Update SSE Enhancement (AC4, AC5)', () => {
    let js: string;

    beforeAll(() => {
      js = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf-8');
    });

    it('marketUpdate handler uses --status-success for positive change', () => {
      expect(js).toContain("'var(--status-success)' : 'var(--status-danger)'");
    });

    it('marketUpdate handler creates colored change span', () => {
      expect(js).toContain("var changeSpan = document.createElement('span')");
    });

    it('marketUpdate handler clears existing content before update', () => {
      expect(js).toContain('while (marketPrice.firstChild) { marketPrice.removeChild(marketPrice.firstChild); }');
    });

    it('marketUpdate no longer contains Stub comment', () => {
      expect(js).not.toContain('Stub: market updates');
    });

    it('modeChange no longer contains Stub comment', () => {
      expect(js).not.toContain('Stub: mode changes');
    });
  });

  describe('Story 4.5: No innerHTML XSS in toast or market functions', () => {
    let js: string;

    beforeAll(() => {
      js = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf-8');
    });

    it('no innerHTML in toast or market control functions', () => {
      const toastStart = js.indexOf('// ── Toast Notifications');
      const marketEnd = js.indexOf('// ── SSE connection');
      const section = js.substring(toastStart, marketEnd);
      expect(section).not.toContain('innerHTML');
    });
  });

  describe('Story 4.4: Trace Panel Edge Cases & Integration', () => {
    let js: string;

    beforeAll(() => {
      js = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf-8');
    });

    it('openTracePanel should guard against null/undefined trace', () => {
      const fnStart = js.indexOf('function openTracePanel');
      const fnEnd = js.indexOf('function closeTracePanel');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain('if (!trace) return');
    });

    it('renderTraceActionLine should return null when no execution exists', () => {
      const fnStart = js.indexOf('function renderTraceActionLine');
      const fnEnd = js.indexOf('function highlightJsonValue');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain('if (!trace.execution) return null');
    });

    it('renderTraceTree should handle empty evaluations gracefully', () => {
      const fnStart = js.indexOf('function renderTraceTree');
      const fnEnd = js.indexOf('function renderTraceJson');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain('No evaluations in trace.');
    });

    it('currentTraceView should be initialized to tree', () => {
      expect(js).toContain("var currentTraceView = 'tree'");
    });

    it('renderTraceJson should create hidden container by default', () => {
      const fnStart = js.indexOf('function renderTraceJson');
      const fnEnd = js.indexOf('function renderTracePanel');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain('container.hidden = true');
    });

    it('renderTracePanel should clear previous content before rendering', () => {
      const fnStart = js.indexOf('function renderTracePanel');
      const fnEnd = js.indexOf('// ── Trace Panel Open');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain('tracePanel.removeChild(tracePanel.firstChild)');
    });

    it('renderTracePanel should look up agent name from lastAgentsData', () => {
      const fnStart = js.indexOf('function renderTracePanel');
      const fnEnd = js.indexOf('// ── Trace Panel Open');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain('lastAgentsData.find');
      expect(fnBody).toContain("agentName = 'Unknown'");
    });

    it('closeTracePanel should verify tracePanelTrigger is still in DOM before focusing', () => {
      const fnStart = js.indexOf('function closeTracePanel');
      const fnEnd = js.indexOf('function toggleTraceView');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain('tracePanelTrigger.parentNode');
    });

    it('renderTraceCooldownLine should handle insufficient_balance blocked state', () => {
      const fnStart = js.indexOf('function renderTraceCooldownLine');
      const fnEnd = js.indexOf('function renderTraceScoreLine');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain("evaluation.blocked === 'insufficient_balance'");
      expect(fnBody).toContain('✗ INSUFFICIENT');
    });

    it('highlightJsonValue should handle arrays recursively', () => {
      const fnStart = js.indexOf('function highlightJsonValue');
      const fnEnd = js.indexOf('function renderTraceTree');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain('Array.isArray(value)');
      expect(fnBody).toContain('highlightJsonValue(value[ai], depth + 1)');
    });

    it('highlightJsonValue should handle objects recursively with key iteration', () => {
      const fnStart = js.indexOf('function highlightJsonValue');
      const fnEnd = js.indexOf('function renderTraceTree');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain('Object.keys(value)');
      expect(fnBody).toContain('highlightJsonValue(value[keys[ki]], depth + 1)');
    });

    it('renderTraceActionLine should display execution error on failure', () => {
      const fnStart = js.indexOf('function renderTraceActionLine');
      const fnEnd = js.indexOf('function highlightJsonValue');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain('trace.execution.error');
    });

    it('renderTraceScoreLine should show EXECUTE for matched and SKIP for unmatched', () => {
      const fnStart = js.indexOf('function renderTraceScoreLine');
      const fnEnd = js.indexOf('function renderTraceActionLine');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain("evaluation.matched ? ' → EXECUTE' : ' → SKIP'");
    });

    it('renderTracePanel should wire close button to closeTracePanel', () => {
      const fnStart = js.indexOf('function renderTracePanel');
      const fnEnd = js.indexOf('// ── Trace Panel Open');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain("closeBtn.addEventListener('click'");
      expect(fnBody).toContain('closeTracePanel()');
    });

    it('renderTracePanel should wire toggle button to toggleTraceView', () => {
      const fnStart = js.indexOf('function renderTracePanel');
      const fnEnd = js.indexOf('// ── Trace Panel Open');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain("toggleBtn.addEventListener('click'");
      expect(fnBody).toContain('toggleTraceView()');
    });

    it('renderTraceConditionLine should use textContent for actual value (XSS safety)', () => {
      const fnStart = js.indexOf('function renderTraceConditionLine');
      const fnEnd = js.indexOf('function renderTraceCooldownLine');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain('actual.textContent = String(condition.actual)');
      expect(fnBody).not.toContain('innerHTML');
    });

    it('trace panel agent name should use formatRelativeTime for timestamp', () => {
      const fnStart = js.indexOf('function renderTracePanel');
      const fnEnd = js.indexOf('// ── Trace Panel Open');
      const fnBody = js.substring(fnStart, fnEnd);
      expect(fnBody).toContain('formatRelativeTime(trace.timestamp)');
    });
  });
});
