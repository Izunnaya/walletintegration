'use client'

import { Wallet, ArrowLeft, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { money, type Transaction } from '@/lib/wallet-demo'

export function LoginPreview({ expired, onBack }: { expired: boolean; onBack: () => void }) {
  return <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground"><section className="w-full max-w-sm"><Wallet className="mb-8 size-9" /><h1 className="text-3xl font-semibold tracking-tight">Welcome back.</h1><p className="mb-8 mt-2 text-sm text-muted-foreground">A clearer view of your money.</p>{expired && <Alert className="mb-5"><AlertDescription>Your session has expired.</AlertDescription></Alert>}<form onSubmit={e => e.preventDefault()}><FieldGroup><Field><FieldLabel htmlFor="login-email">Email</FieldLabel><Input id="login-email" type="email" autoComplete="email" placeholder="you@example.com" /></Field><Field><FieldLabel htmlFor="login-password">Password</FieldLabel><Input id="login-password" type="password" autoComplete="current-password" /></Field><Button disabled type="submit">Sign in — backend not connected</Button><p className="text-xs leading-relaxed text-muted-foreground">UI preview only. No credentials are sent or stored, and this demo does not authenticate users.</p><Button type="button" variant="outline" onClick={onBack}>Return to dummy-data workspace</Button></FieldGroup></form></section></main>
}
export function TransferReceipt({ transfer, success = false, onBack }: { transfer: Transaction; success?: boolean; onBack: () => void }) {
  return <section className="max-w-xl rounded-xl border bg-card p-6"><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft />Back to workspace</Button><div className="my-6 flex size-10 items-center justify-center rounded-full bg-success/10 text-success"><Check className="size-5" /></div><h2 className="text-xl font-semibold">{success ? 'Transfer completed' : 'Transfer details'}</h2><p className="my-5 text-4xl tracking-tight">{money(transfer.amount)}</p><dl className="flex flex-col gap-5 text-sm">{[['Direction', transfer.direction], ['Counterparty', transfer.name], ['Counterparty wallet', transfer.wallet], ['Transfer reference', transfer.id], ['Time', new Date(transfer.date).toLocaleString()], ['Status', 'Completed']].map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-2 border-b pb-3"><dt className="text-muted-foreground">{label}</dt><dd className="break-all text-right">{value}</dd></div>)}</dl><p className="mt-6 text-xs text-muted-foreground">Dummy-data preview. No real funds moved.</p></section>
}
