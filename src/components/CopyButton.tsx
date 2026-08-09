import { useState } from 'react'

// Small copy-to-clipboard button used across the Channels pages — the whole
// point of Phase 1 is handing you clean, locked prompt blocks to paste into
// the AI video tool, so "copy" is the primary verb here.
export default function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be blocked (insecure context); fail quietly.
    }
  }

  return (
    <button
      onClick={copy}
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full border transition ${
        copied
          ? 'text-stage-done border-stage-done/50 bg-stage-done/10'
          : 'text-muted border-line hover:text-text hover:border-line'
      }`}
    >
      {copied ? '✓ Copied' : `⎘ ${label}`}
    </button>
  )
}
