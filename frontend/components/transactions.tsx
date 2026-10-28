'use client'

import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, ArrowRight, ChevronLeft, ChevronRight, Search, ArrowLeftRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty'
import { money, type Transaction } from '@/lib/wallet-demo'

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" data-status={status} className="status-badge"><span className="size-1.5 rounded-full bg-current" />{status}</Badge>
}

export function Transactions({ transactions, full = false, onViewAll, onSelect }: { transactions: Transaction[]; full?: boolean; onViewAll?: () => void; onSelect?: (transfer: Transaction) => void }) {
  const [filter, setFilter] = useState('All transactions')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const filtered = transactions.filter(t => (filter === 'All transactions' || t.direction === filter || t.status === filter) && `${t.name} ${t.wallet}`.toLowerCase().includes(search.toLowerCase()))
  const pages = Math.max(1, Math.ceil(filtered.length / 6))
  const rows = full ? filtered.slice(Math.min(page, pages - 1) * 6, (Math.min(page, pages - 1) + 1) * 6) : transactions.slice(0, 5)
  return <section className="overflow-hidden rounded-xl border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5"><div><h2 className="text-[15px] font-semibold">{full ? 'All transactions' : 'Recent transactions'}</h2><p className="mt-1 text-xs text-muted-foreground">{full ? 'A complete record of your wallet activity.' : 'Your latest money movements, at a glance.'}</p></div>{!full && <Button variant="outline" size="sm" onClick={onViewAll}>View all <ArrowRight data-icon="inline-end" /></Button>}</div>
    {full && <div className="flex flex-wrap justify-between gap-3 border-t px-6 py-4"><Tabs value={filter} onValueChange={v => { setFilter(String(v)); setPage(0) }}><TabsList>{['All transactions', 'Sent', 'Received'].map(v => <TabsTrigger key={v} value={v}>{v}</TabsTrigger>)}</TabsList></Tabs><div className="relative"><Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input aria-label="Search transactions" placeholder="Search transactions…" className="pl-9" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} /></div></div>}
    <Table><TableHeader><TableRow className="bg-muted/40"><TableHead className="pl-6">Transaction</TableHead><TableHead>Amount</TableHead><TableHead>Reference</TableHead><TableHead className="pr-6 text-right">Date & time</TableHead></TableRow></TableHeader><TableBody>{rows.map(t => <TableRow key={t.id} className="cursor-pointer" tabIndex={0} aria-label={`View transfer ${t.id}`} onClick={() => onSelect?.(t)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(t) } }}><TableCell className="py-4 pl-6"><div className="flex items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-background">{t.direction === 'Received' ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}</span><div><p className="font-medium">{t.direction === 'Received' ? 'From' : 'To'} {t.name}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{t.wallet}</p></div></div></TableCell><TableCell><span className={t.direction === 'Received' && t.status === 'Completed' ? 'text-success font-medium tabular-nums' : 'font-medium tabular-nums'}>{t.direction === 'Received' ? '+' : '−'}{money(t.amount)}</span><p className="mt-1 text-[11px] text-muted-foreground">NGN · {t.direction}</p></TableCell><TableCell><code className="text-xs">{t.id}</code></TableCell><TableCell className="pr-6 text-right"><p className="text-xs">{new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p><p className="mt-1 text-[11px] text-muted-foreground">{new Date(t.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p></TableCell></TableRow>)}</TableBody></Table>
    {!rows.length && <Empty><EmptyHeader><EmptyMedia variant="icon"><ArrowLeftRight /></EmptyMedia><EmptyTitle>No transactions yet</EmptyTitle><EmptyDescription>Try a different filter or send your first transfer.</EmptyDescription></EmptyHeader></Empty>}
    <div className="flex items-center justify-between border-t px-6 py-3 text-xs text-muted-foreground"><span>{full ? `${filtered.length} transactions` : 'Showing your 5 most recent transactions'}</span>{full ? <div className="flex items-center gap-3"><Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft /></Button><span>{Math.min(page + 1, pages)} of {pages}</span><Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><ChevronRight /></Button></div> : <span className="hidden sm:inline">All times in your local timezone</span>}</div>
  </section>
}
