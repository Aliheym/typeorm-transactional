import { EntityManager } from 'typeorm';
import { TypeORMError } from 'typeorm/error/TypeORMError';
import {
  DataSourceName,
  getDataSourceByName,
  getEntityManagerByDataSourceName,
  getTransactionalContext,
  setEntityManagerByDataSourceName,
} from '../common';

import { IsolationLevel } from '../enums/isolation-level';
import { Propagation } from '../enums/propagation';
import { runInNewHookContext } from '../hooks';
import { TransactionalError } from '../errors/transactional';
import { Fail } from '../utils/result';

export interface WrapInTransactionOptions {
  /**
   * For compatibility with `typeorm-transactional-cls-hooked` we use `connectionName`
   */
  connectionName?: DataSourceName;

  propagation?: Propagation;

  isolationLevel?: IsolationLevel;

  name?: string | symbol;
}

export const wrapInTransaction = <Fn extends (this: any, ...args: any[]) => ReturnType<Fn>>(
  fn: Fn,
  options?: WrapInTransactionOptions,
) => {
  // eslint-disable-next-line func-style
  function wrapper(this: unknown, ...args: unknown[]) {
    const context = getTransactionalContext();
    if (!context) {
      throw new Error(
        'No CLS namespace defined in your app ... please call initializeTransactionalContext() before application start.',
      );
    }

    const connectionName = options?.connectionName ?? 'default';

    const dataSource = getDataSourceByName(connectionName);
    if (!dataSource) {
      throw new Error(
        'No data sources defined in your app ... please call addTransactionalDataSources() before application start.',
      );
    }

    const withTx = async <T>(
      isolationOrRunInTransaction: IsolationLevel | ((entityManager: EntityManager) => Promise<T>),
      runInTransactionParam?: (entityManager: EntityManager) => Promise<T>,
    ) => {
      const isolation =
        typeof isolationOrRunInTransaction === 'string' ? isolationOrRunInTransaction : undefined;
      const runInTransaction =
        typeof isolationOrRunInTransaction === 'function'
          ? isolationOrRunInTransaction
          : runInTransactionParam;
      if (!runInTransaction) {
        throw new TypeORMError(
          'Transaction method requires callback in second parameter if isolation level is supplied.',
        );
      }

      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();

      try {
        await queryRunner.startTransaction(isolation);
        const result = await runInTransaction(queryRunner.manager);
        if (result instanceof Fail) {
          await queryRunner.rollbackTransaction();
          return result;
        }
        await queryRunner.commitTransaction();
        return result;
      } catch (err) {
        try {
          // we throw original error even if rollback thrown an error
          await queryRunner.rollbackTransaction();
        } catch (rollbackError) {}
        if (err instanceof Fail) {
          return err;
        }
        throw err;
      } finally {
        // if we used a new query runner provider then release it
        await queryRunner.release();
      }
    };

    const propagation = options?.propagation ?? Propagation.REQUIRED;
    const isolationLevel = options?.isolationLevel;

    const runOriginal = () => fn.apply(this, args);
    const runOrFailOriginal = async () => {
      const result = await runOriginal();
      if (result instanceof Fail) {
        throw result;
      }
      return result;
    };

    const runWithNewHook = () => runInNewHookContext(context, runOrFailOriginal);

    const runWithNewTransaction = () => {
      const transactionCallback = async (entityManager: EntityManager) => {
        setEntityManagerByDataSourceName(context, connectionName, entityManager);

        try {
          const result = await runOriginal();

          return result;
        } finally {
          setEntityManagerByDataSourceName(context, connectionName, null);
        }
      };

      if (isolationLevel) {
        return runInNewHookContext(context, () => {
          return withTx(isolationLevel, transactionCallback);
        });
      } else {
        return runInNewHookContext(context, () => {
          return withTx(transactionCallback);
        });
      }
    };

    return context.run(async () => {
      const currentTransaction = getEntityManagerByDataSourceName(context, connectionName);
      switch (propagation) {
        case Propagation.MANDATORY:
          if (!currentTransaction) {
            throw new TransactionalError(
              "No existing transaction found for transaction marked with propagation 'MANDATORY'",
            );
          }
          return runOrFailOriginal();
        case Propagation.NESTED:
          return runWithNewTransaction();
        case Propagation.NEVER:
          if (currentTransaction) {
            throw new TransactionalError(
              "Found an existing transaction, transaction marked with propagation 'NEVER'",
            );
          }
          return runWithNewHook();
        case Propagation.NOT_SUPPORTED:
          if (currentTransaction) {
            setEntityManagerByDataSourceName(context, connectionName, null);
            const result = await runWithNewHook();
            setEntityManagerByDataSourceName(context, connectionName, currentTransaction);
            return result;
          }
          return runOrFailOriginal();
        case Propagation.REQUIRED:
          if (currentTransaction) {
            return runOrFailOriginal();
          }
          return runWithNewTransaction();
        case Propagation.REQUIRES_NEW:
          return runWithNewTransaction();
        case Propagation.SUPPORTS:
          return currentTransaction ? runOrFailOriginal() : runWithNewHook();
      }
    });
  }

  return wrapper as Fn;
};
