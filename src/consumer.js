import { KafkaConsumer } from 'node-rdkafka';
import eachSeries from 'aigle/eachSeries';
import each from 'aigle/each';
import forEach from 'aigle/forEach';
import redis from 'redis';
import logger from '@epsor/logger';
import { decode } from '@epsor/dto';

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
   * @param {String} dbName - mongoDb database name
   * @param {Array.<AbstractHandler>} handlers - The handlers
   * @param {Object<String,Object>} dependencies - The consumer dependencies
   * @param {Object} credentials - The credentials needed for Kafka
   * @param {String|undefined} credentials.kafkaHost - Kafka Host domain
   * @param {String|undefined} credentials.kafkaUsername - Kafka API key
   * @param {String|undefined} credentials.kafkaPassword - Kafka API secret
   * @param {string|null} groupId - explicit consumer group ID for Confluent, used for logger & redis PSUBSCRIBE. Will be narrowed to the database name if null
   */

  constructor(
    dbName,
    handlers,
    dependencies = {},
    {
      kafkaHost = process.env.KAFKA_HOST,
      kafkaUsername = process.env.KAFKA_USERNAME,
      kafkaPassword = process.env.KAFKA_PASSWORD,
      autoCommit = false,
      parallelConsumption = false,
    } = {},
    groupId = null,
  ) {
    this.dbName = dbName;
    this.groupId = groupId || dbName;
    this.handlers = handlers.reduce(handlerReducer, {});
    this.dependencies = dependencies;
    this.kafkaHost = kafkaHost;
    this.kafkaUsername = kafkaUsername;
    this.kafkaPassword = kafkaPassword;
    this.autoCommit = autoCommit;
    this.parallelConsumption = parallelConsumption;
    this.eachFunction = parallelConsumption ? each : eachSeries;

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
        'group.id': this.groupId,
        'metadata.broker.list': this.kafkaHost,
        'enable.auto.commit': this.autoCommit,
        ...kafkaConfig,
      },
      {
        'auto.offset.reset': 'earliest',
      },
    );
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

      this.dependencies.mongo = await mongo.connect(mongoDbUrl, this.dbName);
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
            tags: [this.groupId, 'consumer'],
            topics,
          });
          return resolve();
        })
        .on('error', err => {
          logger.error('Kafka connection error', {
            stack: err.stack,
            tags: [this.groupId, 'consumer'],
            message: err.message,
          });
          return reject(err);
        });
      // Connect to the broker manually
      logger.info('Connecting to kafka...', { tags: [this.groupId, 'consumer'] });
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

        const promise = this.eachFunction(messages, async message => {
          try {
            const data = message.value.toString();
            const dto = decode(JSON.parse(data));
            const dtoType = dto.constructor.type;

            logger.info(`Handling message...`, {
              tags: [this.groupId, 'consumer', 'handleMessage', dtoType, message.offset],
              data,
            });

            const handlerCount = await this.handleMessage(dto, message);

            if (handlerCount && !this.autoCommit) {
              logger.info(`Message handled. Committing to Kafka...`, {
                tags: [this.groupId, 'consumer', 'handleMessage', dtoType, message.offset],
                data,
              });

              this.kafkaConsumer.commitMessageSync(message);
              logger.info(`Offset committed to Kafka...`, {
                tags: [this.groupId, 'consumer', 'handleMessage', dtoType, message.offset],
                data,
              });
            }

            if (this.dependencies.redis) {
              await this.dependencies.redis.publish(`${this.groupId}:${dtoType}`, data);
            }
          } catch (err) {
            reject(err);
          }
        });

        if (!this.parallelConsumption) await promise;

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
   * @param {Object} message  - message from from Kafka
   *
   *
   * @return {Promise<number>}
   */
  /* istanbul ignore next */
  async handleMessage(dto, message) {
    const dtoType = dto.constructor.type;
    const handlers = this.handlers[dtoType] || [];

    await forEach(handlers, async handler => {
      try {
        await handler.handle(this.dependencies, dto, message);
      } catch (err) {
        logger.error('Cannot handle DTO', {
          tags: [this.groupId, 'consumer', dtoType, handler.constructor.handlerName],
          stack: err.stack,
          type: dtoType,
          data: message.value.toString(),
        });
        throw err;
      }
    });
    return handlers.length;
  }
}

export default Consumer;
