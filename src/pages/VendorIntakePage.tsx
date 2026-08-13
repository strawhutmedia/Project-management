import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, type ApiIntakeContext } from '../api'

// PUBLIC page (no login) — a contractor opens their private link and submits
// their W9 + address. The SSN/EIN is sent over HTTPS and stored encrypted;
// bank details are handled separately in Melio, never collected here.
const CLASSES: { value: string; label: string }[] = [
  { value: 'individual', label: 'Individual' },
  { value: 'sole_proprietor', label: 'Sole proprietor' },
  { value: 'single_member_llc', label: 'Single-member LLC' },
  { value: 'llc', label: 'LLC (multi-member)' },
  { value: 'partnership', label: 'Partnership' },
  { value: 's_corp', label: 'S corporation' },
  { value: 'c_corp', label: 'C corporation' },
  { value: 'trust_estate', label: 'Trust / estate' },
  { value: 'other', label: 'Other' },
]

const input = 'w-full bg-ink/60 border border-line rounded-xl px-3 py-2.5 text-text placeholder:text-muted/50 focus:outline-none focus:border-stage-mastering/60'
const lbl = 'text-[11px] uppercase tracking-wider font-bold text-muted'

export default function VendorIntakePage() {
  const { token = '' } = useParams()
  const [ctx, setCtx] = useState<ApiIntakeContext | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  const [legalName, setLegalName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [taxClassification, setTaxClassification] = useState('')
  const [tinType, setTinType] = useState<'ssn' | 'ein'>('ssn')
  const [tin, setTin] = useState('')
  const [address, setAddress] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [isUsPerson, setIsUsPerson] = useState(true)
  const [prefersAch, setPrefersAch] = useState(true)
  const [signature, setSignature] = useState('')
  const [certified, setCertified] = useState(false)

  useEffect(() => {
    api.intakeContext(token)
      .then((c) => { setCtx(c); setLegalName(c.contractorName || '') })
      .catch(() => setLoadErr('This link is invalid or has expired. Please contact the company that sent it.'))
  }, [token])

  async function submit() {
    setErr('')
    if (!legalName.trim()) { setErr('Please enter your legal name.'); return }
    if (!taxClassification) { setErr('Please choose a tax classification.'); return }
    if (tin.replace(/\D/g, '').length !== 9) { setErr('Your SSN or EIN must be 9 digits.'); return }
    if (!address.trim()) { setErr('Please enter your mailing address.'); return }
    if (!isUsPerson) { setErr('This form is for U.S. persons. Please contact the company for a W-8BEN.'); return }
    if (!signature.trim()) { setErr('Please type your name to sign.'); return }
    if (!certified) { setErr('Please check the certification box to continue.'); return }
    setSubmitting(true)
    try {
      await api.intakeSubmit(token, {
        legalName, businessName, taxClassification, tinType, tin,
        address, email, phone, isUsPerson, prefersAch, signature, certified,
      })
      setDone(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink text-text px-4 py-10">
      <div className="max-w-xl mx-auto">
        {loadErr ? (
          <div className="rounded-2xl border border-line bg-panel/60 p-8 text-center">
            <div className="text-2xl mb-2">🔒</div>
            <p className="text-muted">{loadErr}</p>
          </div>
        ) : !ctx ? (
          <p className="text-muted text-sm text-center py-20">Loading…</p>
        ) : done ? (
          <div className="rounded-2xl border border-stage-done/40 bg-stage-done/10 p-8 text-center">
            <div className="text-3xl mb-3">✅</div>
            <h1 className="font-display text-3xl mb-2">Thank you!</h1>
            <p className="text-muted">Your information has been securely submitted to {ctx.companyName}.
              {prefersAch && ' If you chose ACH, you’ll receive a separate secure request from Melio to add your bank details.'}</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-6">
              {ctx.companyLogo
                ? <img src={ctx.companyLogo} alt="" className="w-12 h-12 object-contain" />
                : <div className="w-12 h-12 rounded-xl grid place-items-center text-white font-extrabold" style={{ background: '#A96B12' }}>SH</div>}
              <div>
                <div className="font-bold text-lg">{ctx.companyName}</div>
                <div className="text-xs text-muted">Vendor / contractor information</div>
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-panel/60 p-5 sm:p-6 space-y-4">
              <div className="flex items-start gap-2 text-xs text-muted bg-ink/50 border border-line rounded-xl p-3">
                <span>🔒</span>
                <span>Your details are sent securely and your SSN/EIN is stored <b className="text-text">encrypted</b>. Only {ctx.companyName} can see it. We do <b className="text-text">not</b> collect your bank account here.</span>
              </div>
              {ctx.alreadyOnFile && (
                <div className="text-xs text-stage-done bg-stage-done/10 border border-stage-done/40 rounded-xl p-3">
                  You already have information on file. Submitting again will update it.
                </div>
              )}
              {!ctx.vaultReady && (
                <div className="text-xs text-urgent bg-urgent/10 border border-urgent/40 rounded-xl p-3">
                  This form isn’t accepting submissions yet. Please check back shortly or contact {ctx.companyName}.
                </div>
              )}

              <Field label="Legal name (as on your tax return)"><input className={input} value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Jordan Rivera" /></Field>
              <Field label="Business name (if different, optional)"><input className={input} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Optional" /></Field>
              <Field label="Federal tax classification">
                <select className={input} value={taxClassification} onChange={(e) => setTaxClassification(e.target.value)}>
                  <option value="">— Select —</option>
                  {CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>

              <div className="grid grid-cols-[auto,1fr] gap-3">
                <Field label="ID type">
                  <select className={input} value={tinType} onChange={(e) => setTinType(e.target.value as 'ssn' | 'ein')}>
                    <option value="ssn">SSN</option>
                    <option value="ein">EIN</option>
                  </select>
                </Field>
                <Field label={tinType === 'ssn' ? 'Social Security Number' : 'Employer ID Number'}>
                  <input className={input} value={tin} inputMode="numeric" autoComplete="off"
                    onChange={(e) => setTin(e.target.value)} placeholder={tinType === 'ssn' ? '123-45-6789' : '12-3456789'} />
                </Field>
              </div>

              <Field label="Mailing address"><input className={input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, City, State ZIP" /></Field>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Email"><input className={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" /></Field>
                <Field label="Phone (optional)"><input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" /></Field>
              </div>

              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="mt-1" checked={prefersAch} onChange={(e) => setPrefersAch(e.target.checked)} />
                <span>I'd like to be paid by <b>ACH (direct deposit)</b>. <span className="text-muted">You'll get a separate secure request from Melio to enter your bank details — {ctx.companyName} never stores your account number.</span></span>
              </label>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="mt-1" checked={isUsPerson} onChange={(e) => setIsUsPerson(e.target.checked)} />
                <span>I am a <b>U.S. person</b> (U.S. citizen or resident).</span>
              </label>

              <div className="border-t border-line pt-4 space-y-3">
                <Field label="Signature — type your full legal name"><input className={input} value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="Jordan Rivera" /></Field>
                <label className="flex items-start gap-2 text-xs text-muted cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={certified} onChange={(e) => setCertified(e.target.checked)} />
                  <span>Under penalties of perjury, I certify that the taxpayer identification number I provided is correct, and the information above is true. (W-9 certification)</span>
                </label>
              </div>

              {err && <div className="text-sm text-urgent bg-urgent/10 border border-urgent/40 rounded-xl p-3">{err}</div>}

              <button onClick={submit} disabled={submitting || !ctx.vaultReady}
                className="w-full rounded-full py-3 font-bold text-white bg-gradient-to-r from-stage-producing to-stage-mastering hover:opacity-90 disabled:opacity-50 transition">
                {submitting ? 'Submitting…' : 'Submit securely'}
              </button>
            </div>
            <p className="text-center text-[11px] text-muted mt-4">Sent securely to {ctx.companyName}. Powered by Slate.</p>
          </>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1 block"><span className={lbl}>{label}</span>{children}</label>
}
