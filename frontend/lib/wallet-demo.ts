export { money, toMinor } from './money'
export type WalletUser = { id: string; name: string; email: string; status: 'Active' | 'Blocked' | 'Blacklisted'; balance: string }
export type Transaction = { id: string; name: string; wallet: string; amount: string; direction: 'Received' | 'Sent'; status: 'Completed'; date: string; note?: string }
export const initialUsers: WalletUser[] = [
  { id: 'wlt_8f2a9b3c4d5e', name: 'Alex Morgan', email: 'alex@studio.co', status: 'Active', balance: '1245000' },
  { id: 'wlt_6e4d2c8b1a9f', name: 'Olivia Rhye', email: 'olivia@acme.co', status: 'Active', balance: '480000' },
  { id: 'wlt_9c3b5a7d2e1f', name: 'Phoenix Baker', email: 'phoenix@studio.co', status: 'Active', balance: '210000' },
  { id: 'wlt_2b7c8d4e5f6a', name: 'Lana Steiner', email: 'lana@example.com', status: 'Blocked', balance: '85000' },
  { id: 'wlt_5a1b9c3d7e2f', name: 'Demi Wilkinson', email: 'demi@example.com', status: 'Blacklisted', balance: '0' },
]
export const initialTransactions: Transaction[] = [
  { id: 'tx_001', name: 'Olivia Rhye', wallet: initialUsers[1].id, amount: '250000', direction: 'Received', status: 'Completed', date: '2026-10-26T10:42:00Z' },
  { id: 'tx_002', name: 'Phoenix Baker', wallet: initialUsers[2].id, amount: '15000', direction: 'Sent', status: 'Completed', date: '2026-10-26T09:18:00Z' },
  { id: 'tx_003', name: 'Olivia Rhye', wallet: initialUsers[1].id, amount: '80000', direction: 'Received', status: 'Completed', date: '2026-10-25T16:30:00Z' },
  { id: 'tx_004', name: 'Phoenix Baker', wallet: initialUsers[2].id, amount: '32000', direction: 'Sent', status: 'Completed', date: '2026-10-25T14:12:00Z' },
  { id: 'tx_006', name: 'Olivia Rhye', wallet: initialUsers[1].id, amount: '120000', direction: 'Received', status: 'Completed', date: '2026-10-23T10:00:00Z' },
  { id: 'tx_007', name: 'Phoenix Baker', wallet: initialUsers[2].id, amount: '50000', direction: 'Sent', status: 'Completed', date: '2026-10-22T13:00:00Z' },
  { id: 'tx_008', name: 'Olivia Rhye', wallet: initialUsers[1].id, amount: '45000', direction: 'Received', status: 'Completed', date: '2026-10-21T10:00:00Z' },
]
