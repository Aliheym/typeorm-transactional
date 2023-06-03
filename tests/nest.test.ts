import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  initializeTransactionalContext,
  addTransactionalDataSource,
  Propagation,
  runInTransaction,
  runOnTransactionCommit,
  runOnTransactionComplete,
  runOnTransactionRollback,
  StorageDriver,
} from '../src';
import { Post } from './entities/Post.entity';
import { NestPostReaderService } from './services/nest-post-reader.service';
import { NestPostWriterService } from './services/nest-post-writer.service';

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Integration with Nest.js', () => {
  let app: TestingModule;

  let readerService: NestPostReaderService;
  let writerService: NestPostWriterService;

  let dataSource: DataSource;

  beforeAll(async () => {
    const storageDriver = process.env.TEST_STORAGE_DRIVER && process.env.TEST_STORAGE_DRIVER in StorageDriver
      ? StorageDriver[process.env.TEST_STORAGE_DRIVER as keyof typeof StorageDriver]
      : StorageDriver.CLS_HOOKED;

    initializeTransactionalContext({ storageDriver });

    app = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRootAsync({
          useFactory() {
            return {
              type: 'postgres',
              host: 'localhost',
              port: 5435,
              username: 'postgres',
              password: 'postgres',
              entities: [Post],
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

        TypeOrmModule.forFeature([Post]),
      ],
      providers: [NestPostReaderService, NestPostWriterService],
      exports: [],
    }).compile();

    readerService = app.get<NestPostReaderService>(NestPostReaderService);
    writerService = app.get<NestPostWriterService>(NestPostWriterService);

    dataSource = app.get(DataSource);

    await dataSource.createEntityManager().clear(Post);
  });

  afterEach(async () => {
    await dataSource.createEntityManager().clear(Post);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create a post using service', async () => {
    const message = 'NestJS - A successful post';

    const [writtenPost, readPost] = await runInTransaction(async () => {
      const writtenPost = await writerService.createPost(message);
      const readPost = await readerService.getPostByMessage(message);

      return [writtenPost, readPost];
    });

    expect(writtenPost.id).toBeGreaterThan(0);
    expect(readPost.id).toBe(writtenPost.id);
  });

  it('should fail to create a post using service', async () => {
    const message = 'NestJS - A unsuccessful post';

    const promise = runInTransaction(async () => {
      const writtenPost = await writerService.createPost(message, true);
      const readPost = await readerService.getPostByMessage(message);

      return [writtenPost, readPost];
    });

    expect(promise).rejects.toThrowError();

    const readPost = await readerService.getPostByMessage(message);
    expect(readPost).toBeNull();
  });

  it('should create new transaction for "REQUIRES_NEW" propagation', async () => {
    const message = 'NestJS - A successful post';

    const [writtenPost, readPost, secondReadPost] = await runInTransaction(async () => {
      const writtenPost = await writerService.createPost(message);

      const readPost = await runInTransaction(
        () => {
          return readerService.getPostByMessage(message);
        },
        { propagation: Propagation.REQUIRES_NEW },
      );

      const secondReadPost = await readerService.getPostByMessage(message);

      return [writtenPost, readPost, secondReadPost];
    });

    expect(writtenPost.id).toBeGreaterThan(0);
    expect(secondReadPost.id).toBe(writtenPost.id);
    expect(readPost).toBeNull();
  });

  it('should call transaction hooks', async () => {
    const message = 'NestJS - A successful post';

    const onTransactionCommit = jest.fn();
    const onTransactionRollback = jest.fn();
    const onTransactionComplete = jest.fn();

    await runInTransaction(async () => {
      await writerService.createPost(message);

      runOnTransactionCommit(onTransactionCommit);
      runOnTransactionRollback(onTransactionRollback);
      runOnTransactionComplete(onTransactionComplete);
    });

    await sleep(100);

    expect(onTransactionCommit).toBeCalledTimes(1);
    expect(onTransactionRollback).toBeCalledTimes(0);
    expect(onTransactionComplete).toBeCalledTimes(1);
  });
});
