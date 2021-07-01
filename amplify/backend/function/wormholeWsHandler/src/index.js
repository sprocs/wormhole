const { handleWs } = require('./wormholeWs')

exports.handler = (event, context, callback) => {
  return handleWs(event, context, callback)
}
