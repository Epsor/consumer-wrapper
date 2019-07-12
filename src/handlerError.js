class HandlerError extends Error {
  /**
   * Set the handler error name
   *
   * @param {String} handlerName Handler name
   * @returns HandlerError
   */
  setHandlerName(handlerName) {
    this.handlerName = handlerName;
    return this;
  }
}

export default HandlerError;
