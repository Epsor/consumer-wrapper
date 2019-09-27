import logger from '@epsor/logger';
import { encode, decode } from '@epsor/dto';
import redis from 'redis';

import mongo from '../mongoDb';
import Consumer from '../consumer';

describe('Consumer', () => {
  describe('Constructor', () => {
    it('should instance without errors', () => {
      expect(new Consumer('test', [])).toBeTruthy();
    });

    it('should initialize Consumer.type', () => {
      const consumer = new Consumer('test', []);
      expect(consumer.type).toBe('test');
    });

    it('should initialize Consumer.dependencies to a default value', () => {
      const consumer = new Consumer('test', []);
      expect(consumer.dependencies).toEqual(expect.any(Object));
    });

    it('should initialize Consumer.dependencies if given', () => {
      const consumer = new Consumer('test', [], { a: 123 });
      expect(consumer.dependencies).toEqual({ a: 123 });
    });

    it('shoud call use the handlerRecuder', () => {
      const A = { type: 'A', allowedTypes: ['1', '2', '3'] };
      const B = { type: 'B', allowedTypes: ['2', '3'] };
      const C = { type: 'C', allowedTypes: ['3'] };
      const D = { type: 'D', allowedTypes: ['4'] };

      const consumer = new Consumer('test', [A, B, C, D]);
      expect(consumer.handlers).toEqual({
        '1': [A],
        '2': [A, B],
        '3': [A, B, C],
        '4': [D],
      });
    });
  });

  describe('initDependencies', () => {
    it('should connect to mongoDb by default', async () => {
      const consumer = new Consumer('test', []);
      mongo.connect = jest.fn();
      await consumer.initDependencies();
      expect(mongo.connect).toHaveBeenCalledTimes(1);
    });

    it('should not connect to mongoDb if mongo = false', async () => {
      const consumer = new Consumer('test', []);
      await consumer.initDependencies({ mongo: false });

      expect(mongo.connected).toBe(false);
    });

    it('should connect to redis by default', async () => {
      const pub = jest.fn();
      redis.createClient = jest.fn(() => ({ pub }));

      const consumer = new Consumer('test', []);
      await consumer.initDependencies({ mongo: false });

      expect(redis.createClient).toHaveBeenCalledTimes(1);
    });

    it('should not connect to redis if redis = false', async () => {
      const pub = jest.fn();
      redis.createClient = jest.fn(() => ({ pub }));

      const consumer = new Consumer('test', []);
      await consumer.initDependencies({ mongo: false, redis: false });

      expect(redis.createClient).toHaveBeenCalledTimes(0);
    });
  });

  describe('createCollections', () => {
    it('should throw if mongo dependencie is not set', async () => {
      const consumer = new Consumer('test', []);
      await expect(consumer.createCollections()).rejects.toThrow();
    });

    it('should not create exising collections', async () => {
      const mongoMock = {
        collections: jest.fn(() => ['a', 'b', 'c']),
        createCollection: jest.fn(() => Promise.resolve()),
      };

      const consumer = new Consumer('test', [], { mongo: mongoMock });
      await consumer.createCollections('a', 'b', 'c');

      expect(mongoMock.collections).toHaveBeenCalledTimes(1);
      expect(mongoMock.createCollection).toHaveBeenCalledTimes(0);
    });

    it('should  create non exising collections', async () => {
      const dbMock = {
        collections: jest.fn(() => ['a']),
        createCollection: jest.fn(() => Promise.resolve()),
      };

      expect(dbMock.collections).toHaveBeenCalledTimes(0);
      expect(dbMock.createCollection).toHaveBeenCalledTimes(0);

      const consumer = new Consumer('test', [], { mongo: dbMock });
      await consumer.createCollections('a', 'b', 'c');

      expect(dbMock.collections).toHaveBeenCalledTimes(1);
      expect(dbMock.createCollection).toHaveBeenCalledTimes(2);
      expect(dbMock.createCollection).toHaveBeenCalledWith('b');
      expect(dbMock.createCollection).toHaveBeenCalledWith('c');
    });
  });

  describe('publishError', () => {
    afterEach(() => {
      encode.mockReset();
    });

    it('should encode an error', async () => {
      const error = new Error('My message.');

      const consumer = new Consumer('test', []);
      await consumer.publishError(error, 'DtoString');

      expect(encode).toHaveBeenCalledTimes(1);
      expect(encode).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({
          consumer: 'test',
          message: 'My message.',
          encodedDto: 'DtoString',
        }),
      );
    });
  });

  describe('run', () => {
    afterEach(() => {
      decode.mockReset();
    });

    it('should decode a message', async () => {
      const consumer = new Consumer('test', []);
      await consumer.run();

      expect(decode).toHaveBeenCalledTimes(1);
      expect(decode).toHaveBeenCalledWith({});
    });

    it('should handle errors ang log it', async () => {
      let messageCallback = null;
      const onMock = jest.fn((type, cb) => {
        if (type === 'error') cb(new Error());
      });
      const getStream = jest.fn((_, cb) => {
        messageCallback = cb;
        return {
          on: onMock,
        };
      });

      const consumer = new Consumer('test', []);
      consumer.kafkaConsumer = { getStream };
      await consumer.run();

      expect(onMock).toHaveBeenCalledTimes(1);
      expect(onMock).toHaveBeenCalledWith('error', expect.any(Function));

      expect(typeof messageCallback).toBe('function');

      messageCallback('{}');
      expect(decode).toHaveBeenCalledTimes(1);
      expect(decode).toHaveBeenCalledWith({});
    });
  });

  describe('handleMessage', () => {
    beforeEach(() => {
      logger.info.mockReset();
      logger.error.mockReset();
    });

    it('should log if no handler available', async () => {
      const dto = new (class {
        static get type() {
          return 'test';
        }
      })();

      const consumer = new Consumer('test', []);
      await consumer.handleMessage(dto, 'coucou');
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('No handler found.', {
        tags: ['test', 'consumer', 'test'],
      });
    });

    it('should handle & publish on a validDto', async () => {
      const handler = { type: 'A', allowedTypes: ['test'], handle: jest.fn() };
      const publish = jest.fn();
      const dependencies = {
        mongo,
        redis: { publish },
      };
      const dto = new (class {
        static get type() {
          return 'test';
        }
      })();

      const consumer = new Consumer('test', [handler], dependencies);

      await consumer.handleMessage(dto, 'coucou');
      expect(handler.handle).toHaveBeenCalledTimes(1);
      expect(handler.handle).toHaveBeenCalledWith(dependencies, dto);
      expect(publish).toHaveBeenCalledWith('test:test', 'coucou');
    });

    it('should not log error witout redis', async () => {
      const handler = { type: 'A', allowedTypes: ['test'], handle: jest.fn() };
      const dependencies = {
        mongo,
      };
      const dto = new (class {
        static get type() {
          return 'test';
        }
      })();

      const consumer = new Consumer('test', [handler], dependencies);
      consumer.initDependencies({ redis: false, mongo: false });

      await consumer.handleMessage(dto, 'coucou');
      expect(logger.error).toHaveBeenCalledTimes(0);
    });

    it('should not throw an error if the handler throws an error', async () => {
      const handler = {
        type: 'A',
        allowedTypes: ['test'],
        handle: () => {
          throw new Error('error');
        },
      };

      const dto = new (class {
        static get type() {
          return 'test';
        }
      })();

      expect(logger.error).toHaveBeenCalledTimes(0);

      const consumer = new Consumer('test', [handler]);
      await consumer.handleMessage(dto, 'coucou');

      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });
});
