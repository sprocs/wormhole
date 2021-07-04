/*
Copyright 2017 - 2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance with the License. A copy of the License is located at
    http://aws.amazon.com/apache2.0/
or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and limitations under the License.
*/

const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const compression = require('compression')
const { getCurrentInvoke } = require('@vendia/serverless-express')
const morgan = require('morgan')
const { getClientConnectionForHost } = require('./wormholeData')
const { initWs, wsApiGatewayClient } = require('./wormholeWs')
const NodeCache = require('node-cache')

const wormholeCache = new NodeCache({ stdTTL: 100 })

const app = express()

app.use(compression())
app.use(cors())
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(morgan('tiny'))

const wormholeProxy = express.Router()

wormholeProxy.get('/wormholeConfig', (req, res) => {
  res.json({
    wsEndpoint: process.env.WORMHOLE_WS_ENDPOINT,
    wsBucket: process.env.WORMHOLE_BUCKET_NAME,
  })
})

const verifyClientConnected = async (req, res, next) => {
  const clientHostCacheKey = `clientConnection__${req.headers.host}`
  let clientConnection = wormholeCache.get(clientHostCacheKey)
  if (!clientConnection) {
    console.debug('Looking for client connections for host', req.headers.host)
    const clientConnection = await getClientConnectionForHost(req.headers.host)
    if (clientConnection) {
      // TODO clear on disconnect, get message
      wormholeCache.set(clientHostCacheKey, clientConnection, 120) // cache for 2 minutes
    }
  }
  if (clientConnection) {
    req.clientConnection = clientConnection
    return next()
  } else {
    res.status(412).send(`no wormhole client listening for ${req.headers.host}`)
  }
}

const verifyWs = async (req, res, next) => {
  initWs((err, ws) => {
    if (err) {
      console.error(err)
      res.status(503).send('websocket connection unavailable')
      throw err
    } else {
      req.ws = ws
      // ws.on('message', (message) => {
      //   console.debug('websocket message received', message)
      //   resetWsTimeout()
      // })
      return next()
    }
  })
}

wormholeProxy.use(verifyClientConnected)
wormholeProxy.use(verifyWs)

wormholeProxy.all('/*', (req, res) => {
  const onMessage = (message) => {
    console.log('onMessage', message)
    req.ws.removeEventListener('message', onMessage)
    res.format({
      'text/plain': function () {
        res.send('ok')
      },

      'text/html': function () {
        res.send(
          '<html><head><title>wormhole</title></head><body><h1>Wormhole</h1></body></html>',
        )
      },

      'application/json': function () {
        res.send({ status: 'ok' })
      },

      default: function () {
        res.status(406).send('Not Acceptable')
      },
    })
  }
  req.ws.addEventListener('message', onMessage)
  const reqId = req.headers['x-amzn-trace-id']
  const requestPayload = JSON.stringify({
    action: 'sendmessage',
    connectionId: req.clientConnection.connectionId,
    data: {
      reqId,
      req: {
        sourceIp: req.ip,
        headers: req.headers,
        originalUrl: req.originalUrl,
        method: req.method,
        body: req.body,
        // params: req.params,
      },
    },
  })
  const payloadSize = new TextEncoder().encode(requestPayload).length
  console.log('request payload size: %s', payloadSize)
  req.ws.send(
    JSON.stringify({
      action: 'sendmessage',
      connectionId: req.clientConnection.connectionId,
      data: {
        reqId,
        req: {
          sourceIp: req.ip,
          headers: req.headers,
          originalUrl: req.originalUrl,
          method: req.method,
          body: req.body,
          // params: req.params,
        },
      },
    }),
  )
})

wormholeProxy.use((err, req, res, next) => {
  console.error(err)
  next()
})

app.use('/', wormholeProxy)

module.exports = app
