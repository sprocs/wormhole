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

module.exports = {
  initWs,
  resetWsTimeout,
  wsApiGatewayClient,
}

//
// const duplex = WebSocket.createWebSocketStream(ws, { encoding: 'utf8' });
// duplex.pipe(process.stdout);
// process.stdin.pipe(duplex);
//   const postData = new TextEncoder().encode(
//     JSON.stringify({
//       action: 'wormholeResponse',
//       todo: 'Buy the milk',
//     }),
//   )
//
//   console.log(WEBSOCKET_URL)
//
//   // function request(opts) { https.request(opts, function(res) { res.pipe(process.stdout) }).end(opts.body || '') }
//   // const aws4Request = aws4.sign(
//   //   {
//   //     host: WEBSOCKET_URL,
//   //     path:
//   //     `/${ENV}/@connections/BypJOfoNCYcCHOg=` +
//   //     (data.credentials.sessionToken
//   //       ? `?X-Amz-Security-Token=${encodeURIComponent(
//   //         data.credentials.sessionToken,
//   //       )}`
//   //       : ''),
//   //     service: `execute-api`,
//   //     region: AWS_REGION,
//   //     signQuery: true,
//   //     body: JSON.stringify({
//   //       action: "wormholeResponse",
//   //       todo: 'Buy the milk'
//   //     })
//   //   },
//   //   data.credentials,
//   // )
//   // console.log(request(aws4Request))
//   const wsEndpoint = `wss://${WEBSOCKET_URL}${path}`
//   console.log('Connecting to', wsEndpoint)
//
//
//   ws.on('open', function open() {
//     console.log('websocket open')
//     ws.send(JSON.stringify({ action: 'sendmessage', data: { hi: 'ho' } }))
//   })
//
//   ws.on('close', function close() {
//     console.log('disconnected')
//   })
//
//   ws.on('message', function incoming(data) {
//     console.log(data)
//   })
//
//   const duplex = WebSocket.createWebSocketStream(ws, { encoding: 'utf8' })
//   duplex.pipe(process.stdout)
//   process.stdin.pipe(duplex)
// })
// const AWS = require("aws-sdk");
// const apig = new AWS.ApiGatewayManagementApi({
//   endpoint: process.env.WORMHOME_WS_ENDPOINT,
// });
//await apig
// .postToConnection({
//   ConnectionId: connectionId,
//   Data: JSON.stringify(body),
// })
// .promise();
//
// const wsConnect = async (event, context, callback) => {
//   try {
//     const now = new Date()
//     let expiresAt = new Date()
//     expiresAt.setHours(expiresAt.getHours() + 1)
//     const webSocketConnectionItem = {
//       connectionId: event.requestContext.connectionId,
//       sourceIp: event.requestContext?.identity?.sourceIp,
//       subdomain: event.queryStringParameters?.subdomain,
//       createdAt: now.toISOString(),
//       updatedAt: now.toISOString(),
//       expiresTtl: Math.round(expiresAt / 1000),
//     }
//
//     console.debug(
//       `putting connection ${webSocketConnectionItem.connectionId} from ${webSocketConnectionItem.sourceIp}`,
//     )
//
//     await documentClient
//       .put({
//         TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
//         Item: webSocketConnectionItem,
//       })
//       .promise()
//
//     callback(null, { statusCode: 200, body: 'Connected' })
//   } catch (e) {
//     console.error(e)
//     callback(null, { statusCode: 500, body: 'Connection rejected' })
//   }
// }
//
// const wsDisconnect = async (event, context, callback) => {
//   console.log('wsDisconnect', event)
//   console.log('deleting connection', event.requestContext.connectionId)
//   await documentClient
//     .delete({
//       TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
//       Key: {
//         connectionId: event.requestContext.connectionId,
//       },
//     })
//     .promise()
//
//   callback(null, { statusCode: 200, body: 'ok' })
// }
//
// const wsHandleMessage = async (event, context, callback) => {
//   console.log('wsHandleMessage', event)
//   callback(null, { statusCode: 200, body: 'ok' })
// }
//
// const handleWs = async (event, context, callback) => {
//   switch (event.requestContext?.routeKey) {
//     case '$connect':
//       return await wsConnect(event, context, callback)
//     case '$disconnect':
//       return await wsDisconnect(event, context, callback)
//     case 'sendmessage':
//       return await wsHandleMessage(event, context, callback)
//     default:
//       return callback('Invalid routeKey')
//   }
//
//   callback('fallthrough')
// }
//
// module.exports = {
//   handleWs,
// }
