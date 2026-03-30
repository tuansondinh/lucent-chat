/**
 * Terminal — an xterm.js terminal panel backed by a node-pty process.
 *
 * Lifecycle:
 *  - On mount: initialise xterm, call bridge.terminalCreate(), subscribe to
 *    bridge.onTerminalData() to pipe pty output into xterm.
 *  - On unmount: call bridge.terminalDestroy(), dispose xterm.
 *
 * Resize: a ResizeObserver watches the container and calls fitAddon.fit() to
 * reflow xterm, then notifies the pty via bridge.terminalResize().
 */

import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { getBridge } from '../lib/bridge'

// Colour theme matching the dark UI (background #22272e)
const XTERM_THEME = {
  background: '#22272e',
  foreground: '#e0e0e0',
  cursor: '#e0e0e0',
  cursorAccent: '#22272e',
  selectionBackground: '#3a3a4a',
  black: '#22272e',
  red: '#f2777a',
  green: '#99cc99',
  yellow: '#ffcc66',
  blue: '#6699cc',
  magenta: '#cc99cc',
  cyan: '#66cccc',
  white: '#cccccc',
  brightBlack: '#555555',
  brightRed: '#f2777a',
  brightGreen: '#99cc99',
  brightYellow: '#ffcc66',
  brightBlue: '#6699cc',
  brightMagenta: '#cc99cc',
  brightCyan: '#66cccc',
  brightWhite: '#e0e0e0',
}

interface TerminalProps {
  terminalId?: string
}

export function Terminal({ terminalId = 'main' }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Keep stable refs so effects don't need them as deps
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const bridge = getBridge()

    // -------------------------------------------------------------------------
    // Initialise xterm
    // -------------------------------------------------------------------------
    const xterm = new XTerm({
      theme: XTERM_THEME,
      fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: false,
      scrollback: 5000,
    })
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)

    xterm.open(containerRef.current)
    fitAddon.fit()

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

    // -------------------------------------------------------------------------
    // Spawn the pty, subscribe to output
    // -------------------------------------------------------------------------
    bridge.terminalCreate(terminalId).catch((err: unknown) => {
      console.error('[Terminal] terminalCreate failed:', err)
    })

    const unsubData = bridge.onTerminalData((payload: { terminalId: string; data: string }) => {
      if (payload.terminalId !== terminalId) return
      xterm.write(payload.data)
    })

    // Forward keyboard input to the pty
    xterm.onData((data: string) => {
      bridge.terminalInput(terminalId, data).catch((err: unknown) => {
        console.error('[Terminal] terminalInput failed:', err)
      })
    })

    // -------------------------------------------------------------------------
    // Resize observer — refit xterm and notify pty
    // -------------------------------------------------------------------------
    const resizeObserver = new ResizeObserver(() => {
      // fitAddon.fit() can throw if the terminal is not yet open/has zero size
      try {
        fitAddon.fit()
        const { cols, rows } = xterm
        bridge.terminalResize(terminalId, cols, rows).catch((err: unknown) => {
          console.error('[Terminal] terminalResize failed:', err)
        })
      } catch {
        // Ignore — will be retried on next resize event
      }
    })

    resizeObserver.observe(containerRef.current)

    // -------------------------------------------------------------------------
    // Cleanup on unmount
    // -------------------------------------------------------------------------
    return () => {
      resizeObserver.disconnect()
      unsubData()
      bridge.terminalDestroy(terminalId).catch(() => {})
      xterm.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [terminalId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#22272e',
        padding: 0,
      }}
    />
  )
}
