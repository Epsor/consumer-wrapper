class AbstractHandler {
  /**
   * Returns the handler's name (usefull for debugging)
   *
   * @abstract
   * @returns {String} - The Handler name
   */
  static get handlerName() {
    throw new Error('AbstractHandler.handlerName is not set.');
  }

  /**
   * Returns allowed dto types
   *
   * @returns {string[]} - The dto that's can be handled
   */
  static get allowedTypes() {
    throw new Error('AbstractHandler.allowedTypes is not implemented.');
  }

  /**
   * Handle the kafka message
   *
   * @async
   * @param {Object} dependencies - The Dependencies
   * @param {Db} dependencies.mongo - The Dependencies
   * @param {AbstractDto} dto - Abstract DTO reprensentif the incomming message
   */
  static handle() {
    throw new Error('AbstractHandler.handle is not implemented.');
  }
}

export default AbstractHandler;
