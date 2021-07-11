/*
Copyright 2017 - 2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance with the License. A copy of the License is located at
    http://aws.amazon.com/apache2.0/
or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and limitations under the License.
*/

const express = require('express')
const { getCurrentInvoke } = require('@vendia/serverless-express')
const morgan = require('morgan')
const { getClientConnectionForHost } = require('./wormholeData')
const { initWs, wsApiGatewayClient, chunkBodyToWs } = require('./wormholeWs')
const { wormholeCache } = require('./wormholeCache')
const AWS = require('aws-sdk')
const crypto = require('crypto')
const basicAuth = require('express-basic-auth')
const s3Client = new AWS.S3()

const WORMHOLE_CLIENT_RESPONSE_TIMEOUT = 25 * 1000 // 25s
const MAX_SINGLE_FRAME_CONTENT_LENGTH = 24 * 1024 // hard max 32kb

const app = express()

const wormholeAuthorizer = (username, password) => {
  const userMatches = basicAuth.safeCompare(
    username,
    process.env.BASIC_AUTH_USER,
  )
  const passwordMatches = basicAuth.safeCompare(
    password,
    process.env.BASIC_AUTH_PASSWORD,
  )
  return userMatches & passwordMatches
}

app.use(morgan('tiny'))
app.use(function (req, res, next) {
  if (process.env.BASIC_AUTH_PASSWORD) {
    req.usedBasicAuth = true
    basicAuth({
      authorizer: wormholeAuthorizer,
      challenge: true,
    })(req, res, next)
  } else {
    next()
  }
})

const wormholeProxy = express.Router()

wormholeProxy.get('/wormholeConfig', (req, res) => {
  res.json({
    wsEndpoint: process.env.WORMHOLE_WS_ENDPOINT,
    bucket: process.env.WORMHOLE_BUCKET_NAME,
    region: process.env.REGION,
  })
})

const verifyClientConnected = async (req, res, next) => {
  const clientHostCacheKey = `clientConnection__${req.headers.host}`
  let clientConnection = wormholeCache.get(clientHostCacheKey)
  if (!clientConnection) {
    console.debug('Looking for client connections for host', req.headers.host)
    clientConnection = await getClientConnectionForHost(req.headers.host)
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

const serveFromS3 = async (res, parsedMessage) => {
  const resS3Key = parsedMessage.data?.res?.s3Key
  if (resS3Key) {
    const { status, headers } = parsedMessage.data.res
    console.debug('serving response from', resS3Key)
    res.status(status)
    res.set(headers)
    res.set('transfer-encoding', '')
    var resStream = s3Client
      .getObject({
        Bucket: process.env.WORMHOLE_BUCKET_NAME,
        Key: resS3Key,
      })
      .createReadStream()
    resStream.pipe(res)
    // TODO delete s3 key
    return true
  }
  return false
}

wormholeProxy.all('/*', async (req, res) => {
  let responseTimeoutInteval
  const reqId = req.headers['x-amzn-trace-id']
  let resBodyChunks = []
  let resBodyEndRes = null
  let bodyChunkedBuf = null

  const onMessage = async (message) => {
    try {
      const parsedMessage = JSON.parse(message.data)
      if (
        parsedMessage.action === 'CLIENT_DISCONNECT' ||
        !parsedMessage.data?.reqId
      ) {
        return false
      }
      console.log('Received response message from websocket', parsedMessage)

      if (
        crypto.timingSafeEqual(
          Buffer.from(parsedMessage.data?.reqId),
          Buffer.from(reqId),
        )
      ) {
        console.log('Response message matched reqId', parsedMessage.data.reqId)

        const {
          bodyChunk,
          bodyChunkIndex,
          endBodyChunk,
          totalChunks,
        } = parsedMessage.data

        if (bodyChunk) {
          console.debug(`received bodyChunk[${bodyChunkIndex}]`, bodyChunk)
          resBodyChunks.push({
            bodyChunkIndex,
            chunk: Buffer.from(bodyChunk, 'base64'),
          })

          if (
            resBodyEndRes &&
            resBodyChunks.length === resBodyEndRes.totalChunks
          ) {
            console.debug(
              'received last bodyChunk having already received endBodyChunk',
            )
          } else {
            return false
          }
        }

        if (endBodyChunk) {
          resBodyEndRes = {
            res: parsedMessage.data.res,
            totalChunks,
          }

          if (resBodyChunks.length !== resBodyEndRes.totalChunks) {
            console.debug(
              'received endBodyChunk but waiting for chunks to complete...',
            )
            return false
          }
        }

        clearInterval(responseTimeoutInteval)
        req.ws.removeEventListener('message', onMessage)

        if (await serveFromS3(res, parsedMessage)) {
          console.log('served from s3')
        } else if (resBodyEndRes) {
          console.log('serving chunked response')

          let resBuf = []
          resBodyChunks
            .sort((a, b) => {
              return a.bodyChunkIndex - b.bodyChunkIndex
            })
            .map(({ chunk }) => {
              resBuf.push(chunk)
            })

          res.status(resBodyEndRes.res.status)
          res.set(resBodyEndRes.res.headers)
          res.set('transfer-encoding', '')
          res.send(Buffer.concat(resBuf) || '')
        } else {
          const { status, headers, body } = parsedMessage.data.res
          console.log('serve normal', status, headers)
          res.status(status)
          res.set(headers)
          res.set('transfer-encoding', '')
          // console.log(body)
          // console.log(Buffer.from(body, 'base64').toString('utf8'))
          // res.send((body && Buffer.from(body, 'base64').toString('ascii')) || '')
          res.send((body && Buffer.from(body, 'base64')) || '')
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  responseTimeoutInteval = setTimeout(() => {
    req.ws.removeEventListener('message', onMessage)
    console.log('timed out waiting')

    return res
      .status(408)
      .send('timed out waiting for wormhole client response')
  }, WORMHOLE_CLIENT_RESPONSE_TIMEOUT)

  req.ws.addEventListener('message', onMessage)

  // console.log('req.body', req.body, req.body.toString('base64'), req.body.length);
  // TODO chunk body
  // console.log('request payload size: %s', payloadSize)

  const reqData = {
    req: {
      sourceIp: req.ip,
      headers: req.headers,
      originalUrl: req.originalUrl,
      method: req.method,
    },
  }
  const clientConnectionId = req.clientConnection.connectionId
  if ((req.body?.length || 0) > MAX_SINGLE_FRAME_CONTENT_LENGTH) {
    console.log('Streaming body of ', req.body.length)
    await chunkBodyToWs(req.ws, clientConnectionId, reqId, reqData, req.body)
  } else {
    req.ws.send(
      JSON.stringify({
        action: 'sendmessage',
        connectionId: clientConnectionId,
        data: {
          reqId,
          req: {
            ...reqData.req,
            body: req.body?.toString('base64'),
          },
        },
      }),
    )
  }
})

wormholeProxy.use((err, req, res, next) => {
  console.error(err)
  next()
})

app.use('/', wormholeProxy)

module.exports = app
