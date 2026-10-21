/** 用户可读的业务错误；CLI 只打印 message，不打印栈。 */
export class ScreenwriterError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ScreenwriterError'
  }
}
