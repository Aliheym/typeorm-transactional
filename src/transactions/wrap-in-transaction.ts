import { EntityManager } from 'typeorm';
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

    const propagation = options?.propagation ?? Propagation.REQUIRED;
    const isolationLevel = options?.isolationLevel;

    const runOriginal = () => fn.apply(this, args);
    const runWithNewHook = () => runInNewHookContext(context, runOriginal);

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
          return dataSource.transaction(isolationLevel, transactionCallback);
        });
      } else {
        return runInNewHookContext(context, () => {
          return dataSource.transaction(transactionCallback);
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

          return runOriginal();

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

          return runOriginal();

        case Propagation.REQUIRED:
          if (currentTransaction) {
            return runOriginal();
          }

          return runWithNewTransaction();

        case Propagation.REQUIRES_NEW:
          return runWithNewTransaction();

        case Propagation.SUPPORTS:
          return currentTransaction ? runOriginal() : runWithNewHook();
      }
    });
  }

  return wrapper as Fn;
};
