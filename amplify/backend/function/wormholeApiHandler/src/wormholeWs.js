const AWS = require('aws-sdk')
const aws4 = require('aws4')
const awscred = require('awscred')
const WebSocket = require('ws')
const queryString = require('query-string')
const assert = require('assert')
const { wormholeCache } = require('./wormholeCache')

const wsApiGatewayClient = new AWS.ApiGatewayManagementApi({
  endpoint: process.env.WORMHOLE_WS_ENDPOINT,
})

const INACTIVITY_TIMEOUT = 300000
const MAX_SINGLE_FRAME_CONTENT_LENGTH = 24 * 100 // hard max 32kb

let _ws
let _wsInactivityInterval

const resetWsTimeout = () => {
  clearInterval(_wsInactivityInterval)
  _wsInactivityInterval = setInterval(() => {
    if (_ws && _ws.readyState === _ws.OPEN) {
      console.debug('closing websocket connection for inactivity')
      _ws.close()
    }
  }, INACTIVITY_TIMEOUT)
}

const initWs = (callback) => {
  if (_ws) {
    if (_ws.readyState === _ws.OPEN) {
      console.debug('websocket is already open')
      return callback(null, _ws)
    } else if (_ws.readyState === _ws.CONNECTING) {
      console.debug('wait for websocket to connect')
      _ws.on('open', function open() {
        console.debug('websocket open')
        return callback(null, _ws)
      })
    }
  }

  awscred.load((err, data) => {
    if (err) throw err

    var queryStringStr = queryString.stringify({
      'X-Amz-Security-Token': data.credentials.sessionToken,
      clientType: 'SERVER',
    })

    const { pathname, host } = new URL(process.env.WORMHOLE_WS_ENDPOINT)
    const { path } = aws4.sign(
      {
        host,
        path: `${pathname}?` + queryStringStr,
        service: `execute-api`,
        region: process.env.REGION,
        signQuery: true,
      },
      data.credentials,
    )

    _ws = new WebSocket(`wss://${host}${path}`)

    _ws.on('open', () => {
      console.debug('websocket open')
      resetWsTimeout()
      return callback(null, _ws)
    })

    _ws.on('message', (data) => {
      console.debug('websocket onmessage', data)
      try {
        const parsedPayload = JSON.parse(data)
        const { action, sourceConnectionId } = parsedPayload
        switch (action) {
          case 'CLIENT_DISCONNECT':
            console.log('keys', wormholeCache.keys());
            wormholeCache.keys().map((k) => {
              console.log(k, wormholeCache.get(k), sourceConnectionId);
              const cachedConnection = wormholeCache.get(k)
              if (cachedConnection?.connectionId === sourceConnectionId) {
                console.debug('removing cache connectionId', k)
                wormholeCache.del(k)
              }
            })
            // wormholeCache.flushAll()
            // sourceConnectionId
            // console.log(
            //   `flushing cache for clientConnection__${parsedPayload.clientForHost}`,
            // )
            // wormholeCache.del(
            //   `clientConnection__${parsedPayload.clientForHost}`,
            // )
            break
          default:
            break
        }
      } catch (e) {
        console.error(e)
      }
      resetWsTimeout()
    })

    _ws.on('close', () => {
      console.debug('disconnected')
      _ws = null
      // return callback('websocket closed')
    })
  })
}

const chunkBodyToWs = (ws, connectionId, reqId, endData={}, body) => {
  let chunks = []
  let buf = Buffer.from(body)
  let o = 0, n = buf.length;
  while (o < n) {
    const slicedBuf = buf.slice(o, o += MAX_SINGLE_FRAME_CONTENT_LENGTH)
    console.debug(reqId, 'sending chunk (%s)', slicedBuf.length)
    ws.send(
      JSON.stringify({
        action: 'sendmessage',
        connectionId,
        data: {
          reqId,
          bodyChunkIndex: chunks.length,
          bodyChunk: slicedBuf.toString('base64'),
        },
      }),
    )
    chunks.push(slicedBuf)
  }
  console.debug(reqId, 'sending end chunk (total chunks: %s)', chunks.length)
  ws.send(
    JSON.stringify({
      action: 'sendmessage',
      connectionId,
      data: {
        reqId,
        endBodyChunk: true,
        totalChunks: chunks.length,
        ...endData,
      },
    }),
  )
}


module.exports = {
  initWs,
  resetWsTimeout,
  chunkBodyToWs,
  wsApiGatewayClient,
}
