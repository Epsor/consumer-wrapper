import EventEmitter from 'events';

class KafkaConsumer extends EventEmitter {
  connect(event) {
    this.emit(event);
    return jest.fn()();
  }
}

export default {
  KafkaConsumer,
};
