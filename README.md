[![CircleCI](https://circleci.com/gh/Epsor/consumer-wrapper.svg?style=svg)](https://circleci.com/gh/Epsor/consumer-wrapper) [![npm version](https://img.shields.io/npm/v/@epsor/consumer-wrapper.svg)](https://npmjs.org/package/@epsor/consumer-wrapper.svg "View this project on npm")

# `@epsor/consumer-wrapper`

It wrap the consumer connection to kafka, redis connexion, mongodb connexion to help you to develop new consumer faster.

## Requirements

`@epsor/consumer-wrapper` assumes that a few environment variables are set:

- `EVENT_TOPIC` - The event topic to consume
- `MONGODB_URL` - The mongoDB server url
- `REDIS_URL` - The redis server url
- `KAFKA_HOST` - The kafka server info IP:PORT
- `KAFKA_GROUP_ID` - The kafka group id

## AbstractHandler

This package comes with `AbstractHandler` which is supposed to be extanded by your consumers handler.

Here an example of a handler:

```js
import { MongoDuplicateEntryError } from '@epsor/mongodb-wrapper';

class UserCreateHandler extends AbstractHandler {
  /** @inheritdoc */
  static get handlerName() {
    return 'UserCreate';
  }

  /** @inheritdoc */
  static get allowedTypes() {
    return ['user.created'];
  }

  /** @inheritdoc */
  static async handle({ mongo }, userCreatedDto) {
    const users = await mongo.collection('users');
    try {
      await users.insertOne(userCreatedDto.fields);
    } catch (err) {
      if (err instanceof MongoDuplicateEntryError) {
        // An error occurred
      }
    }
  }
}
```

## Run a consumer

```js
import { Consumer } from '@epsor/consumer-wrapper';

/** @type {AbstractHandler[]} */
import handlers from './handlers';

(async () => {
  const consumer = new Consumer('b2c', handlers);
  await consumer.initDependencies();
  await consumer.createCollections('users');
  await consumer.run();
})();
```

## Health check

This package contains an express api endpoint to check pod's health.

##### How to

- `npm start` to start the server.
- go to `http://localhost:{HEALTHCHECK_PORT}/.well-known/express/server-health`. Default port is `8000`

please look at the README.md of **epsor-v2** to get the list of supported ports for every consumers.


