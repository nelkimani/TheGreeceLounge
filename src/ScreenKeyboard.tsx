import { useCallback, useEffect, useRef, useState } from 'react'

// On-screen keyboard for the touch terminals (no physical keyboard).
// Mounted once in App. It works with ANY existing <input> / <textarea>: when a field is tapped it
// docks at the bottom of the screen, the Windows/Android keyboard is suppressed (inputmode="none"),
// and each key writes into the field exactly like typing, so React state updates as normal.
// Date pickers and drop-downs are left alone (they already work by touch).

type Field = HTMLInputElement | HTMLTextAreaElement
const TYPABLE = ['text', 'search', 'email', 'password', 'tel', 'number', 'url', '']

const asField = (t: EventTarget | null): Field | null => {
  if (t instanceof HTMLTextAreaElement) return t.readOnly || t.disabled ? null : t
  if (t instanceof HTMLInputElement && TYPABLE.includes(t.type) && !t.readOnly && !t.disabled) return t
  return null
}

function write(el: Field, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))   // lets React see the change
}

const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl']
const LOWER = 'zxcvbnm'

export default function ScreenKeyboard() {
  const [field, setField] = useState<Field | null>(null)
  const [shift, setShift] = useState<'off' | 'once' | 'caps'>('off')
  const panel = useRef<HTMLDivElement>(null)
  const pendingDot = useRef(false)
  const hideTimer = useRef<number>()
  const repeat = useRef<{ t?: number; i?: number }>({})

  const numeric = !!field && (field.type === 'number' || field.type === 'tel' || field.inputMode === 'numeric' || field.inputMode === 'decimal')
  const decimal = !!field && field.type === 'number' && field.getAttribute('step') !== '1' && field.inputMode !== 'numeric'
  const secret = field?.type === 'password'
  const noCaps = !!field && (field.type === 'search' || field.type === 'email' || field.type === 'password' || field.type === 'url')

  // --- open / close following focus -------------------------------------------------
  useEffect(() => {
    const quiet = (e: Event) => { const f = asField(e.target); if (f) f.setAttribute('inputmode', 'none') }   // no OS keyboard
    const onIn = (e: FocusEvent) => {
      const f = asField(e.target); if (!f) return
      f.setAttribute('inputmode', 'none')
      window.clearTimeout(hideTimer.current)
      pendingDot.current = false
      setField(f)
      setShift(!(f.type === 'search' || f.type === 'email' || f.type === 'password' || f.type === 'url') && f.value === '' ? 'once' : 'off')
    }
    const onOut = (e: FocusEvent) => {
      if (!asField(e.target)) return
      if (asField(e.relatedTarget)) return
      // Small delay so a tap on a button next to the field is not lost when the layout shifts.
      hideTimer.current = window.setTimeout(() => setField(null), 200)
    }
    document.addEventListener('pointerdown', quiet, true)
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    const watch = window.setInterval(() => setField(f => (f && !f.isConnected ? null : f)), 500)   // field removed by a screen change
    return () => {
      document.removeEventListener('pointerdown', quiet, true)
      document.removeEventListener('focusin', onIn); document.removeEventListener('focusout', onOut)
      window.clearInterval(watch)
    }
  }, [])

  // Re-draw the preview line whenever the field's value changes.
  const [, redraw] = useState(0)
  useEffect(() => {
    if (!field) return
    const f = () => redraw(x => x + 1)
    field.addEventListener('input', f)
    return () => field.removeEventListener('input', f)
  }, [field])

  // Keep the field visible above the keyboard.
  useEffect(() => {
    const de = document.documentElement
    if (!field) { document.body.style.paddingBottom = ''; return }
    const h = panel.current?.offsetHeight ?? 0
    const scrollable = de.scrollHeight > window.innerHeight + 2
    if (scrollable) document.body.style.paddingBottom = `${h}px`
    const r = field.getBoundingClientRect()
    if (r.bottom > window.innerHeight - h - 8) field.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return () => { document.body.style.paddingBottom = '' }
  }, [field, numeric])

  // --- typing ----------------------------------------------------------------------------
  const insert = useCallback((raw: string) => {
    const el = field; if (!el) return
    let ch = raw
    if (!numeric && shift !== 'off' && /[a-z]/.test(ch)) ch = ch.toUpperCase()
    if (el.type === 'number') {
      // number inputs reject "12." while typing, so hold the dot until the next digit arrives
      if (ch === '.') { if (!el.value.includes('.') && el.value !== '') pendingDot.current = true; return }
      const next = el.value + (pendingDot.current ? '.' : '') + ch
      pendingDot.current = false
      write(el, next); return
    }
    const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s
    const max = el.maxLength > 0 ? el.maxLength : Infinity
    if (el.value.length - (e - s) + ch.length > max) return
    write(el, el.value.slice(0, s) + ch + el.value.slice(e))
    requestAnimationFrame(() => { try { el.setSelectionRange(s + ch.length, s + ch.length) } catch { /* not supported on this type */ } })
    if (shift === 'once') setShift('off')
    else if (shift === 'off' && ch === ' ' && !noCaps) setShift('once')   // capital after a space (names)
  }, [field, numeric, shift, noCaps])

  const back = useCallback(() => {
    const el = field; if (!el) return
    if (el.type === 'number') {
      if (pendingDot.current) { pendingDot.current = false; return }
      let v = el.value.slice(0, -1); if (v.endsWith('.')) v = v.slice(0, -1)
      write(el, v); return
    }
    const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s
    if (s === 0 && e === 0) return
    const from = s === e ? s - 1 : s
    write(el, el.value.slice(0, from) + el.value.slice(e))
    requestAnimationFrame(() => { try { el.setSelectionRange(from, from) } catch { /* ignore */ } })
    if (el.value === '' && !noCaps) setShift('once')
  }, [field, noCaps])

  const clear = () => { if (field) { pendingDot.current = false; write(field, '') } }
  const done = () => { field?.blur(); setField(null) }

  // hold backspace to keep deleting
  const backRef = useRef(back); backRef.current = back
  const stopHold = () => { window.clearTimeout(repeat.current.t); window.clearInterval(repeat.current.i) }
  const holdStart = () => {
    backRef.current(); stopHold()
    repeat.current.t = window.setTimeout(() => { repeat.current.i = window.setInterval(() => backRef.current(), 70) }, 450)
  }
  useEffect(() => () => stopHold(), [])

  if (!field) return null
  const label = field.getAttribute('aria-label') || field.placeholder || field.title || ''
  const shown = secret ? '●'.repeat(field.value.length) : field.value

  const key = 'h-[3.25rem] min-w-0 flex-1 select-none rounded-lg bg-slate-700 text-xl font-semibold active:bg-slate-500'
  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault()   // tapping a key must not steal focus from the field
  const K = ({ k, cls = '', children }: { k: string; cls?: string; children?: React.ReactNode }) => (
    <button type="button" tabIndex={-1} className={`${key} ${cls}`} onPointerDown={keep} onClick={() => insert(k)}>{children ?? (shift !== 'off' && !numeric && /[a-z]/.test(k) ? k.toUpperCase() : k)}</button>
  )
  const Back = ({ cls = '' }: { cls?: string }) => (
    <button type="button" tabIndex={-1} aria-label="Delete" className={`${key} ${cls}`}
      onPointerDown={e => { keep(e); holdStart() }} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold}>⌫</button>
  )

  return (
    <div ref={panel} role="group" aria-label="On-screen keyboard"
      className="fixed inset-x-0 bottom-0 z-[80] border-t-2 border-amber-500 bg-slate-800 px-2 pb-2 pt-1 shadow-[0_-8px_24px_rgb(0_0_0/0.35)]"
      onPointerDown={keep}>
      <div className="mx-auto flex max-w-[56rem] flex-col gap-1.5">
        <div className="flex items-center gap-2 px-1 text-base">
          <span className="shrink-0 text-slate-400">{label || 'Typing'}:</span>
          <span className="min-w-0 flex-1 truncate font-semibold">{shown || <span className="font-normal text-slate-500">…</span>}</span>
          <button type="button" tabIndex={-1} onPointerDown={keep} onClick={clear} className="h-9 shrink-0 rounded-lg bg-slate-700 px-3 text-base font-semibold">Clear</button>
          <button type="button" tabIndex={-1} onPointerDown={keep} onClick={done} className="h-9 shrink-0 rounded-lg bg-amber-500 px-5 text-base font-semibold text-on-accent">Done</button>
        </div>
        {numeric ? (
          <div className="mx-auto grid w-[min(24rem,100%)] grid-cols-3 gap-1.5">
            {'123456789'.split('').map(d => <K key={d} k={d} cls="!h-[3.5rem] !text-2xl" />)}
            {decimal ? <K k="." cls="!h-[3.5rem] !text-2xl" /> : <span />}
            <K k="0" cls="!h-[3.5rem] !text-2xl" />
            <Back cls="!h-[3.5rem] !text-2xl" />
          </div>
        ) : (
          <>
            {ROWS.map((r, i) => (
              <div key={r} className="flex gap-1.5" style={{ paddingLeft: `${i * 1.2}rem`, paddingRight: `${i * 1.2}rem` }}>
                {r.split('').map(k => <K key={k} k={k} />)}
              </div>
            ))}
            <div className="flex gap-1.5">
              <button type="button" tabIndex={-1} onPointerDown={keep}
                onClick={() => setShift(s => s === 'off' ? 'once' : s === 'once' ? 'caps' : 'off')}
                className={`${key} !flex-[1.5] ${shift === 'off' ? '' : shift === 'once' ? '!bg-amber-500 text-on-accent' : '!bg-amber-600 text-on-accent'}`}
                aria-label="Shift">{shift === 'caps' ? '⇪' : '⇧'}</button>
              {LOWER.split('').map(k => <K key={k} k={k} />)}
              <Back cls="!flex-[1.5]" />
            </div>
            <div className="flex gap-1.5">
              <K k="-" /><K k="'" /><K k="," />
              <K k=" " cls="!flex-[5]">space</K>
              <K k="." /><K k="/" /><K k="&" />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
