import { KafkaConsumer } from 'node-rdkafka';
import eachSeries from 'aigle/eachSeries';
import forEach from 'aigle/forEach';
import redis from 'redis';
import logger from '@epsor/logger';
import { encode, decode } from '@epsor/dto';
import Producer from '@epsor/kafka-producer';

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

  constructor(
    type,
    handlers,
    dependencies = {},
    {
      kafkaHost = process.env.KAFKA_HOST,
      kafkaUsername = process.env.KAFKA_USERNAME,
      kafkaPassword = process.env.KAFKA_PASSWORD,
    } = {},
  ) {
    this.type = type;
    this.handlers = handlers.reduce(handlerReducer, {});
    this.dependencies = dependencies;
    this.kafkaHost = kafkaHost;
    this.kafkaUsername = kafkaUsername;
    this.kafkaPassword = kafkaPassword;

    /* istanbul ignore next */
    const kafkaConfig =
      this.kafkaUsername && this.kafkaPassword
        ? {
            'security.protocol': 'SASL_SSL',
            'ssl.ca.location': '/etc/ssl/certs',
            'sasl.mechanisms': 'PLAIN',
            'log.connection.close': false,
            'sasl.username': this.kafkaUsername,
            'sasl.password': this.kafkaPassword,
          }
        : {};
    this.kafkaConsumer = new KafkaConsumer(
      {
        'group.id': this.type,
        'metadata.broker.list': this.kafkaHost,
        'enable.auto.commit': false,
        ...kafkaConfig,
      },
      {
        'auto.offset.reset': 'earliest',
      },
    );
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
   * Connect to Kafka and start consuming messages
   *
   * @param {Object} config                        - config to setup consumer
   * @param {Object} config.topics                 - topics to subscribe
   * @param {Object} config.messagesPerConsumption - Number of message to consume per cycle
   *
   * @return {Promise}
   */
  /* istanbul ignore next */
  async run({ topics = [process.env.EVENT_TOPIC], messagesPerConsumption = 1 } = {}) {
    await this.connect(topics);
    await this.consume(messagesPerConsumption);
  }

  /**
   * Connect to Kafka and subscribe to topics
   *
   * @param {Array<String>} topics - topics to subscribe
   *
   * @returns {Promise}
   */
  /* istanbul ignore next */
  connect(topics) {
    return new Promise((resolve, reject) => {
      this.kafkaConsumer
        .on('ready', () => {
          this.kafkaConsumer.subscribe(topics);
          logger.info('Connected and ready to consume', {
            tags: [this.type, 'consumer'],
            topics,
          });
          return resolve();
        })
        .on('error', err => {
          logger.error(err.message, {
            stack: err.stack,
            tags: [this.type, 'consumer'],
          });
          return reject();
        });
      // Connect to the broker manually
      logger.info('Connecting to kafka...', { tags: [this.type, 'consumer'] });
      this.kafkaConsumer.connect();
    });
  }

  /**
   * Consume messages from kafka and handle them
   * then it call itsefl again to keep consuming
   *
   * @param {Number} number - batch of message to consume
   *
   * @return {Promise}
   */
  /* istanbul ignore next */
  consume(number) {
    return new Promise((resolve, reject) => {
      this.kafkaConsumer.consume(number, async (error, messages) => {
        if (error) {
          return reject(error);
        }
        await eachSeries(messages, async message => {
          const data = message.value.toString();

          try {
            const dto = decode(JSON.parse(data));
            const dtoType = dto.constructor.type;

            logger.info(`Handling message with offset ${message.offset}...`, {
              tags: [this.type, 'consumer', 'handleMessage', dtoType, message.offset],
              data,
            });
            await this.handleMessage(dto, data);
            logger.info(`Message handled. Committing offset ${message.offset} to Kafka...`, {
              tags: [this.type, 'consumer', 'handleMessage', dtoType, message.offset],
              data,
            });
            this.kafkaConsumer.commitMessageSync(message);
            logger.info(`Offset ${message.offset} committed to Kafka...`, {
              tags: [this.type, 'consumer', 'handleMessage', dtoType, message.offset],
              data,
            });

            if (this.dependencies.redis) {
              await this.dependencies.redis.publish(`${this.type}:${dtoType}`, data);
            }
          } catch (err) {
            await this.publishError(err, message);
            logger.error(err.message, {
              stack: err.stack,
              tags: [this.type, 'consumer'],
              data,
            });
          }
        });

        return resolve(this.consume(number));
      });
    });
  }

  /**
   * @private
   *
   * Resolver  DTO -> handler(s). It's called one time for each kafka message.
   *
   * @async
   * @param {AbstractDto} dto - The Kafka message as an AbstractDto
   * @param {Object} message  - message from Kafka
   *
   * @return {Promise}
   */
  /* istanbul ignore next */
  async handleMessage(dto, message) {
    const dtoType = dto.constructor.type;
    const handlers = this.handlers[dtoType] || [];

    if (handlers.length === 0) {
      return;
    }

    await forEach(handlers, async handler => {
      try {
        await handler.handle(this.dependencies, dto);
      } catch (err) {
        logger.error('Cannot handle DTO', {
          tags: [this.type, 'consumer', dtoType, handler.constructor.handlerName],
          stack: err.stack,
          type: dtoType,
          data: message.value.toString(),
        });
      }
    });
  }
}

export default Consumer;
