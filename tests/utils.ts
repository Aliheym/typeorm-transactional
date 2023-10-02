import { QueryBuilder } from 'typeorm';

import { Counter } from './entities/Counter.entity';

interface IQueryable {
  query(query: string, parameters?: string[]): Promise<any>;
}

export const getCurrentTransactionId = async (
  queryable: IQueryable | (() => QueryBuilder<any>),
): Promise<number | null> => {
  let id: string | null = null;

  if (typeof queryable === 'function') {
    const qb = queryable();

    await qb
      .insert()
      .into('counters')
      .values({ value: () => 'DEFAULT' })
      .execute();

    const result = await qb
      .select('txid_current_if_assigned()', 'txid_current_if_assigned')
      .from(Counter, 'counter')
      .getRawOne();

    id = result?.txid_current_if_assigned || null;
  } else {
    await queryable.query('INSERT INTO "counters" values (default)');

    const result = await queryable.query('SELECT txid_current_if_assigned()');
    id = result[0]?.txid_current_if_assigned || null;
  }

  return id ? Number.parseInt(id, 10) : null;
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
