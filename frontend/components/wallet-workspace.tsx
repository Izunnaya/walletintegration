'use client'

import { useEffect, useRef, useState } from 'react'
import { LoginPreview, TransferReceipt } from '@/components/wallet-previews'
import { ArrowUpRight, ArrowDownLeft, ArrowLeftRight, ArrowRight, LayoutDashboard, Users, Plus, Wallet, ChevronDown, Copy, ShieldCheck, Sun, Moon, Menu, X, CircleHelp, Check, Search, Landmark, LockKeyhole } from 'lucide-react'
import { toast, Toaster } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Transactions, StatusBadge } from '@/components/transactions'
import { initialUsers, initialTransactions, money, toMinor, type WalletUser, type Transaction } from '@/lib/wallet-demo'
import { cn } from '@/lib/utils'

type Screen = 'Overview' | 'Transfer' | 'Transactions' | 'User management' | 'Create account'
const navigation = [{ name: 'Overview', icon: LayoutDashboard }, { name: 'Transfer', icon: ArrowUpRight }, { name: 'Transactions', icon: ArrowLeftRight }] as const
const descriptions: Record<Screen, string> = { Overview: 'A little clarity for your everyday money.', Transfer: 'Move money simply. From your wallet to theirs.', Transactions: 'Every movement, all in one place.', 'User management': 'Manage accounts and keep your workspace secure.', 'Create account': 'A fresh start for someone’s money.' }

export default function WalletWorkspace() {
  const [screen, setScreen] = useState<Screen>('Overview')
  const [users, setUsers] = useState(initialUsers)
  const [transactions, setTransactions] = useState(initialTransactions)
  const [dark, setDark] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [viewState, setViewState] = useState('Default')
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [manage, setManage] = useState<WalletUser | null>(null)
  const [created, setCreated] = useState<WalletUser | null>(null)
  const [help, setHelp] = useState(false)
  const inFlight = useRef(false)
  const intent = useRef<{ key: string; recipient: string; amountMinor: string } | null>(null)
  const completed = useRef(new Map<string, Transaction>())
  const [outcome, setOutcome] = useState('Success')
  const [result, setResult] = useState<Transaction | null>(null)
  const [detail, setDetail] = useState<Transaction | null>(null)
  const [unknown, setUnknown] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [waking, setWaking] = useState(false)
  const [reason, setReason] = useState('')
  const audit = useRef<{ wallet: string; reason: string; time: string }[]>([])
  const [role, setRole] = useState('admin')
  const [loginPreview, setLoginPreview] = useState(false)
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    if (!countdown) return
    const timer = setTimeout(() => setCountdown(value => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])
  useEffect(() => {
    setWaking(false)
    if (viewState !== 'Loading') return
    const timer = setTimeout(() => setWaking(true), 3000)
    return () => clearTimeout(timer)
  }, [viewState])
  const current = users[0]
  function navigate(next: Screen) { setScreen(next); setMobile(false); setError(''); setViewState('Default'); setResult(null); setDetail(null) }
  function fail(message: string) { setError(message); toast.error(message) }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); toast.success('Wallet ID copied') } catch { toast.error('Could not copy. Please select the wallet ID manually.') } }
  function review(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (target.trim() === current.id) return fail('Choose a wallet other than your own.')
    if (current.status !== 'Active') return fail('Sender restricted. You cannot send transfers.')
    let amountMinor: string
    try { amountMinor = toMinor(amount) } catch (e) { return fail((e as Error).message) }
    if (!intent.current || intent.current.recipient !== target.trim() || intent.current.amountMinor !== amountMinor) {
      intent.current = { key: crypto.randomUUID(), recipient: target.trim(), amountMinor }
      setUnknown(false)
    }
    setConfirm(true)
  }
  async function send() {
    if (inFlight.current || countdown || !intent.current) return
    inFlight.current = true; setBusy(true); setError('')
    const request = { ...intent.current }
    try {
      await new Promise(resolve => setTimeout(resolve, 700))
      if (outcome === '401') { setExpired(true); setLoginPreview(true); setConfirm(false); intent.current = null; setUnknown(false); return }
      if (outcome === '429') { setCountdown(10); setError('Too many requests.'); return }
      if (outcome === '409') { setError('This request conflicts with an earlier one. Please start a new transfer.'); return }
      if (outcome === 'Unknown' && !unknown) { setUnknown(true); setError("We couldn't confirm this transfer yet"); return }
      const recipient = users.find(u => u.id === request.recipient)
      if (!recipient) { setError('Wallet not found. Check the wallet ID and try again.'); return }
      if (current.status !== 'Active') { setError('Sender restricted. You cannot send transfers.'); return }
      if (recipient.status !== 'Active') { setError('Recipient restricted. This wallet cannot receive transfers.'); return }
      if (BigInt(request.amountMinor) > BigInt(current.balance)) { setError('Insufficient funds. Enter an amount within your available balance.'); return }
      let transfer = completed.current.get(request.key)
      if (!transfer) {
        transfer = { id: `tx_${crypto.randomUUID()}`, name: recipient.name, wallet: recipient.id, amount: request.amountMinor, direction: 'Sent', status: 'Completed', date: new Date().toISOString(), note }
        completed.current.set(request.key, transfer)
        setUsers(prev => prev.map(u => u.id === current.id ? { ...u, balance: (BigInt(u.balance) - BigInt(request.amountMinor)).toString() } : u.id === recipient.id ? { ...u, balance: (BigInt(u.balance) + BigInt(request.amountMinor)).toString() } : u))
        setTransactions(prev => [transfer!, ...prev])
      }
      setResult(transfer); setUnknown(false); intent.current = null; setConfirm(false); setAmount(''); setTarget(''); toast.success('Demo transfer completed')
    } finally { setBusy(false); inFlight.current = false }
  }
  async function createAccount(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); const form = new FormData(e.currentTarget)
    const payload = { name: String(form.get('name')).trim(), email: String(form.get('email')).trim().toLowerCase(), password: String(form.get('password')) }
    const { name, email } = payload
    if (!name || !email || !payload.password) return fail('Enter a name, valid email, and password.')
    if (users.some(u => u.email === email && u.status === 'Blacklisted')) return fail('This email cannot be registered.')
    if (users.some(u => u.email === email)) return fail('Email already registered.')
    setBusy(true); await new Promise(resolve => setTimeout(resolve, 700))
    const user: WalletUser = { id: `wlt_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`, name, email, status: 'Active', balance: '0' }
    setUsers(prev => [...prev, user]); setCreated(user); setBusy(false); toast.success('Demo account created')
  }
  const visibleTransactions = viewState === 'Empty' ? [] : transactions
  const visibleUsers = viewState === 'Empty' ? [] : users.filter(u => `${u.name} ${u.email} ${u.id}`.toLowerCase().includes(search.toLowerCase()))
  if (loginPreview) return <LoginPreview expired={expired} onBack={() => { setLoginPreview(false); setExpired(false) }} />
  return <div className="min-h-screen bg-background text-foreground">
    <Toaster position="bottom-right" theme={dark ? 'dark' : 'light'} />
    {mobile && <button aria-label="Close navigation" onClick={() => setMobile(false)} className="fixed inset-0 z-30 bg-black/25 md:hidden" />}
    <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[232px] flex-col border-r bg-sidebar transition-transform md:translate-x-0', mobile ? 'translate-x-0' : '-translate-x-full')}>
      <a href="#" onClick={e => { e.preventDefault(); navigate('Overview') }} className="flex h-[84px] items-center gap-2.5 px-7"><span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background"><Wallet className="size-4.5" strokeWidth={2.1} /></span><span className="text-[23px] font-semibold tracking-[-1px]">folio<span className="text-muted-foreground">.</span></span></a>
      <div className="mx-4 mb-7 flex items-center gap-3 rounded-lg border bg-background px-3 py-3"><span className="flex size-8 items-center justify-center rounded-md bg-muted text-xs font-semibold">AM</span><div className="flex-1"><p className="text-xs font-medium">Personal workspace</p><p className="mt-1 text-[11px] text-muted-foreground">Demo account</p></div><LockKeyhole className="size-3.5 text-muted-foreground" /></div>
      <nav aria-label="Main navigation" className="flex flex-col gap-1 px-3"><p className="mb-2 px-3 text-[10px] font-medium tracking-[1.3px] text-muted-foreground">WORKSPACE</p>{navigation.map(({ name, icon: Icon }) => <button key={name} onClick={() => navigate(name)} className={cn('nav-item', screen === name && 'nav-active')} aria-current={screen === name ? 'page' : undefined}><Icon className="size-[17px]" />{name}{screen === name && <span className="ml-auto size-1.5 rounded-full bg-foreground" />}</button>)}{role === 'admin' && <><p className="mb-2 mt-8 px-3 text-[10px] font-medium tracking-[1.3px] text-muted-foreground">ADMINISTRATION</p><button onClick={() => navigate('User management')} className={cn('nav-item', screen === 'User management' && 'nav-active')}><Users className="size-[17px]" />User management</button><button onClick={() => { setCreated(null); navigate('Create account') }} className={cn('nav-item', screen === 'Create account' && 'nav-active')}><Plus className="size-[17px]" />Create account</button></>}<button className="nav-item mt-4" onClick={() => setLoginPreview(true)}><LockKeyhole className="size-4" />Login preview</button></nav>
      <div className="mt-auto px-4 pb-4"><div className="mb-5 rounded-lg border p-3.5"><div className="flex items-center gap-2 text-xs font-medium"><ShieldCheck className="size-4" />A little peace of mind.</div><p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Your money, with a clearer view.<br />Every movement accounted for.</p></div><button className="nav-item w-full" onClick={() => setHelp(true)}><CircleHelp className="size-4" />Help & support<ArrowUpRight className="ml-auto size-3.5" /></button><div className="mt-3 flex items-center gap-3 border-t pt-4"><span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium">AM</span><div className="flex-1"><p className="text-xs font-medium">Alex Morgan</p><p className="mt-0.5 text-[10px] text-muted-foreground">alex@studio.co</p></div><Button variant="ghost" size="icon-sm" aria-label="Toggle dark mode" onClick={() => { setDark(!dark); document.documentElement.classList.toggle('dark', !dark) }}>{dark ? <Sun /> : <Moon />}</Button></div></div>
    </aside>
    <div className="md:pl-[232px]"><header className="flex h-16 items-center justify-between border-b px-5 lg:px-10"><div className="flex items-center gap-3"><Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open navigation" onClick={() => setMobile(true)}><Menu /></Button><span className="text-xs text-muted-foreground">Workspace</span><span className="text-muted-foreground/40">/</span><span className="text-xs font-medium">{screen}</span></div><div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className="size-1.5 rounded-full bg-success" />Demo workspace</div></header>
      <main className="mx-auto max-w-[1240px] px-5 py-9 lg:px-10 lg:py-10">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">{screen === 'Overview' && <><span className="size-1.5 rounded-full bg-success" /> YOUR PERSONAL WALLET</>}</div><h1 className="text-[28px] font-semibold tracking-[-1px]">{screen === 'Overview' ? 'Good morning, Alex' : screen}</h1><p className="mt-2 text-[13px] text-muted-foreground">{descriptions[screen]}</p></div>{screen === 'Overview' && <Button disabled={current.status !== 'Active'} onClick={() => navigate('Transfer')} className="mt-5"><ArrowUpRight data-icon="inline-start" />Send money</Button>}</div>
        {current.status !== 'Active' && <Alert className="mb-6"><AlertDescription>Your account is restricted. You can&apos;t send or receive transfers.</AlertDescription></Alert>}
        <div key={screen} className="page-enter">
        {result || detail ? <TransferReceipt transfer={(result || detail)!} success={!!result} onBack={() => { setResult(null); setDetail(null) }} /> : <>
        {viewState === 'Loading' ? <div aria-label="Loading wallet" className="flex flex-col gap-6">{waking && <p role="status" className="text-sm text-muted-foreground">Waking up the server, this can take up to a minute.</p>}<Skeleton className="h-60 w-full rounded-xl" /><Skeleton className="h-80 w-full rounded-xl" /></div> : <>
        {screen === 'Overview' && <><section className="mb-7 overflow-hidden rounded-xl border bg-card"><div className="flex flex-col justify-between gap-8 p-6 sm:flex-row lg:p-7"><div><div className="flex items-center gap-2 text-xs text-muted-foreground"><Wallet className="size-4" />Available balance</div><div className="mt-5 flex items-baseline gap-3"><span className="text-[44px] font-medium leading-none tracking-[-2px] sm:text-[50px]">{money(viewState === 'Empty' ? '0' : current.balance).split('.')[0]}<span className="text-muted-foreground/60">.{money(current.balance).split('.')[1]}</span></span><span className="text-xs text-muted-foreground">NGN</span></div><div className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground"><span className="size-1.5 rounded-full bg-success" />Available to send</div></div><div className="flex flex-col items-start justify-between gap-6 sm:items-end"><StatusBadge status={current.status} /><div className="rounded-lg border bg-muted/35 px-4 py-3"><p className="mb-2 text-[10px] font-medium tracking-wider text-muted-foreground">WALLET ID</p><div className="flex items-center gap-5"><code className="text-xs">{current.id}</code><button aria-label="Copy wallet ID" onClick={() => copy(current.id)} className="text-muted-foreground hover:text-foreground"><Copy className="size-3.5" /></button></div></div></div></div><div className="grid border-t bg-muted/20 sm:grid-cols-3"><Summary icon={ArrowDownLeft} label="Money in" value={money(visibleTransactions.filter(t => t.direction === 'Received' && t.status === 'Completed').reduce((sum, t) => sum + BigInt(t.amount), BigInt(0)))} /><Summary icon={ArrowUpRight} label="Money out" value={money(visibleTransactions.filter(t => t.direction === 'Sent' && t.status === 'Completed').reduce((sum, t) => sum + BigInt(t.amount), BigInt(0)))} /><Summary icon={ArrowLeftRight} label="Transactions" value={String(visibleTransactions.length).padStart(2, '0')} /></div></section><Transactions onSelect={setDetail} transactions={visibleTransactions} onViewAll={() => navigate('Transactions')} /><div className="mt-6 flex items-center gap-2 text-[11px] text-muted-foreground"><ShieldCheck className="size-3.5" /><span>A clear record. Every transfer, every time.</span><span className="ml-auto hidden sm:block">NGN · United States Dollar</span></div></>}
        {screen === 'Transactions' && <Transactions onSelect={setDetail} full transactions={visibleTransactions} />}
        {screen === 'Transfer' && <div className="grid items-start gap-7 lg:grid-cols-[1.5fr_1fr]"><section className="rounded-xl border p-6"><h2 className="mb-1 text-base font-semibold">Send a transfer</h2><p className="mb-7 text-xs text-muted-foreground">Transfers between wallets are instant and free.</p><form onSubmit={review}><FieldGroup><Field><FieldLabel htmlFor="from">From wallet</FieldLabel><Input id="from" readOnly value={current.id} /><FieldDescription>Available: {money(current.balance)}</FieldDescription></Field><Field data-invalid={!!error}><FieldLabel htmlFor="to">To wallet ID</FieldLabel><Input id="to" placeholder="wlt_…" required value={target} onChange={e => { setTarget(e.target.value); intent.current = null; setUnknown(false); setError('') }} aria-invalid={!!error} /></Field><Field><FieldLabel htmlFor="amount">Amount (NGN)</FieldLabel><Input id="amount" inputMode="decimal" placeholder="0.00" required value={amount} onChange={e => { setAmount(e.target.value); intent.current = null; setUnknown(false); setError('') }} /></Field><Field><FieldLabel htmlFor="note">Note <span className="text-muted-foreground">(optional)</span></FieldLabel><Input id="note" placeholder="What’s it for?" maxLength={140} value={note} onChange={e => setNote(e.target.value)} /></Field>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<Button type="submit" disabled={busy || current.status !== 'Active'}>Review transfer<ArrowRight data-icon="inline-end" /></Button></FieldGroup></form></section><section className="rounded-xl border bg-muted/25 p-6"><div className="mb-3 flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4" />Send with confidence</div><p className="text-xs leading-6 text-muted-foreground">Double-check the recipient’s wallet ID. You’ll review all the details before confirming your transfer.</p><label className="mt-5 flex flex-col gap-2 text-xs">Demo response<select aria-label="Demo response" className="rounded border bg-background p-2" value={outcome} onChange={e => setOutcome(e.target.value)}><option value="Success">Success / wallet validation (422)</option><option value="Unknown">Unknown outcome, then successful retry</option><option value="409">409 · Conflict</option><option value="429">429 · Rate limited (10 seconds)</option><option value="401">401 · Session expired preview</option></select></label><p className="mb-3 mt-6 text-[10px] font-medium tracking-wider text-muted-foreground">DEMO RECIPIENTS</p>{users.slice(1).map(u => <button key={u.id} onClick={() => { if (target !== u.id) { intent.current = null; setUnknown(false) }; setTarget(u.id); setError('') }} className="flex w-full items-center justify-between gap-2 border-t py-3 text-left"><div><p className="text-xs font-medium">{u.name}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{u.id}</p></div><ArrowUpRight className="size-3.5 text-muted-foreground" /></button>)}</section></div>}
        {role === 'admin' && screen === 'Create account' && <section className="max-w-xl rounded-xl border p-6">{created ? <div className="flex flex-col gap-5"><span className="flex size-10 items-center justify-center rounded-full bg-success/10 text-success"><Check className="size-5" /></span><h2 className="text-xl font-semibold">A new wallet, ready to go.</h2><p className="text-sm text-muted-foreground">{created.name} · {created.email}</p><div className="flex items-center justify-between rounded-lg border p-4"><code className="text-xs">{created.id}</code><Button variant="ghost" size="icon-sm" aria-label="Copy new wallet ID" onClick={() => copy(created.id)}><Copy /></Button></div><p className="text-sm">Initial balance: {money(created.balance)}</p><Button onClick={() => navigate('User management')}>View accounts<ArrowRight /></Button></div> : <><h2 className="text-base font-semibold">Account details</h2><p className="mb-7 mt-1 text-xs text-muted-foreground">Create an account and its wallet in one simple step.</p><form onSubmit={createAccount}><FieldGroup><Field><FieldLabel htmlFor="name">Full name</FieldLabel><Input id="name" name="name" placeholder="e.g. Jamie Taylor" required maxLength={100} /></Field><Field><FieldLabel htmlFor="email">Email address</FieldLabel><Input id="email" name="email" type="email" placeholder="jamie@example.com" required /></Field><Field><FieldLabel htmlFor="password">Password</FieldLabel><Input id="password" name="password" type="password" autoComplete="new-password" required /><FieldDescription>New wallets start at ₦0.00. Demo passwords are not stored.</FieldDescription></Field>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<Button type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}<Plus /></Button></FieldGroup></form></>}</section>}
        {role === 'admin' && screen === 'User management' && <section className="overflow-hidden rounded-xl border"><div className="flex flex-wrap items-center justify-between gap-4 p-5"><div><h2 className="text-sm font-semibold">All users <span className="ml-2 text-muted-foreground">{users.length}</span></h2><p className="mt-1 text-xs text-muted-foreground">Manage access to your wallet workspace.</p></div><div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input value={search} onChange={e => setSearch(e.target.value)} className="pl-9" placeholder="Search users…" aria-label="Search users" /></div></div><Table><TableHeader><TableRow className="bg-muted/40"><TableHead className="pl-5">User</TableHead><TableHead>Wallet ID</TableHead><TableHead>Status</TableHead><TableHead className="pr-5 text-right">Action</TableHead></TableRow></TableHeader><TableBody>{visibleUsers.map(u => <TableRow key={u.id}><TableCell className="py-5 pl-5"><p className="font-medium">{u.name}</p><p className="mt-1 text-xs text-muted-foreground">{u.email}</p></TableCell><TableCell className="font-mono text-xs text-muted-foreground">{u.id}</TableCell><TableCell><StatusBadge status={u.status} /></TableCell><TableCell className="pr-5 text-right"><Button variant="outline" size="sm" disabled={u.status === 'Blacklisted'} onClick={() => { setReason(''); setManage(u) }}>{u.status === 'Blocked' || u.status === 'Blacklisted' ? 'Unblock' : 'Block'}</Button>{u.status === 'Blacklisted' && <p className="mt-2 max-w-48 text-xs text-muted-foreground">Blacklist restrictions can&apos;t be lifted from here.</p>}</TableCell></TableRow>)}</TableBody></Table>{!visibleUsers.length && <Empty><EmptyHeader><EmptyTitle>No users found</EmptyTitle><EmptyDescription>Try another name, email, or wallet ID.</EmptyDescription></EmptyHeader></Empty>}</section>}
        </>}
        </>}
        </div>
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-[10px] text-muted-foreground"><span>Folio workspace <span className="mx-2">·</span> Interactive demo. No real funds. Changes reset on reload.</span><label className="flex items-center gap-2">Preview role<select aria-label="Preview role" className="rounded border bg-background px-2 py-1" value={role} onChange={e => { setRole(e.target.value); navigate('Overview') }}><option value="admin">Admin</option><option value="user">User</option></select></label><label className="flex items-center gap-2">Preview state <select aria-label="Preview state" value={viewState} onChange={e => setViewState(e.target.value)} className="rounded border bg-background px-2 py-1 text-foreground"><option>Default</option><option>Loading</option><option>Empty</option></select></label></footer>
      </main>
    </div>
    <Dialog open={confirm} onOpenChange={v => { if (!busy) setConfirm(v) }}><DialogContent showCloseButton={!busy}><DialogHeader><DialogTitle>{unknown ? 'Awaiting confirmation' : 'Review your transfer'}</DialogTitle><DialogDescription>Dummy-data preview. Check these details before sending.</DialogDescription></DialogHeader><div className="my-4 flex flex-col gap-4"><p className="text-3xl font-semibold tracking-tight">{money(intent.current?.amountMinor || '0')}</p><div className="flex justify-between text-xs"><span className="text-muted-foreground">To</span><span>{users.find(u => u.id === target)?.name}</span></div><code className="break-all rounded-md bg-muted p-3 text-xs">{intent.current?.recipient}</code><div className="flex justify-between text-xs"><span className="text-muted-foreground">Transfer fee</span><span>₦0.00</span></div><p className="break-all text-[10px] text-muted-foreground">Idempotency-Key: {intent.current?.key}</p>{error && <Alert variant={unknown ? 'default' : 'destructive'}><AlertDescription><p>{error}</p><p className="mt-2 break-all text-[10px]">Request ID: demo-{intent.current?.key}</p></AlertDescription></Alert>}</div><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>Go back</Button>{outcome === '409' && error ? <Button onClick={() => { intent.current = null; setUnknown(false); setError(''); setConfirm(false); setTarget(''); setAmount('') }}>Start a new transfer</Button> : <Button disabled={busy || countdown > 0} onClick={send}>{busy ? 'Checking…' : countdown ? `Retry in ${countdown}s` : unknown ? 'Check status' : 'Confirm transfer'}<ArrowUpRight /></Button>}</DialogFooter></DialogContent></Dialog>
    <Dialog open={!!manage} onOpenChange={v => { if (!v) setManage(null) }}><DialogContent><DialogHeader><DialogTitle>{manage?.status === 'Blocked' ? 'Unblock' : 'Block'} {manage?.name}?</DialogTitle><DialogDescription>{manage?.status === 'Blocked' ? 'This user will be able to send and receive transfers again.' : 'This user will not be able to send or receive transfers.'} A reason is required for the audit record.</DialogDescription></DialogHeader><FieldGroup><Field><FieldLabel htmlFor="admin-reason">Reason</FieldLabel><Input id="admin-reason" required value={reason} onChange={e => setReason(e.target.value)} placeholder="Explain why this action is needed" /><FieldDescription>Demo audit records are temporary and reset on reload.</FieldDescription></Field></FieldGroup><DialogFooter><Button variant="outline" onClick={() => setManage(null)}>Cancel</Button><Button disabled={!reason.trim()} onClick={() => { if (!manage || !reason.trim() || manage.status === 'Blacklisted' || role !== 'admin') return; audit.current.push({ wallet: manage.id, reason: reason.trim(), time: new Date().toISOString() }); setUsers(prev => prev.map(u => u.id === manage.id ? { ...u, status: u.status === 'Blocked' ? 'Active' : 'Blocked' } : u)); toast.success(manage.status === 'Blocked' ? 'User unblocked' : 'User blocked'); setManage(null) }}>Confirm {manage?.status === 'Blocked' ? 'unblock' : 'block'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent><DialogHeader><DialogTitle>Welcome to your demo workspace</DialogTitle><DialogDescription>Explore transfers using the demo recipients, create accounts, or manage user access. All changes are temporary and no real funds move. Use the preview state selector to inspect loading and empty states.</DialogDescription></DialogHeader></DialogContent></Dialog>
  </div>
}
function Summary({ icon: Icon, label, value }: { icon: typeof Wallet; label: string; value: string }) { return <div className="flex items-start gap-3 border-b px-6 py-5 last:border-0 sm:border-r sm:border-b-0 lg:px-7"><span className="mt-0.5 flex size-8 items-center justify-center rounded-lg border bg-background"><Icon className="size-3.5 text-muted-foreground" /></span><div><p className="text-[11px] text-muted-foreground">{label}<span className="ml-2 text-[9px] text-muted-foreground/70">THIS MONTH</span></p><p className="mt-2 text-xl font-medium tracking-tight">{value}</p></div></div> }
