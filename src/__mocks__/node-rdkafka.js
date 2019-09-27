/* eslint-disable class-methods-use-this */
import EventEmitter from 'events';

class KafkaConsumer extends EventEmitter {
  connect() {
    this.emit('ready');
    return jest.fn()();
  }

  subscribe(topics) {
    return jest.fn()(topics);
  }

  consume(number, callback) {
    callback(null, [{ value: { message: 'test' } }]);
    return jest.fn()();
  }
}

module.exports = {
  KafkaConsumer,
};
