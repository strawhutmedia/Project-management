// Shared merge-token chip bar used by both the initial outreach template
// editor and the follow-up editor. Lives in its own module so the two panels
// don't import each other (avoids a circular import).

export function TokenBar({ onInsert }: { onInsert: (token: string) => void }) {
  const tokens: { token: string; label: string; hint: string }[] = [
    { token: '[name]', label: '[name]', hint: 'Prospect first name — e.g. "Alex"' },
    { token: '[unique_sentence]', label: '[unique_sentence]', hint: 'Claude-written personalized sentence per prospect' },
    { token: '[one_sheet_url]', label: '[one_sheet_url]', hint: 'Public one-sheet URL (blank if unpublished)' },
    { token: '[sender]', label: '[sender]', hint: 'Signs off with the name on the account that sends — e.g. "Caroline"' },
    { token: '[guest]', label: '[guest]', hint: 'Who the interview is for — "you" for a direct guest, or the client\'s name when writing to their agent/manager' },
    { token: '[location]', label: '[location]', hint: 'Where you record — set by the Location dropdown (LA / New York / either / remote)' },
  ]
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {tokens.map((t) => (
        <button
          key={t.token}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onInsert(t.token) }}
          title={t.hint}
          className="text-[9px] font-mono text-stage-mastering border border-stage-mastering/40 rounded-full px-2 py-0.5 hover:bg-stage-mastering/10 font-bold"
        >
          + {t.label}
        </button>
      ))}
    </div>
  )
}
