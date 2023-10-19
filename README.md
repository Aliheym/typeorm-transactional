
# Typeorm Transactional
[![npm version](http://img.shields.io/npm/v/typeorm-transactional.svg?style=flat)](https://npmjs.org/package/typeorm-transactional "View this project on npm")

## It's a fork of [typeorm-transactional-cls-hooked](https://github.com/odavid/typeorm-transactional-cls-hooked) for new versions of TypeORM.


A `Transactional` Method Decorator for [typeorm](http://typeorm.io/) that uses [ALS](https://nodejs.org/api/async_context.html#class-asynclocalstorage) or [cls-hooked](https://www.npmjs.com/package/cls-hooked) to handle and propagate transactions between different repositories and service methods.

See [Changelog](#CHANGELOG.md)

- [Typeorm Transactional](#typeorm-transactional)
  - [It's a fork of typeorm-transactional-cls-hooked for new versions of TypeORM.](#its-a-fork-of-typeorm-transactional-cls-hooked-for-new-versions-of-typeorm)
  - [Installation](#installation)
  - [Initialization](#initialization)
  - [Usage](#usage)
  - [Using Transactional Decorator](#using-transactional-decorator)
  - [Data Sources](#data-sources)
  - [Transaction Propagation](#transaction-propagation)
  - [Isolation Levels](#isolation-levels)
  - [Hooks](#hooks)
  - [Unit Test Mocking](#unit-test-mocking)
  - [API](#api)
    - [Library Options](#library-options)
    - [Transaction Options](#transaction-options)
    - [Storage Driver](#storage-driver)
    - [initializeTransactionalContext(options): void](#initializetransactionalcontextoptions-void)
    - [addTransactionalDataSource(input): DataSource](#addtransactionaldatasourceinput-datasource)
    - [runInTransaction(fn: Callback, options?: Options): Promise\<...\>](#runintransactionfn-callback-options-options-promise)
    - [wrapInTransaction(fn: Callback, options?: Options): WrappedFunction](#wrapintransactionfn-callback-options-options-wrappedfunction)
    - [runOnTransactionCommit(cb: Callback): void](#runontransactioncommitcb-callback-void)
    - [runOnTransactionRollback(cb: Callback): void](#runontransactionrollbackcb-callback-void)
    - [runOnTransactionComplete(cb: Callback): void](#runontransactioncompletecb-callback-void)
## Installation

```shell
## npm
npm install --save typeorm-transactional

## Needed dependencies
npm install --save typeorm reflect-metadata
```

Or

```shell
yarn add typeorm-transactional

## Needed dependencies
yarn add typeorm reflect-metadata
```

> **Note**: You will need to import `reflect-metadata` somewhere in the global place of your app - https://github.com/typeorm/typeorm#installation

## Initialization

In order to use it, you will first need to initialize the transactional context before your application is started

```typescript
import { initializeTransactionalContext } from 'typeorm-transactional';

initializeTransactionalContext()
...
app = express()
...
```
---
**IMPORTANT NOTE**

Calling [initializeTransactionalContext](#initialization) must happen BEFORE any application context is initialized!


## Usage

New versions of TypeORM use `DataSource` instead of `Connection`, so most of the API has been changed and the old API has become deprecated.

To be able to use TypeORM entities in transactions, you must first add a DataSource using the `addTransactionalDataSource` function:

```typescript
import { DataSource } from 'typeorm';
import { initializeTransactionalContext, addTransactionalDataSource, StorageDriver } from 'typeorm-transactional';
...
const dataSource = new DataSource({
	type: 'postgres',
    host: 'localhost',
    port: 5435,
    username: 'postgres',
    password: 'postgres'
});
...

initializeTransactionalContext({ storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE });
addTransactionalDataSource(dataSource);

...
```

Example for `Nest.js`:

```typescript
// main.ts

import { NestFactory } from '@nestjs/core';
import { initializeTransactionalContext } from 'typeorm-transactional';

import { AppModule } from './app';

const bootstrap = async () => {
  initializeTransactionalContext();

  const app = await NestFactory.create(AppModule, {
    abortOnError: true,
  });

  await app.listen(3000);
};

bootstrap();
```


```typescript
// app.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { addTransactionalDataSource } from 'typeorm-transactional';

@Module({
	imports: [
	   TypeOrmModule.forRootAsync({
	     useFactory() {
	       return {
	         type: 'postgres',
	         host: 'localhost',
	         port: 5435,
	         username: 'postgres',
	         password: 'postgres',
	         synchronize: true,
	         logging: false,
	       };
	     },
	     async dataSourceFactory(options) {
	       if (!options) {
	         throw new Error('Invalid options passed');
	       }

	       return addTransactionalDataSource(new DataSource(options));
	     },
	   }),

	   ...
	 ],
	 providers: [...],
	 exports: [...],
})
class AppModule {}
```

Unlike `typeorm-transactional-cls-hooked`, you do not need to use `BaseRepository`or otherwise define repositories.

You can also use this library with custom TypeORM repositories. You can read more about them [here](https://stackoverflow.com/a/72887316/19150323) and [here](https://orkhan.gitbook.io/typeorm/docs/custom-repository).

**NOTE**:  You can [add](#data-sources) multiple `DataSource` if you need it


## Using Transactional Decorator

- Every service method that needs to be transactional, need to use the `@Transactional()` decorator
- The decorator can take a `connectionName` as argument (by default it is `default`) to specify [the data source ](#data-sources) to be user
- The decorator can take an optional `propagation` as argument to define the [propagation behaviour](#transaction-propagation)
- The decorator can take an optional `isolationLevel` as argument to define the [isolation level](#isolation-levels) (by default it will use your database driver's default isolation level)

```typescript
export class PostService {
  constructor(readonly repository: PostRepository)

  @Transactional() // Will open a transaction if one doesn't already exist
  async createPost(id, message): Promise<Post> {
    const post = this.repository.create({ id, message })
    return this.repository.save(post)
  }
}
```

You can also use `DataSource`/`EntityManager` objects together with repositories in transactions:

```typescript
export class PostService {
  constructor(readonly repository: PostRepository, readonly dataSource: DataSource)

  @Transactional() // Will open a transaction if one doesn't already exist
  async createAndGetPost(id, message): Promise<Post> {
    const post = this.repository.create({ id, message })

    await this.repository.save(post)

    return dataSource.createQueryBuilder(Post, 'p').where('id = :id', id).getOne();
  }
}
```

## Data Sources

In new versions of `TypeORM` the `name` property in `Connection` / `DataSource` is deprecated, so to work conveniently with multiple `DataSource` the function  `addTransactionalDataSource` allows you to specify custom the name:

```typescript
addTransactionalDataSource({
	name: 'second-data-source',
	dataSource: new DataSource(...)
});
```

If you don't specify a name, it defaults to `default`.

Now, you can use this `name` in API by passing the `connectionName` property as options to explicitly define which `Data Source` you want to use:

```typescript
  @Transactional({ connectionName: 'second-data-source' })
  async fn() { ... }
```

OR


```typescript
runInTransaction(() => {
  // ...
}, { connectionName: 'second-data-source' })
```

## Transaction Propagation

The following propagation options can be specified:

- `MANDATORY` - Support a current transaction, throw an exception if none exists.
- `NESTED` - Execute within a nested transaction if a current transaction exists, behave like `REQUIRED` else.
- `NEVER` - Execute non-transactionally, throw an exception if a transaction exists.
- `NOT_SUPPORTED` - Execute non-transactionally, suspend the current transaction if one exists.
- `REQUIRED` (default behaviour) - Support a current transaction, create a new one if none exists.
- `REQUIRES_NEW` - Create a new transaction, and suspend the current transaction if one exists.
- `SUPPORTS` - Support a current transaction, execute non-transactionally if none exists.

## Isolation Levels

The following isolation level options can be specified:

- `READ_UNCOMMITTED` - A constant indicating that dirty reads, non-repeatable reads and phantom reads can occur.
- `READ_COMMITTED` - A constant indicating that dirty reads are prevented; non-repeatable reads and phantom reads can occur.
- `REPEATABLE_READ` - A constant indicating that dirty reads and non-repeatable reads are prevented; phantom reads can occur.
- `SERIALIZABLE` = A constant indicating that dirty reads, non-repeatable reads and phantom reads are prevented.

**NOTE**: If a transaction already exist and a method is decorated with `@Transactional` and `propagation` *does not equal* to `REQUIRES_NEW`, then the declared `isolationLevel` value will *not* be taken into account.

## Hooks

Because you hand over control of the transaction creation to this library, there is no way for you to know whether or not the current transaction was successfully persisted to the database.

To circumvent that, we expose three helper methods that allow you to hook into the transaction lifecycle and take appropriate action after a commit/rollback.

- `runOnTransactionCommit(cb)` takes a callback to be executed after the current transaction was successfully committed
- `runOnTransactionRollback(cb)` takes a callback to be executed after the current transaction rolls back. The callback gets the error that initiated the rollback as a parameter.
- `runOnTransactionComplete(cb)` takes a callback to be executed at the completion of the current transactional context. If there was an error, it gets passed as an argument.



```typescript
export class PostService {
    constructor(readonly repository: PostRepository, readonly events: EventService) {}

    @Transactional()
    async createPost(id, message): Promise<Post> {
        const post = this.repository.create({ id, message });
        const result = await this.repository.save(post);

        runOnTransactionCommit(() => this.events.emit('post created'));

        return result;
    }
}
```

## Unit Test Mocking
`@Transactional` can be mocked to prevent running any of the transactional code in unit tests.

This can be accomplished in Jest with:

```typescript
jest.mock('typeorm-transactional', () => ({
  Transactional: () => () => ({}),
}));
```
Repositories, services, etc. can be mocked as usual.

## API

### Library Options

```typescript
{
  storageDriver?: StorageDriver,
  maxHookHandlers?: number
}
```
- `storageDriver` - Determines which [underlying mechanism](#storage-driver) (like Async Local Storage or cls-hooked) the library should use for handling and propagating transactions. By default, it's `StorageDriver.CLS_HOOKED`.
- `maxHookHandlers` - Controls how many hooks (`commit`, `rollback`, `complete`) can be used simultaneously. If you exceed the number of hooks of same type, you get a warning. This is a useful to find possible memory leaks. You can set this options to `0` or `Infinity` to indicate an unlimited number of listeners. By default, it's `10`.

### Transaction Options

```typescript
{
  connectionName?: string;
  isolationLevel?: IsolationLevel;
  propagation?: Propagation;
}
```

- `connectionName`-  DataSource name to use for this transactional context  ([the data sources](#data-sources))
- `isolationLevel`- isolation level for transactional context ([isolation levels](#isolation-levels) )
- `propagation`-  propagation behaviors for nest transactional contexts ([propagation behaviors](#transaction-propagation))

### Storage Driver

Option that determines which underlying mechanism the library should use for handling and propagating transactions.

The possible variants:

- `AUTO` - Automatically selects the appropriate storage mechanism based on the Node.js version, using `AsyncLocalStorage` for Node.js versions 16 and above, and defaulting to `cls-hooked` for earlier versions.
- `CLS_HOOKED` - Utilizes the `cls-hooked` package to provide context storage, supporting both legacy Node.js versions with AsyncWrap for versions below 8.2.1, and using `async_hooks` for later versions.
- `ASYNC_LOCAL_STORAGE` - Uses the built-in `AsyncLocalStorage` feature, available from Node.js version 16 onwards,

> ⚠️ **WARNING:**  Currently, we use `CLS_HOOKED` by default for backward compatibility. However, in the next major release, this default will be switched to `AUTO`.

```typescript
import { StorageDriver } from 'typeorm-transactional'

initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });
```

### initializeTransactionalContext(options): void

Initialize transactional context.

```typescript
initializeTransactionalContext(options?: TypeormTransactionalOptions);
```

Optionally, you can set some [options](#library-options).

### addTransactionalDataSource(input): DataSource

Add TypeORM `DataSource` to transactional context.

```typescript
addTransactionalDataSource(new DataSource(...));

addTransactionalDataSource({ name: 'default', dataSource: new DataSource(...), patch: true });
```

### runInTransaction(fn: Callback, options?: Options): Promise<...>

Run code in transactional context.

```typescript
...

runInTransaction(() => {
	...

	const user = this.usersRepo.update({ id: 1000 }, { state: action });

	...
}, { propagation: Propagation.REQUIRES_NEW });

...
```

### wrapInTransaction(fn: Callback, options?: Options): WrappedFunction

Wrap function in transactional context

```typescript
...

const updateUser = wrapInTransaction(() => {
	...

	const user = this.usersRepo.update({ id: 1000 }, { state: action });

	...
}, { propagation: Propagation.NEVER });

...

await updateUser();

...
```

### runOnTransactionCommit(cb: Callback): void

Takes a callback to be executed after the current transaction was successfully committed

```typescript
  @Transactional()
  async createPost(id, message): Promise<Post> {
      const post = this.repository.create({ id, message });
      const result = await this.repository.save(post);

      runOnTransactionCommit(() => this.events.emit('post created'));

      return result;
  }
```

### runOnTransactionRollback(cb: Callback): void

Takes a callback to be executed after the current transaction rolls back. The callback gets the error that initiated the rollback as a parameter.

```typescript
  @Transactional()
  async createPost(id, message): Promise<Post> {
      const post = this.repository.create({ id, message });
      const result = await this.repository.save(post);

      runOnTransactionRollback((e) => this.events.emit(e));

      return result;
  }
```

### runOnTransactionComplete(cb: Callback): void

Takes a callback to be executed at the completion of the current transactional context. If there was an error, it gets passed as an argument.

```typescript
  @Transactional()
  async createPost(id, message): Promise<Post> {
      const post = this.repository.create({ id, message });
      const result = await this.repository.save(post);

      runOnTransactionComplete((e) => this.events.emit(e ? e : 'post created'));

      return result;
  }
```
