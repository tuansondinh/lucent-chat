/**
 * browser-tools — shared mutable state
 *
 * All mutable state lives behind accessor functions (get/set) so that
 * jiti-transpiled modules see updates reliably.  ES module live bindings
 * (`export let`) are not guaranteed to work under jiti's CJS shim layer.
 *
 * State is initialized to sensible defaults and can be bulk-reset via
 * `resetAllState()` (called by closeBrowser).
 */
import path from "node:path";
import { createActionTimeline, createBoundedLogPusher, createPageRegistry, } from "./core.js";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const ARTIFACT_ROOT = path.resolve(process.cwd(), ".artifacts", "browser");
export const HAR_FILENAME = "session.har";
// ---------------------------------------------------------------------------
// Mutable state variables — accessed only via get/set functions
// ---------------------------------------------------------------------------
// 1. browser
let _browser = null;
export function getBrowser() { return _browser; }
export function setBrowser(b) { _browser = b; }
// 2. context
let _context = null;
export function getContext() { return _context; }
export function setContext(c) { _context = c; }
// 3. pageRegistry (object with internal state — export the instance directly + getter)
export const pageRegistry = createPageRegistry();
export function getPageRegistry() { return pageRegistry; }
// 4. activeFrame
let _activeFrame = null;
export function getActiveFrame() { return _activeFrame; }
export function setActiveFrame(f) { _activeFrame = f; }
// 5. logPusher (bounded log push function — stateless utility, export directly)
export const logPusher = createBoundedLogPusher(1000);
// 6. consoleLogs
let _consoleLogs = [];
export function getConsoleLogs() { return _consoleLogs; }
export function setConsoleLogs(logs) { _consoleLogs = logs; }
// 7. networkLogs
let _networkLogs = [];
export function getNetworkLogs() { return _networkLogs; }
export function setNetworkLogs(logs) { _networkLogs = logs; }
// 8. dialogLogs
let _dialogLogs = [];
export function getDialogLogs() { return _dialogLogs; }
export function setDialogLogs(logs) { _dialogLogs = logs; }
// 9. pendingCriticalRequestsByPage (WeakMap — can't be reassigned, just cleared by replacing)
let _pendingCriticalRequestsByPage = new WeakMap();
export function getPendingCriticalRequestsByPage() { return _pendingCriticalRequestsByPage; }
export function resetPendingCriticalRequestsByPage() { _pendingCriticalRequestsByPage = new WeakMap(); }
// 10. currentRefMap
let _currentRefMap = {};
export function getCurrentRefMap() { return _currentRefMap; }
export function setCurrentRefMap(m) { _currentRefMap = m; }
// 11. refVersion
let _refVersion = 0;
export function getRefVersion() { return _refVersion; }
export function setRefVersion(v) { _refVersion = v; }
// 12. refMetadata
let _refMetadata = null;
export function getRefMetadata() { return _refMetadata; }
export function setRefMetadata(m) { _refMetadata = m; }
// 13. actionTimeline (object with internal state)
export const actionTimeline = createActionTimeline(60);
export function getActionTimeline() { return actionTimeline; }
// 14. lastActionBeforeState
let _lastActionBeforeState = null;
export function getLastActionBeforeState() { return _lastActionBeforeState; }
export function setLastActionBeforeState(s) { _lastActionBeforeState = s; }
// 15. lastActionAfterState
let _lastActionAfterState = null;
export function getLastActionAfterState() { return _lastActionAfterState; }
export function setLastActionAfterState(s) { _lastActionAfterState = s; }
// 16. sessionStartedAt
let _sessionStartedAt = null;
export function getSessionStartedAt() { return _sessionStartedAt; }
export function setSessionStartedAt(t) { _sessionStartedAt = t; }
// 17. sessionArtifactDir
let _sessionArtifactDir = null;
export function getSessionArtifactDir() { return _sessionArtifactDir; }
export function setSessionArtifactDir(d) { _sessionArtifactDir = d; }
// 18a. activeTraceSession
let _activeTraceSession = null;
export function getActiveTraceSession() { return _activeTraceSession; }
export function setActiveTraceSession(t) { _activeTraceSession = t; }
// 18b. harState
const DEFAULT_HAR_STATE = {
    enabled: false,
    configuredAtContextCreation: false,
    path: null,
    exportCount: 0,
    lastExportedPath: null,
    lastExportedAt: null,
};
let _harState = { ...DEFAULT_HAR_STATE };
export function getHarState() { return _harState; }
export function setHarState(h) { _harState = h; }
// ---------------------------------------------------------------------------
// resetAllState — mirrors closeBrowser()'s reset logic
// ---------------------------------------------------------------------------
export function resetAllState() {
    _browser = null;
    _context = null;
    pageRegistry.pages = [];
    pageRegistry.activePageId = null;
    pageRegistry.nextId = 1;
    _activeFrame = null;
    _consoleLogs = [];
    _networkLogs = [];
    _dialogLogs = [];
    _pendingCriticalRequestsByPage = new WeakMap();
    _currentRefMap = {};
    _refVersion = 0;
    _refMetadata = null;
    _lastActionBeforeState = null;
    _lastActionAfterState = null;
    actionTimeline.entries = [];
    actionTimeline.nextId = 1;
    _sessionStartedAt = null;
    _sessionArtifactDir = null;
    _activeTraceSession = null;
    _harState = { ...DEFAULT_HAR_STATE };
}
