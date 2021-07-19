const serverlessExpress = require('@vendia/serverless-express')
const app = require('./app')
const { loadSSMParameters } = require('@sprocs/lambda-env')

const expressServer = serverlessExpress({ app })

exports.handler = (event, context, callback) => {
  return loadSSMParameters().then(() => {
    return expressServer(event, context, callback)
  }).catch((e) => {
    console.error(e)
    callback("wormhole config error")
  })
}
