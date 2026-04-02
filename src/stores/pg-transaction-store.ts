import { Pool } from 'pg';
import { ITransactionStore } from '../types/store';
import { Transaction } from '../types/wallet';

export class PgTransactionStore implements ITransactionStore {
  constructor(private pool: Pool) {}

  async create(tx: Transaction): Promise<Transaction> {
    await this.pool.query(
      `INSERT INTO transactions (id, from_wallet_id, to_wallet_id, amount, currency, status,
        signature, signed_payload, policy_evaluations, failure_reason, memo, created_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [tx.id, tx.fromWalletId, tx.toWalletId, tx.amount.toString(), tx.currency, tx.status,
       tx.signature, tx.signedPayload, JSON.stringify(tx.policyEvaluations),
       tx.failureReason || null, tx.memo || null, tx.createdAt, tx.completedAt || null]
    );
    return tx;
  }

  async findById(id: string): Promise<Transaction | null> {
    const { rows } = await this.pool.query('SELECT * FROM transactions WHERE id = $1', [id]);
    return rows[0] ? this.toTx(rows[0]) : null;
  }

  async findByWalletId(walletId: string, limit = 100, offset = 0): Promise<Transaction[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM transactions WHERE from_wallet_id = $1 OR to_wallet_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [walletId, limit, offset]
    );
    return rows.map(r => this.toTx(r));
  }

  async findAll(limit = 100, offset = 0): Promise<Transaction[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM transactions ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return rows.map(r => this.toTx(r));
  }

  async update(id: string, updates: Partial<Transaction>): Promise<Transaction> {
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;

    if (updates.status !== undefined)      { sets.push(`status = $${i++}`);       vals.push(updates.status); }
    if (updates.completedAt !== undefined)  { sets.push(`completed_at = $${i++}`); vals.push(updates.completedAt); }
    if (updates.signature !== undefined)    { sets.push(`signature = $${i++}`);    vals.push(updates.signature); }

    vals.push(id);
    await this.pool.query(`UPDATE transactions SET ${sets.join(', ')} WHERE id = $${i}`, vals);

    const tx = await this.findById(id);
    if (!tx) throw new Error('Transaction not found after update');
    return tx;
  }

  private toTx(row: any): Transaction {
    return {
      id:                row.id,
      fromWalletId:      row.from_wallet_id,
      toWalletId:        row.to_wallet_id,
      amount:            BigInt(row.amount || '0'),
      currency:          row.currency,
      status:            row.status,
      signature:         row.signature || '',
      signedPayload:     row.signed_payload || '',
      policyEvaluations: row.policy_evaluations || [],
      failureReason:     row.failure_reason || undefined,
      memo:              row.memo || undefined,
      createdAt:         new Date(row.created_at),
      completedAt:       row.completed_at ? new Date(row.completed_at) : undefined,
    };
  }
}
