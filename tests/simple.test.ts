import { DataSource, QueryBuilder } from 'typeorm';
import { Post } from './entities/Post.entity';
import {
  addTransactionalDataSource,
  initializeTransactionalContext,
  runInTransaction,
  runOnTransactionCommit,
  Propagation,
  StorageDriver,
} from '../src';
import { PostReaderService } from './services/post-reader.service';
import { PostWriterService } from './services/post-writer.service';

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const message = 'a simple message';

interface IQueryable {
  query(query: string, parameters?: string[]): Promise<unknown>;
}

describe('Common tests', () => {
  let dataSource: DataSource;
  let nonPatchedDataSource: DataSource;

  async function isQueryTransactionActive(queryable: IQueryable) {
    await queryable.query('DELETE FROM "posts" WHERE 1 = 1');

    await queryable.query('INSERT INTO "posts" ("message") VALUES ($1)', [message]);

    const [result] = (await queryable.query(
      'SELECT txid_current_if_assigned() IS NOT NULL AS is_transaction',
    )) as [{ is_transaction: boolean }];

    await queryable.query('DELETE FROM "posts" WHERE 1 = 1');

    return result?.is_transaction || false;
  }

  async function isQueryBuilderWithoutEntityTransactionActive(queryBuilder: QueryBuilder<Post>) {
    await queryBuilder.delete().where('1 = 1').execute();

    await queryBuilder.insert().values({ message }).execute();

    const result = (await queryBuilder
      .select('txid_current_if_assigned() is not null', 'is_transaction')
      .getRawOne()) as { is_transaction: boolean };

    await queryBuilder.delete().where('1 = 1').execute();

    return result?.is_transaction || false;
  }

  async function isQueryBuilderWithEntityTransactionActive(queryBuilder: QueryBuilder<any>) {
    await queryBuilder.delete().from(Post).where('1 = 1').execute();

    await queryBuilder.insert().into(Post).values({ message }).execute();

    const result = (await queryBuilder
      .select('txid_current_if_assigned() is not null', 'is_transaction')
      .from(Post, 'p')
      .getRawOne()) as { is_transaction: boolean };

    await queryBuilder.delete().from(Post).execute();

    return result?.is_transaction || false;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: 'localhost',
      port: 5435,
      username: 'postgres',
      password: 'postgres',
      database: 'test',
      entities: [Post],
      synchronize: true,
    });

    nonPatchedDataSource = new DataSource({
      type: 'postgres',
      host: 'localhost',
      port: 5435,
      username: 'postgres',
      password: 'postgres',
      database: 'test',
      entities: [Post],
      synchronize: true,
    });

    const storageDriver = process.env.TEST_STORAGE_DRIVER && process.env.TEST_STORAGE_DRIVER in StorageDriver
      ? StorageDriver[process.env.TEST_STORAGE_DRIVER as keyof typeof StorageDriver]
      : StorageDriver.AUTO;

    initializeTransactionalContext({ storageDriver });

    addTransactionalDataSource(dataSource);
    addTransactionalDataSource({
      name: 'non-patched',
      dataSource: nonPatchedDataSource,
      patch: false,
    });

    await dataSource.initialize();
    await nonPatchedDataSource.initialize();

    await dataSource.createEntityManager().clear(Post);
    await nonPatchedDataSource.createEntityManager().clear(Post);
  });

  afterEach(async () => {
    await dataSource.createEntityManager().clear(Post);
    await nonPatchedDataSource.createEntityManager().clear(Post);
  });

  afterAll(async () => {
    await dataSource.destroy();
    await nonPatchedDataSource.destroy();
  });

  it("shouldn't get post using standard typeorm transaction", async () => {
    const [writtenPost, readPost] = await dataSource.transaction(async (manager) => {
      const writerService = new PostWriterService(manager.getRepository(Post));
      const readerService = new PostReaderService(dataSource.getRepository(Post));

      const writtenPost = await writerService.createPost(message);
      const readPost = await readerService.getPostByMessage(message);

      return [writtenPost, readPost];
    });

    expect(writtenPost.id).toBeGreaterThan(0);
    expect(readPost).toBeNull();
  });

  it('should get post using runInTransaction', async () => {
    const repository = dataSource.getRepository(Post);

    const writerService = new PostWriterService(repository);
    const readerService = new PostReaderService(repository);

    let commitHookCalled = false;

    const [writtenPost, readPost] = await runInTransaction(async () => {
      const writtenPost = await writerService.createPost(message);
      const readPost = await readerService.getPostByMessage(message);

      runOnTransactionCommit(() => (commitHookCalled = true));

      return [writtenPost, readPost];
    });

    await sleep(100);

    expect(writtenPost.id).toBeGreaterThan(0);
    expect(readPost.id).toBe(writtenPost.id);
    expect(commitHookCalled).toBeTruthy();
  });

  it('should get post using @Transactional decorator', async () => {
    const repository = dataSource.getRepository(Post);

    const writerService = new PostWriterService(repository);
    const readerService = new PostReaderService(repository);

    const writtenPost = await writerService.createPostWithDecorator(message);
    const readPost = await readerService.getPostByMessage(message);

    await sleep(100);

    expect(writtenPost.id).toBeGreaterThan(0);
    expect(readPost.id).toBe(writtenPost.id);
    expect(writerService.success).toBe(true);
  });

  it('should fail create post using runInTransaction', async () => {
    const repository = dataSource.getRepository(Post);

    const writerService = new PostWriterService(repository);
    const readerService = new PostReaderService(repository);

    const [readPost] = await runInTransaction(async () => {
      expect(writerService.createPost(message, true)).rejects.toThrowError();

      const readPost = await readerService.getPostByMessage(message);

      return [readPost];
    });

    expect(readPost).toBeNull();
  });

  it('should fail create post using Transactional', async () => {
    const repository = dataSource.getRepository(Post);

    const writerService = new PostWriterService(repository);
    const readerService = new PostReaderService(repository);

    expect(writerService.createPostWithDecorator(message, true)).rejects.toThrowError();

    const readPost = await readerService.getPostByMessage(message);

    await sleep(100);

    expect(readPost).toBeNull();
    expect(writerService.success).toBe(false);
  });

  it('should fail for "MANDATORY" propagation without existing transaction', async () => {
    const repository = dataSource.getRepository(Post);

    const writerService = new PostWriterService(repository);
    const readerService = new PostReaderService(repository);

    const fn = () =>
      runInTransaction(
        async () => {
          const writtenPost = await writerService.createPost(message);
          const readPost = await readerService.getPostByMessage(message);

          return [writtenPost, readPost];
        },
        {
          propagation: Propagation.MANDATORY,
        },
      );

    expect(fn).rejects.toThrowError();
  });

  it('should pass transaction for "MANDATORY" propagation', async () => {
    const repository = dataSource.getRepository(Post);

    const writerService = new PostWriterService(repository);
    const readerService = new PostReaderService(repository);

    const [writtenPost, readPost] = await runInTransaction(async () => {
      const writtenPost = await writerService.createPost(message);
      const readPost = await runInTransaction(async () => readerService.getPostByMessage(message), {
        propagation: Propagation.MANDATORY,
      });

      return [writtenPost, readPost];
    });

    expect(writtenPost.id).toBeGreaterThan(0);
    expect(readPost.id).toBe(writtenPost.id);
  });

  it('should fail for "NEVER" propagation if transaction exists', async () => {
    const repository = dataSource.getRepository(Post);

    const writerService = new PostWriterService(repository);
    const readerService = new PostReaderService(repository);

    const fn = () =>
      runInTransaction(async () => {
        const writtenPost = await writerService.createPost(message);
        const readPost = await runInTransaction(() => readerService.getPostByMessage(message), {
          propagation: Propagation.NEVER,
        });

        return [writtenPost, readPost];
      });

    expect(fn).rejects.toThrowError();
  });

  it('should ignore transactions for "NOT_SUPPORTED" propagation', async () => {
    const repository = dataSource.getRepository(Post);

    const writerService = new PostWriterService(repository);
    const readerService = new PostReaderService(repository);

    const [writtenPost, readPost] = await runInTransaction(async () => {
      const writtenPost = await writerService.createPost(message);
      const readPost = await runInTransaction(async () => readerService.getPostByMessage(message), {
        propagation: Propagation.NOT_SUPPORTED,
      });

      return [writtenPost, readPost];
    });

    expect(writtenPost.id).toBeGreaterThan(0);
    expect(readPost).toBeNull();
  });

  it('should suspend old transactions for "REQUIRES_NEW" propagation', async () => {
    const repository = dataSource.getRepository(Post);

    const writerService = new PostWriterService(repository);
    const readerService = new PostReaderService(repository);

    const [writtenPost, readPost] = await runInTransaction(async () => {
      const writtenPost = await writerService.createPost(message);
      const readPost = await runInTransaction(async () => readerService.getPostByMessage(message), {
        propagation: Propagation.REQUIRES_NEW,
      });

      return [writtenPost, readPost];
    });

    expect(writtenPost.id).toBeGreaterThan(0);
    expect(readPost).toBeNull();
  });

  it("shouldn't be transaction using standard typeorm transaction and DataSource", async () => {
    let isActive = false;

    await dataSource.transaction(async () => {
      await isQueryTransactionActive(dataSource);
    });

    expect(isActive).toBeFalsy();
  });

  it("shouldn't be transaction outside using runInTransaction and DataSource", async () => {
    let isActive: boolean = false;

    await runInTransaction(async () => {
      await isQueryTransactionActive(dataSource);
    });

    isActive = await isQueryTransactionActive(dataSource);

    expect(isActive).toBeFalsy();
  });

  it('should be transaction using runInTransaction and DataSource', async () => {
    let isActive: boolean = false;

    await runInTransaction(async () => {
      isActive = await isQueryTransactionActive(dataSource);
    });

    expect(isActive).toBeTruthy();
  });

  it('should be transaction using runInTransaction and DataSource.manager', async () => {
    let isActive: boolean = false;

    await runInTransaction(async () => {
      isActive = await isQueryTransactionActive(dataSource.manager);
    });

    expect(isActive).toBeTruthy();
  });

  it('should be transaction using runInTransaction and DataSource.getRepository', async () => {
    let isActive: boolean = false;

    await runInTransaction(async () => {
      isActive = await isQueryTransactionActive(dataSource.getRepository(Post));
    });

    expect(isActive).toBeTruthy();
  });

  it("shouldn't be transaction using standard typeorm transaction and DataSource.createQueryBuilder", async () => {
    let isActive = false;

    await dataSource.transaction(async () => {
      await isQueryBuilderWithoutEntityTransactionActive(dataSource.createQueryBuilder(Post, 'p'));
    });

    expect(isActive).toBeFalsy();
  });

  it('should be transaction using runInTransaction and DataSource.createQueryBuilder', async () => {
    let isActive: boolean = false;
    let isActiveWithEntity: boolean = false;

    await runInTransaction(async () => {
      isActive = await isQueryBuilderWithoutEntityTransactionActive(
        dataSource.createQueryBuilder(Post, 'p'),
      );
    });

    await runInTransaction(async () => {
      isActiveWithEntity = await isQueryBuilderWithEntityTransactionActive(
        dataSource.createQueryBuilder(),
      );
    });

    expect(isActive).toBeTruthy();
    expect(isActiveWithEntity).toBeTruthy();
  });

  it('should be transaction using runInTransaction and DataSource.manager.createQueryBuilder', async () => {
    let isActive: boolean = false;
    let isActiveWithEntity: boolean = false;

    await runInTransaction(async () => {
      isActive = await isQueryBuilderWithoutEntityTransactionActive(
        dataSource.manager.createQueryBuilder(Post, 'p'),
      );
    });

    await runInTransaction(async () => {
      isActiveWithEntity = await isQueryBuilderWithEntityTransactionActive(
        dataSource.createQueryBuilder(),
      );
    });

    expect(isActive).toBeTruthy();
    expect(isActiveWithEntity).toBeTruthy();
  });

  it("shouldn't be transaction using runInTransaction and non-patched DataSource", async () => {
    let isActive: boolean = false;

    await runInTransaction(
      async () => {
        isActive = await isQueryTransactionActive(nonPatchedDataSource);
      },
      { connectionName: 'non-patched' },
    );

    expect(isActive).toBeFalsy();
  });
});
