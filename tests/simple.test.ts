import { DataSource } from 'typeorm';
import {
  addTransactionalDataSource,
  initializeTransactionalContext,
  IsolationLevel,
  Propagation,
  runInTransaction,
  runOnTransactionCommit,
  runOnTransactionComplete,
  runOnTransactionRollback,
  StorageDriver,
  TransactionalError,
} from '../src';

import { User } from './entities/User.entity';
import { Counter } from './entities/Counter.entity';

import { UserRepository } from './repositories/user.repository';
import { extendUserRepository } from './repositories/extend-user-repository';

import { sleep, getCurrentTransactionId } from './utils';

const dataSource: DataSource = new DataSource({
  type: 'postgres',
  host: 'localhost',
  port: 5435,
  username: 'postgres',
  password: 'postgres',
  database: 'test',
  entities: [User, Counter],
  synchronize: true,
});

const storageDriver =
  process.env.TEST_STORAGE_DRIVER && process.env.TEST_STORAGE_DRIVER in StorageDriver
    ? StorageDriver[process.env.TEST_STORAGE_DRIVER as keyof typeof StorageDriver]
    : StorageDriver.CLS_HOOKED;

initializeTransactionalContext({ storageDriver });

addTransactionalDataSource(dataSource);

beforeAll(async () => {
  await dataSource.initialize();
});

afterAll(async () => {
  await dataSource.createEntityManager().clear(User);
  await dataSource.createEntityManager().clear(Counter);

  await dataSource.destroy();
});

describe('Transactional', () => {
  afterEach(async () => {
    await dataSource.createEntityManager().clear(User);
    await dataSource.createEntityManager().clear(Counter);
  });

  describe('General', () => {
    const sources = [
      {
        name: 'DataSource',
        source: dataSource,
      },
      {
        name: 'Repository',
        source: dataSource.getRepository(User),
      },
      {
        name: 'Entity Manager',
        source: dataSource.createEntityManager(),
      },
      {
        name: 'Custom Repository',
        source: new UserRepository(dataSource),
      },
      {
        name: 'Extend Repository',
        source: extendUserRepository(dataSource.getRepository(User)),
      },
      {
        name: 'Query Builder',
        source: () => dataSource.createQueryBuilder(),
      },
    ];

    describe.each(sources)('$name', ({ source }) => {
      it('supports basic transactions', async () => {
        let transactionIdBefore: number | null = null;

        await runInTransaction(async () => {
          transactionIdBefore = await getCurrentTransactionId(source);
          const transactionIdAfter = await getCurrentTransactionId(source);

          expect(transactionIdBefore).toBeTruthy();
          expect(transactionIdBefore).toBe(transactionIdAfter);
        });

        const transactionIdOutside = await getCurrentTransactionId(source);
        expect(transactionIdOutside).toBe(null);
        expect(transactionIdOutside).not.toBe(transactionIdBefore);
      });

      it('supports nested transactions', async () => {
        await runInTransaction(async () => {
          const transactionIdBefore = await getCurrentTransactionId(source);

          await runInTransaction(async () => {
            const transactionIdAfter = await getCurrentTransactionId(source);
            expect(transactionIdBefore).toBe(transactionIdAfter);
          });
        });

        expect.assertions(1);
      });

      it('supports several concurrent transactions', async () => {
        let transactionA: number | null = null;
        let transactionB: number | null = null;
        let transactionC: number | null = null;

        await Promise.all([
          runInTransaction(async () => {
            transactionA = await getCurrentTransactionId(source);
          }),
          runInTransaction(async () => {
            transactionB = await getCurrentTransactionId(source);
          }),
          runInTransaction(async () => {
            transactionC = await getCurrentTransactionId(source);
          }),
        ]);

        await Promise.all([transactionA, transactionB, transactionC]);

        expect(transactionA).toBeTruthy();
        expect(transactionB).toBeTruthy();
        expect(transactionC).toBeTruthy();

        expect(transactionA).not.toBe(transactionB);
        expect(transactionA).not.toBe(transactionC);
        expect(transactionB).not.toBe(transactionC);
      });
    });

    // We want to check that `save` doesn't create any intermediate transactions
    describe('Repository', () => {
      it('should not create any intermediate transactions', async () => {
        let transactionIdA: number | null = null;
        let transactionIdB: number | null = null;

        const userRepository = dataSource.getRepository(User);

        await runInTransaction(async () => {
          transactionIdA = await getCurrentTransactionId(dataSource);
          await userRepository.save(new User('John Doe', 100));
        });

        await runInTransaction(async () => {
          transactionIdB = await getCurrentTransactionId(dataSource);
        });

        let transactionDiff = transactionIdB! - transactionIdA!;
        expect(transactionDiff).toBe(1);
      });
    });

    describe('Extend Repository', () => {
      it('should not create any intermediate transactions', async () => {
        let transactionIdA: number | null = null;
        let transactionIdB: number | null = null;

        const customRepository = extendUserRepository(dataSource.getRepository(User));

        await runInTransaction(async () => {
          transactionIdA = await getCurrentTransactionId(dataSource);
          await customRepository.save(new User('John Doe', 100));
        });

        await runInTransaction(async () => {
          transactionIdB = await getCurrentTransactionId(dataSource);
        });

        let transactionDiff = transactionIdB! - transactionIdA!;
        expect(transactionDiff).toBe(1);
      });
    });

    // describe('Query Builder', () => {
    //   it('should not create any intermediate transactions', async () => {
    //     let transactionIdA: number | null = null;
    //     let transactionIdB: number | null = null;

    //     const qb = dataSource.createQueryBuilder();

    //     await runInTransaction(async () => {
    //       transactionIdA = await getCurrentTransactionId(dataSource);
    //       await qb.insert().into(User).values({ name: 'John Doe', money: 100 }).execute();
    //     });

    //     await runInTransaction(async () => {
    //       transactionIdB = await getCurrentTransactionId(dataSource);
    //     });

    //     let transactionDiff = transactionIdB! - transactionIdA!;
    //     expect(transactionDiff).toBe(1);
    //   });
    // });

    // describe('Entity Manager', () => {
    //   it('should not create any intermediate transactions', async () => {
    //     let transactionIdA: number | null = null;
    //     let transactionIdB: number | null = null;

    //     await runInTransaction(async () => {
    //       transactionIdA = await getCurrentTransactionId(dataSource);
    //       await dataSource.createEntityManager().save(new User('John Doe', 100));
    //     });

    //     await runInTransaction(async () => {
    //       transactionIdB = await getCurrentTransactionId(dataSource);
    //     });

    //     let transactionDiff = transactionIdB! - transactionIdA!;
    //     expect(transactionDiff).toBe(1);
    //   });
    // });
  });

  // Focus more on the repository, since it's the most common use case
  describe('Repository', () => {
    it('supports basic transactions', async () => {
      const userRepository = new UserRepository(dataSource);

      let transactionIdBefore: number | null = null;
      await runInTransaction(async () => {
        transactionIdBefore = await getCurrentTransactionId(userRepository);
        await userRepository.createUser('John Doe');
        const transactionIdAfter = await getCurrentTransactionId(userRepository);

        expect(transactionIdBefore).toBeTruthy();
        expect(transactionIdBefore).toBe(transactionIdAfter);
      });

      const transactionIdOutside = await getCurrentTransactionId(userRepository);
      expect(transactionIdOutside).toBe(null);
      expect(transactionIdOutside).not.toBe(transactionIdBefore);

      const user = await userRepository.findUserByName('John Doe');
      expect(user).toBeDefined();
    });

    it('should rollback the transaction if an error is thrown', async () => {
      const userRepository = new UserRepository(dataSource);

      try {
        await runInTransaction(async () => {
          await userRepository.createUser('John Doe');

          throw new Error('Rollback transaction');
        });
      } catch {}

      const user = await userRepository.findUserByName('John Doe');
      expect(user).toBe(null);
    });

    it('supports nested transactions', async () => {
      const userRepository = new UserRepository(dataSource);

      await runInTransaction(async () => {
        const transactionIdBefore = await getCurrentTransactionId(userRepository);
        await userRepository.createUser('John Doe');

        await runInTransaction(async () => {
          const transactionIdAfter = await getCurrentTransactionId(userRepository);
          expect(transactionIdBefore).toBe(transactionIdAfter);
        });
      });

      expect.assertions(1);
    });

    it('supports several concurrent transactions', async () => {
      const userRepository = new UserRepository(dataSource);

      let transactionA: number | null = null;
      let transactionB: number | null = null;
      let transactionC: number | null = null;

      await Promise.all([
        runInTransaction(async () => {
          userRepository.createUser('John Doe');

          transactionA = await getCurrentTransactionId(userRepository);
        }),
        runInTransaction(async () => {
          userRepository.createUser('Bob Smith');

          transactionB = await getCurrentTransactionId(userRepository);
        }),
        runInTransaction(async () => {
          userRepository.createUser('Alice Watson');

          transactionC = await getCurrentTransactionId(userRepository);
        }),
      ]);

      await Promise.all([transactionA, transactionB, transactionC]);

      expect(transactionA).toBeTruthy();
      expect(transactionB).toBeTruthy();
      expect(transactionC).toBeTruthy();

      expect(transactionA).not.toBe(transactionB);
      expect(transactionA).not.toBe(transactionC);
      expect(transactionB).not.toBe(transactionC);
    });

    it("doesn't leak variables to outer scope", async () => {
      let transactionSetup = false;
      let transactionEnded = false;

      const userRepository = new UserRepository(dataSource);

      let transactionIdOutside: number | null = null;

      const transaction = runInTransaction(async () => {
        transactionSetup = true;

        await sleep(500);

        const transactionIdInside = await getCurrentTransactionId(userRepository);

        expect(transactionIdInside).toBeTruthy();
        expect(transactionIdOutside).toBe(null);
        expect(transactionIdInside).not.toBe(transactionIdOutside);

        transactionEnded = true;
      });

      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (transactionSetup) {
            clearInterval(interval);

            resolve();
          }
        }, 200);
      });

      expect(transactionEnded).toBe(false);
      transactionIdOutside = await getCurrentTransactionId(userRepository);
      expect(transactionIdOutside).toBe(null);

      expect(transactionEnded).toBe(false);

      await transaction;
    });
  });

  describe('Extend Repository', () => {
    it('should rollback the transaction if an error is thrown', async () => {
      const repo = extendUserRepository(dataSource.getRepository(User));
      const name = 'John Doe';

      try {
        await runInTransaction(async () => {
          await repo.insertUser(name);

          await repo.insertUser(name);
        });
      } catch {}

      const user = await repo.findOneBy({ name });
      expect(user).toBeNull();
    });
  });

  describe('Propagation', () => {
    it('should support "REQUIRED" propagation', async () => {
      const userRepository = new UserRepository(dataSource);

      await runInTransaction(async () => {
        const transactionId = await getCurrentTransactionId(userRepository);
        await userRepository.createUser('John Doe');

        await runInTransaction(
          async () => {
            await userRepository.createUser('Bob Smith');
            const transactionIdNested = await getCurrentTransactionId(userRepository);

            // We expect the nested transaction to be under the same transaction
            expect(transactionId).toBe(transactionIdNested);
          },
          { propagation: Propagation.REQUIRED },
        );
      });
    });

    it('should support "SUPPORTS" propagation if active transaction exists', async () => {
      const userRepository = new UserRepository(dataSource);

      await runInTransaction(async () => {
        const transactionId = await getCurrentTransactionId(userRepository);
        await userRepository.createUser('John Doe');

        await runInTransaction(
          async () => {
            await userRepository.createUser('Bob Smith');
            const transactionIdNested = await getCurrentTransactionId(userRepository);

            // We expect the nested transaction to be under the same transaction
            expect(transactionId).toBe(transactionIdNested);
          },
          { propagation: Propagation.SUPPORTS },
        );
      });
    });

    it('should support "SUPPORTS" propagation if active transaction doesn\'t exist', async () => {
      const userRepository = new UserRepository(dataSource);

      await runInTransaction(
        async () => {
          const transactionId = await getCurrentTransactionId(userRepository);

          // We expect the code to be executed without a transaction
          expect(transactionId).toBe(null);
        },
        { propagation: Propagation.SUPPORTS },
      );
    });

    it('should support "MANDATORY" propagation if active transaction exists', async () => {
      const userRepository = new UserRepository(dataSource);

      await runInTransaction(async () => {
        const transactionId = await getCurrentTransactionId(userRepository);

        await runInTransaction(
          async () => {
            const transactionIdNested = await getCurrentTransactionId(userRepository);

            // We expect the nested transaction to be under the same transaction
            expect(transactionId).toBe(transactionIdNested);
          },
          { propagation: Propagation.MANDATORY },
        );
      });
    });

    it('should throw an error if "MANDATORY" propagation is used without an active transaction', async () => {
      const userRepository = new UserRepository(dataSource);

      await expect(
        runInTransaction(() => userRepository.find(), { propagation: Propagation.MANDATORY }),
      ).rejects.toThrowError(TransactionalError);
    });

    it('should support "REQUIRES_NEW" propagation', async () => {
      const userRepository = new UserRepository(dataSource);

      await runInTransaction(async () => {
        const transactionId = await getCurrentTransactionId(userRepository);

        await runInTransaction(
          async () => {
            const transactionIdNested = await getCurrentTransactionId(userRepository);

            // We expect the nested transaction to be under a different transaction
            expect(transactionId).not.toBe(transactionIdNested);
          },
          { propagation: Propagation.REQUIRES_NEW },
        );

        const transactionIdAfter = await getCurrentTransactionId(userRepository);
        // We expect then the transaction to be the same as before
        expect(transactionId).toBe(transactionIdAfter);
      });
    });

    it('should support "NOT_SUPPORTED" propagation', async () => {
      const userRepository = new UserRepository(dataSource);

      await runInTransaction(async () => {
        const transactionId = await getCurrentTransactionId(userRepository);

        await runInTransaction(
          async () => {
            const transactionIdNested = await getCurrentTransactionId(userRepository);

            // We expect the code to be executed without a transaction
            expect(transactionIdNested).toBe(null);
          },
          { propagation: Propagation.NOT_SUPPORTED },
        );

        const transactionIdAfter = await getCurrentTransactionId(userRepository);
        // We expect then the transaction to be the same as before
        expect(transactionId).toBe(transactionIdAfter);
      });
    });

    it('should support "NEVER" propagation if active transaction doesn\'t exist', async () => {
      const userRepository = new UserRepository(dataSource);

      await runInTransaction(
        async () => {
          const transactionId = await getCurrentTransactionId(userRepository);

          // We expect the code to be executed without a transaction
          expect(transactionId).toBe(null);
        },
        { propagation: Propagation.NEVER },
      );
    });

    it('should throw an error if "NEVER" propagation is used with an active transaction', async () => {
      const userRepository = new UserRepository(dataSource);

      await runInTransaction(async () => {
        expect(() =>
          runInTransaction(() => userRepository.find(), { propagation: Propagation.NEVER }),
        ).rejects.toThrowError(TransactionalError);
      });
    });
  });

  describe('Hooks', () => {
    it('should run "runOnTransactionCommit" hook', async () => {
      const userRepository = new UserRepository(dataSource);
      const commitSpy = jest.fn();
      const rollbackSpy = jest.fn();
      const completeSpy = jest.fn();

      await runInTransaction(async () => {
        await userRepository.createUser('John Doe');

        runOnTransactionCommit(commitSpy);
      });

      await sleep(1);

      expect(commitSpy).toHaveBeenCalledTimes(1);
      expect(rollbackSpy).not.toHaveBeenCalled();
      expect(completeSpy).not.toHaveBeenCalled();
    });

    it('should run "runOnTransactionRollback" hook', async () => {
      const userRepository = new UserRepository(dataSource);
      const commitSpy = jest.fn();
      const rollbackSpy = jest.fn();
      const completeSpy = jest.fn();

      try {
        await runInTransaction(async () => {
          runOnTransactionRollback(rollbackSpy);

          await userRepository.createUser('John Doe');

          throw new Error('Rollback transaction');
        });
      } catch {}

      await sleep(1);

      expect(rollbackSpy).toHaveBeenCalledTimes(1);
      expect(commitSpy).not.toHaveBeenCalled();
      expect(completeSpy).not.toHaveBeenCalled();
    });

    it('should run "runOnTransactionComplete" hook', async () => {
      const userRepository = new UserRepository(dataSource);
      const commitSpy = jest.fn();
      const rollbackSpy = jest.fn();
      const completeSpy = jest.fn();

      await runInTransaction(async () => {
        await userRepository.createUser('John Doe');

        runOnTransactionComplete(completeSpy);
      });

      await sleep(1);

      expect(commitSpy).not.toHaveBeenCalled();
      expect(rollbackSpy).not.toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Isolation', () => {
    it('should read the most recent committed rows when using READ COMMITTED isolation level', async () => {
      await runInTransaction(
        async () => {
          const userRepository = new UserRepository(dataSource);
          const totalUsers = await userRepository.count();
          expect(totalUsers).toBe(0);

          // Outside of the transaction
          await dataSource.transaction(async (manager) => {
            await manager.save(new User('John Doe', 100));
          });

          const totalUsers2 = await userRepository.count();
          expect(totalUsers2).toBe(1);
        },
        { isolationLevel: IsolationLevel.READ_COMMITTED },
      );
    });

    it("shouldn't see the most recent committed rows when using REPEATABLE READ isolation level", async () => {
      await runInTransaction(
        async () => {
          const userRepository = new UserRepository(dataSource);
          const totalUsers = await userRepository.count();
          expect(totalUsers).toBe(0);

          // Outside of the transaction
          await dataSource.transaction(async (manager) => {
            await manager.save(new User('John Doe', 100));
          });

          const totalUsers2 = await userRepository.count();
          expect(totalUsers2).toBe(0);
        },
        { isolationLevel: IsolationLevel.REPEATABLE_READ },
      );
    });
  });
});
