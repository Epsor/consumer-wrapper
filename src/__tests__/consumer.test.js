import logger from '@epsor/logger';
import { encode, decode } from '@epsor/dto';
import redis from 'redis';
import Stream from '@epsor/kafka-streams';

import mongo from '../mongoDb';
import Consumer from '../consumer';

let beforeEnv;

describe('Consumer', () => {
  beforeAll(() => {
    beforeEnv = { ...process.env };
  });

  afterAll(() => {
    process.env = beforeEnv;
  });

  describe('Constructor', () => {
    it('should instance without errors', () => {
      expect(new Consumer('test', [])).toBeTruthy();
    });

    it('should initialize with a username', () => {
      process.env.KAFKA_USERNAME = 'username';
      expect(new Consumer('test', [])).toBeTruthy();
    });

    it('should initialize with a password', () => {
      process.env.KAFKA_PASSWORD = 'password';
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

    it('should create a new kafka-stream', () => {
      const StreamCtor = jest.fn(() => ({
        on: jest.fn(),
      }));
      Stream.mockImplementation(StreamCtor);

      expect(new Consumer('test', [])).toBeTruthy();
      expect(StreamCtor).toHaveBeenCalledTimes(1);
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

    it('should getStream', async () => {
      const getStream = jest.fn();

      process.env.EVENT_TOPIC = 'testing';
      const consumer = new Consumer('test', []);
      consumer.kafkaStream = { getStream };
      await consumer.run();

      expect(getStream).toHaveBeenCalledTimes(1);
      expect(getStream).toHaveBeenCalledWith('testing', expect.any(Function));
    });

    it('should decode a message', async () => {
      let messageCallback = null;
      const getStream = jest.fn((_, cb) => {
        messageCallback = cb;
      });

      const consumer = new Consumer('test', []);
      consumer.kafkaStream = { getStream };
      await consumer.run();

      expect(typeof messageCallback).toBe('function');

      messageCallback('{}');
      expect(decode).toHaveBeenCalledTimes(1);
      expect(decode).toHaveBeenCalledWith({});
    });
  });

  describe('initStream', () => {
    it('should listen "error"', async () => {
      const on = jest.fn();
      const StreamCtor = jest.fn(() => ({ on }));
      Stream.mockImplementation(StreamCtor);

      const consumer = new Consumer('test', []);
      await consumer.initStream();

      expect(StreamCtor).toHaveBeenCalledTimes(1);
      expect(on).toHaveBeenCalledTimes(1);
      expect(on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should log an error when "error" is triggered', async () => {
      let onErrorCallback = null;
      const on = jest.fn((_, cb) => {
        onErrorCallback = cb;
      });
      const StreamCtor = jest.fn(() => ({ on }));
      Stream.mockImplementation(StreamCtor);
      logger.error = jest.fn();

      const consumer = new Consumer('test', []);
      await consumer.initStream();

      expect(StreamCtor).toHaveBeenCalledTimes(1);
      expect(on).toHaveBeenCalledTimes(1);
      expect(on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(typeof onErrorCallback).toBe('function');
      expect(logger.error).toHaveBeenCalledTimes(0);
      onErrorCallback({ stack: '123' });
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          stack: '123',
          tags: ['test', 'consumer'],
        }),
      );
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
