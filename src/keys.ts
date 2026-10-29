import { useEffect, useRef } from 'react'

// True when the person is typing into a field, so single-key shortcuts must stay out of the way.
export const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

// True while an in-app dialog (confirm / prompt / palette / help) is on screen.
export const dialogOpen = () => !!document.querySelector('[role="dialog"]')

// Esc = cancel / go back. Does nothing while a dialog is open (the dialog owns Esc then).
export function useEscape(handler: () => void, enabled = true) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!enabled) return
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || dialogOpen()) return
      ref.current()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [enabled])
}

export const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ['Ctrl', 'K'], what: 'Go to any screen (type to search, Enter to open)' },
  { keys: ['/'], what: 'Same as Ctrl + K, when you are not typing in a box' },
  { keys: ['['], what: 'Collapse or expand the sidebar' },
  { keys: ['?'], what: 'Show this list' },
  { keys: ['Tab'], what: 'Move to the next control (Shift + Tab goes back)' },
  { keys: ['↑', '↓'], what: 'Move up and down the sidebar' },
  { keys: ['Enter'], what: 'Confirm: press the highlighted button, or OK in a dialog' },
  { keys: ['Esc'], what: 'Cancel: close a dialog, or go back on the payment screen' },
]
