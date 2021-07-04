const AWS = require('aws-sdk')
const aws4 = require('aws4')
const awscred = require('awscred')
const WebSocket = require('ws')
const queryString = require('query-string')
const assert = require('assert')

const documentClient = new AWS.DynamoDB.DocumentClient({
  convertEmptyValues: true,
})

AWS.config.logger = console

// awscred.load(function (err, data) {
//   if (err) throw err
//   console.log(data.credentials)
//
//   var queryStringStr = queryString.stringify({
//     'X-Amz-Security-Token': data.credentials.sessionToken,
//     clientType: 'SERVER',
//   })
//   console.log(queryStringStr)
//
//   const { path } = aws4.sign(
//     {
//       host: WEBSOCKET_URL,
//       path: `/${ENV}?` + queryStringStr,
//       service: `execute-api`,
//       region: AWS_REGION,
//       signQuery: true,
//     },
//     data.credentials,
//   )
//
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
//   const ws = new WebSocket(wsEndpoint)
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

const wsConnect = async (event, context, callback) => {
  try {
    const now = new Date()
    let expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 1)
    const webSocketConnectionItem = {
      connectionId: event.requestContext.connectionId,
      sourceIp: event.requestContext?.identity?.sourceIp,
      clientForHost: event.queryStringParameters?.clientForHost || "DEFAULT",
      isClient: event.queryStringParameters?.clientType === 'CLIENT',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresTtl: Math.round(expiresAt / 1000),
    }

    console.debug(
      `putting connection ${webSocketConnectionItem.connectionId} from ${webSocketConnectionItem.sourceIp}`,
    )

    await documentClient
      .put({
        TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
        Item: webSocketConnectionItem,
      })
      .promise()

    callback(null, { statusCode: 200, body: 'Connected' })
  } catch (e) {
    console.error(e)
    callback(null, { statusCode: 500, body: 'Connection rejected' })
  }
}

const wsDisconnect = async (event, context, callback) => {
  console.log('wsDisconnect', event)
  console.log('deleting connection', event.requestContext.connectionId)
  await documentClient
    .delete({
      TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
      Key: {
        connectionId: event.requestContext.connectionId,
      },
    })
    .promise()

  callback(null, { statusCode: 200, body: 'ok' })
}

const wsHandleMessage = async (event, context, callback) => {
  console.log('wsHandleMessage', event)
  const sourceConnectionId = event.requestContext.connectionId
  try {
    const { data, connectionId } = JSON.parse(event.body)
    const wsApiGatewayClient = new AWS.ApiGatewayManagementApi({
      apiVersion: '2018-11-29',
      endpoint:
        event.requestContext.domainName + '/' + event.requestContext.stage,
    })
    if (!connectionId) {
      throw new Error('no connectionId found in body')
    }

    try {
      await wsApiGatewayClient
        .postToConnection({
          ConnectionId: connectionId,
          Data: JSON.stringify({
            sourceConnectionId,
            data,
          }),
        })
        .promise()
    } catch (e) {
      if (e.statusCode === 410) {
        console.log(`found stale connection, deleting ${connectionId}`)
        await documentClient
          .delete({
            TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
            Key: {
              connectionId,
            },
          })
          .promise()
      } else {
        throw e
      }
    }
  } catch (e) {
    console.error('could not parse body', e)
    return false
  }

  // requestContext: {
  //   routeKey: 'sendmessage',
  //     messageId: 'B5peRdF9CYcCIZA=',
  //     eventType: 'MESSAGE',
  //     extendedRequestId: 'B5peRGpfCYcFz8Q=',
  //     requestTime: '03/Jul/2021:15:58:31 +0000',
  //     messageDirection: 'IN',
  //     stage: 'cdunn',
  //     connectedAt: 1625327911491,
  //     requestTimeEpoch: 1625327911927,
  //     identity: { sourceIp: '52.15.108.44' },
  //     requestId: 'B5peRGpfCYcFz8Q=',
  //     domainName: '1yy3xayeu3.execute-api.us-east-2.amazonaws.com',
  //     connectionId: 'B5peMdF6iYcCIZA=',
  //     apiId: '1yy3xayeu3'
  // },
  // body: '{"action":"sendmessage","data":{"subdomain":null,"reqId":"Root=1-60e08925-21d8710e1715aead627e55cf","sourceIp":"70.185.143.112"}}',
  callback(null, { statusCode: 200, body: 'ok' })
}

const handleWs = async (event, context, callback) => {
  switch (event.requestContext?.routeKey) {
    case '$connect':
      return await wsConnect(event, context, callback)
    case '$disconnect':
      return await wsDisconnect(event, context, callback)
    case 'sendmessage':
      return await wsHandleMessage(event, context, callback)
    default:
      return callback('Invalid routeKey')
  }

  callback('fallthrough')
}

module.exports = {
  handleWs,
}
