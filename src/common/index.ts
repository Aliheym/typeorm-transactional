import { DataSource, EntityManager, Repository } from 'typeorm';
import { EventEmitter } from 'events';

import {
  TYPEORM_DATA_SOURCE_NAME,
  TYPEORM_DATA_SOURCE_NAME_PREFIX,
  TYPEORM_ENTITY_MANAGER_NAME,
  TYPEORM_HOOK_NAME,
} from './constants';
import { StorageDriver as StorageDriverEnum } from '../enums/storage-driver';
import { TypeOrmUpdatedPatchError } from '../errors/typeorm-updated-patch';
import { StorageDriver } from '../storage/driver/interface';
import { isDataSource } from '../utils';
import { storage } from '../storage';

export type DataSourceName = string | 'default';

/**
 * Options to adjust and manage this library
 */
interface TypeormTransactionalOptions {
  /**
   * Controls how many hooks (`commit`, `rollback`, `complete`) can be used simultaneously.
   * If you exceed the number of hooks of same type, you get a warning. This is a useful to find possible memory leaks.
   * You can set this options to `0` or `Infinity` to indicate an unlimited number of listeners.
   */
  maxHookHandlers: number;

  /**
   * Controls storage driver used for providing persistency during the async request timespan.
   * You can force any of the available drivers with this option.
   * By default, the modern AsyncLocalStorage will be preferred, if it is supported by your runtime.
   */
  storageDriver: StorageDriverEnum;
}

/**
 * Global data and state
 */
interface TypeormTransactionalData {
  options: TypeormTransactionalOptions;
}

interface AddTransactionalDataSourceInput {
  /**
   * Custom name for data source
   */
  name?: DataSourceName;
  dataSource: DataSource;
  /**
   * Whether to "patch" some `DataSource` methods to support their usage in transactions (default `true`).
   *
   * If you don't need to use `DataSource` methods in transactions and you only work with `Repositories`,
   * you can set this flag to `false`.
   */
  patch?: boolean;
}

/**
 * Map of added data sources.
 *
 * The property "name" in the `DataSource` is deprecated, so we add own names to distinguish data sources.
 */
const dataSources = new Map<DataSourceName, DataSource>();

/**
 * Default library's state
 */
const data: TypeormTransactionalData = {
  options: {
    maxHookHandlers: 10,
    storageDriver: StorageDriverEnum.CLS_HOOKED,
  },
};

export const getTransactionalContext = () => storage.get();

export const getEntityManagerByDataSourceName = (context: StorageDriver, name: DataSourceName) => {
  if (!dataSources.has(name)) return null;

  return (context.get(TYPEORM_DATA_SOURCE_NAME_PREFIX + name) as EntityManager) || null;
};

export const setEntityManagerByDataSourceName = (
  context: StorageDriver,
  name: DataSourceName,
  entityManager: EntityManager | null,
) => {
  if (!dataSources.has(name)) return;

  context.set(TYPEORM_DATA_SOURCE_NAME_PREFIX + name, entityManager);
};

const getEntityManagerInContext = (dataSourceName: DataSourceName) => {
  const context = getTransactionalContext();
  if (!context || !context.active) return null;

  return getEntityManagerByDataSourceName(context, dataSourceName);
};

const patchDataSource = (dataSource: DataSource) => {
  let originalManager = dataSource.manager;

  Object.defineProperty(dataSource, 'manager', {
    configurable: true,
    get() {
      return (
        getEntityManagerInContext(this[TYPEORM_DATA_SOURCE_NAME] as DataSourceName) ||
        originalManager
      );
    },
    set(manager: EntityManager) {
      originalManager = manager;
    },
  });

  const originalQuery = DataSource.prototype.query;
  if (originalQuery.length !== 3) {
    throw new TypeOrmUpdatedPatchError();
  }

  dataSource.query = function (...args: unknown[]) {
    args[2] = args[2] || this.manager?.queryRunner;

    return originalQuery.apply(this, args);
  };

  const originalCreateQueryBuilder = DataSource.prototype.createQueryBuilder;
  if (originalCreateQueryBuilder.length !== 3) {
    throw new TypeOrmUpdatedPatchError();
  }

  dataSource.createQueryBuilder = function (...args: unknown[]) {
    if (args.length === 0) {
      return originalCreateQueryBuilder.apply(this, [this.manager?.queryRunner]);
    }

    args[2] = args[2] || this.manager?.queryRunner;

    return originalCreateQueryBuilder.apply(this, args);
  };

  dataSource.transaction = function (...args: unknown[]) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return originalManager.transaction(...args);
  };
};

const setTransactionalOptions = (options?: Partial<TypeormTransactionalOptions>) => {
  data.options = { ...data.options, ...(options || {}) };
};

export const getTransactionalOptions = () => data.options;

export const initializeTransactionalContext = (options?: Partial<TypeormTransactionalOptions>) => {
  setTransactionalOptions(options);

  const patchManager = (repositoryType: unknown) => {
    Object.defineProperty(repositoryType, 'manager', {
      configurable: true,
      get() {
        return (
          getEntityManagerInContext(
            this[TYPEORM_ENTITY_MANAGER_NAME].connection[
              TYPEORM_DATA_SOURCE_NAME
            ] as DataSourceName,
          ) || this[TYPEORM_ENTITY_MANAGER_NAME]
        );
      },
      set(manager: EntityManager | undefined) {
        this[TYPEORM_ENTITY_MANAGER_NAME] = manager;
      },
    });
  };

  const getRepository = (originalFn: (args: unknown) => unknown) => {
    return function patchRepository(...args: unknown[]) {
      const repository = originalFn.apply(this, args);

      if (!(TYPEORM_ENTITY_MANAGER_NAME in repository)) {
        /**
         * Store current manager
         */
        repository[TYPEORM_ENTITY_MANAGER_NAME] = repository.manager;

        /**
         * Patch repository object
         */
        patchManager(repository);
      }

      return repository;
    };
  };

  const originalGetRepository = EntityManager.prototype.getRepository;
  const originalExtend = Repository.prototype.extend;

  EntityManager.prototype.getRepository = getRepository(originalGetRepository);
  Repository.prototype.extend = getRepository(originalExtend);

  patchManager(Repository.prototype);

  const { storageDriver } = getTransactionalOptions();
  return storage.create(storageDriver);
};

export const addTransactionalDataSource = (input: DataSource | AddTransactionalDataSourceInput) => {
  if (isDataSource(input)) {
    input = { name: 'default', dataSource: input, patch: true };
  }

  const { name = 'default', dataSource, patch = true } = input;
  if (dataSources.has(name)) {
    throw new Error(`DataSource with name "${name}" has already added.`);
  }

  if (patch) {
    patchDataSource(dataSource);
  }

  dataSources.set(name, dataSource);
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  dataSource[TYPEORM_DATA_SOURCE_NAME] = name;

  return input.dataSource;
};

export const getDataSourceByName = (name: DataSourceName) => dataSources.get(name);

export const deleteDataSourceByName = (name: DataSourceName) => dataSources.delete(name);

export const getHookInContext = (context: StorageDriver | undefined) =>
  context?.get(TYPEORM_HOOK_NAME) as EventEmitter | null;

export const setHookInContext = (context: StorageDriver, emitter: EventEmitter | null) =>
  context.set(TYPEORM_HOOK_NAME, emitter);
