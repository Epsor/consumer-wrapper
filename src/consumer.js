import logger from '@epsor/logger';
import { encode, decode } from '@epsor/dto';
import Stream from '@epsor/kafka-streams';
import Producer from '@epsor/kafka-producer';
import forEach from 'aigle/forEach';
import redis from 'redis';

import mongo from './mongoDb';

/**
 * For optimization, it reduce AbstractHandler[] as Object<"dtoType",AbstractHandler[]>
 * [
 *    dtoType1: [ handler1, handler2 ],
 *    dtoType2: [ handler3, handler4 ],
 *    dtoType3: [ handler1, handler5 ],
 * ]
 */
const handlerReducer = (accu, handler) => {
  return handler.allowedTypes.reduce(
    (handlers, type) => ({
      ...handlers,
      [type]: [...(handlers[type] || []), handler],
    }),
    accu,
  );
};

/**
 * @property {Stream} kafkaStream - The kafka stream
 * @property {String} type - The consumer type
 * @property {Object<String,AbstractHandler[]>} handlers - Handlers
 * @property {Object<String,Object>} depencies - Consumer's dependencies
 */
class Consumer {
  /**
   * Contruct a consumer.
   *
   * @param {String} type - The consumer type, used for logger, stream groupId, redis PSUBSCRIBE and mongoDb database's name
   * @param {Array.<AbstractHandler>} handlers - The handlers
   * @param {Object<String,Object>} dependencies - The consumer dependencies
   * @param {Object} credentials - The credentials needed for Kafka
   * @param {String|undefined} credentials.kafkaHost - Kafka Host domain
   * @param {String|undefined} credentials.kafkaUsername - Kafka API key
   * @param {String|undefined} credentials.kafkaPassword - Kafka API secret
   * @param {Object} options - Options from library use to consume messages from Kafka
   */
  constructor(type, handlers, dependencies = {}, credentials = {}, options = {}) {
    this.type = type;
    this.handlers = handlers.reduce(handlerReducer, {});
    this.dependencies = dependencies;
    const { kafkaHost, kafkaUsername, kafkaPassword } = credentials;
    this.kafkaStream = new Stream({
      ...options,
      kafkaHost,
      apiKey: kafkaUsername,
      apiSecret: kafkaPassword,
      groupId: type,
    });
    this.kafkaProducer = new Producer({
      kafkaHost,
      apiKey: kafkaUsername,
      apiSecret: kafkaPassword,
    });
  }

  /**
   * Initialize the required dependencies
   *
   * @async
   * @param {Object.<String,Boolean>} options - The dependencies options
   * @param {Boolean>} options.mongo          - If true, add `mongo` in consumer dependencies
   * @param {Boolean>} options.redis          - If true, add `redis` in consumer dependencies
   *
   * @return {Promise.<Consumer>}             - Required dependencies
   */
  async initDependencies({ mongo: withMongo = true, redis: withRedis = true } = {}) {
    if (withMongo === true) {
      const mongoDbUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017';
      this.dependencies.mongo = await mongo.connect(mongoDbUrl, this.type);
    }

    if (withRedis === true) {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      this.dependencies.redis = await redis.createClient({ url: redisUrl });
    }
  }

  /**
   * Create mongoDb collections if they don't exist.
   *
   * @param {...String} requiredCollections  - The collections to create
   *
   * @returns {Promise}
   */
  async createCollections(...requiredCollections) {
    if (!this.dependencies.mongo) {
      throw new Error('dependencies.mongo is not set.');
    }

    const collections = await this.dependencies.mongo.collections();

    await forEach(requiredCollections, requiredCollection =>
      collections.includes(requiredCollection)
        ? undefined
        : this.dependencies.mongo.createCollection(requiredCollection),
    );
  }

  /**
   * Publish an error to a queue dedicated to.
   *
   * @async
   * @param {HandlerError|Error} error - The original error
   * @param {AbstractDto} encodedDto   - The message that caused the error
   *
   * @return {Promise}
   */
  publishError({ message, stack, handlerName }, encodedDto) {
    const kafkaMessage = encode('error', {
      consumer: this.type,
      message,
      handlerName,
      stack,
      encodedDto,
    });

    return this.kafkaProducer.produce(kafkaMessage, 'errors');
  }

  /**
   * Launch the message consumtion
   */
  run() {
    const stream = this.kafkaStream.getStream(process.env.EVENT_TOPIC, async originalMessage => {
      try {
        const dto = decode(JSON.parse(originalMessage));
        await this.handleMessage(dto, originalMessage);
      } catch (err) {
        await this.publishError(err, originalMessage);
        logger.error(err.message, {
          stack: err.stack,
          tags: [this.type, 'consumer'],
        });
      }
    });

    return this.handleError(stream);
  }

  /**
   * @private
   *
   * Init kafka stream for message consumption
   *
   * @async
   *
   * @returns {Promise}
   */
  async handleError(kafkaStream) {
    kafkaStream.on('error', err =>
      logger.error('Kafka stream error', { stack: err.stack, tags: [this.type, 'consumer'] }),
    );
    logger.info('Connected to kafka', { tags: [this.type, 'consumer'] });

    return this.kafkaStream;
  }

  /**
   * @private
   *
   * Resolver  DTO -> handler(s). It's called one time for each kafka message.
   *
   * @async
   * @param {Object} dependencies - The application dependencies
   * @param {AbstractDto} dto     - The Kafka message as an AbstractDto
   */
  async handleMessage(dto, originalMessage) {
    const dtoType = dto.constructor.type;
    const handlers = this.handlers[dtoType] || [];

    if (handlers.length === 0) {
      logger.info('No handler found.', { tags: [this.type, 'consumer', dtoType] });
      return;
    }

    await forEach(handlers, async handler => {
      try {
        await handler.handle(this.dependencies, dto);
        if (this.dependencies.redis) {
          await this.dependencies.redis.publish(`${this.type}:${dtoType}`, originalMessage);
        }
      } catch (err) {
        logger.error('Cannot handle DTO', {
          tags: [this.type, 'consumer', dto.type, handler.constructor.handlerName],
          stack: err.stack,
          type: dto.type,
        });
      }
    });
  }
}

export default Consumer;
