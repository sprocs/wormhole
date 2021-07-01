const serverlessExpress = require('@vendia/serverless-express')
const app = require('./app')

const expressServer = serverlessExpress({ app })

exports.handler = (event, context, callback) => {
  if (event.requestContext?.connectionId) {
    // handleWs(event, context, callback)
    console.log('handleWs', event);
    callback("error")
  } else {
    expressServer(event, context, callback)
  }
}
