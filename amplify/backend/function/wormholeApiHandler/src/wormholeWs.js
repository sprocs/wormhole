const AWS = require('aws-sdk')
const aws4 = require('aws4')
const awscred = require('awscred')
const WebSocket = require('ws')
const queryString = require('query-string')
const assert = require('assert')
const { wormholeCache } = require('./wormholeCache')
const {
  INACTIVITY_TIMEOUT,
  MAX_SINGLE_FRAME_CONTENT_LENGTH,
} = require('./wormholeConstants')

const wsApiGatewayClient = new AWS.ApiGatewayManagementApi({
  endpoint: process.env.WORMHOLE_WS_ENDPOINT,
})

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
    if (_ws.OPEN && _ws.readyState === _ws.OPEN) {
      console.debug('websocket is already open')
      return callback(null, _ws)
    } else if (_ws.CONNECTING && _ws.readyState === _ws.CONNECTING) {
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
      try {
        const parsedPayload = JSON.parse(data.toString())
        const { action, sourceConnectionId } = parsedPayload
        if (action) {
          console.debug(
            'websocket onmessage action',
            action,
            sourceConnectionId,
          )
          switch (action) {
            case 'CLIENT_DISCONNECT':
              wormholeCache.keys().map((k) => {
                const cachedConnection = wormholeCache.get(k)
                if (cachedConnection?.connectionId === sourceConnectionId) {
                  console.debug('removing cache connectionId', k)
                  wormholeCache.del(k)
                }
              })
              break
            default:
              break
          }
        }
      } catch (e) {
        console.error(e)
      }
      resetWsTimeout()
    })

    _ws.on('close', () => {
      console.debug('websocket disconnected')
      _ws = null
    })
  })
}

const chunkBodyToWs = (ws, connectionId, reqId, endData = {}, body) => {
  let chunks = []
  let buf = Buffer.from(body)
  let isMultiFrame = false
  if (buf.length > MAX_SINGLE_FRAME_CONTENT_LENGTH) {
    isMultiFrame = true
    let o = 0,
      n = buf.length
    while (o < n) {
      const slicedBuf = buf.slice(o, (o += MAX_SINGLE_FRAME_CONTENT_LENGTH))
      console.debug(reqId, `sending chunk (${slicedBuf.length})`)
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
  } else {
    chunks.push(buf)
  }
  console.debug(reqId, `sending end chunk (total chunks: ${chunks.length})`)
  ws.send(
    JSON.stringify({
      action: 'sendmessage',
      connectionId,
      data: {
        reqId,
        endBodyChunk: true,
        totalChunks: chunks.length,
        ...(!isMultiFrame && {
          bodyChunkIndex: 0,
          bodyChunk: buf.toString('base64'),
        }),
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
