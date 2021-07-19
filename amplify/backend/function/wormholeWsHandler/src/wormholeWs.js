const AWS = require('aws-sdk')
const { getAllConnections, documentClient } = require('./wormholeData')

const postToConnection = async (wsApiGatewayClient, connectionId, data) => {
  try {
    await wsApiGatewayClient
      .postToConnection({
        ConnectionId: connectionId,
        Data: JSON.stringify(data),
      })
      .promise()
  } catch (e) {
    if (e.statusCode === 410) {
      console.debug(`found stale connection, deleting ${connectionId}`)
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
}

const wsConnect = async (event, context, callback) => {
  try {
    const now = new Date()
    let expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 1)
    const webSocketConnectionItem = {
      connectionId: event.requestContext.connectionId,
      sourceIp: event.requestContext?.identity?.sourceIp,
      clientForHost: event.queryStringParameters?.clientForHost || 'DEFAULT',
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
  console.debug('wsDisconnect', event)
  await documentClient
    .delete({
      TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
      Key: {
        connectionId: event.requestContext.connectionId,
      },
    })
    .promise()

  // Broadcasting disconnect to non-client connections
  const connections = await getAllConnections()
  const serverConnections = connections.filter((c) => !c.isClient)
  const wsApiGatewayClient = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint:
      event.requestContext.domainName + '/' + event.requestContext.stage,
  })

  await Promise.all(
    serverConnections.map(async (conn) => {
      await postToConnection(wsApiGatewayClient, conn.connectionId, {
        sourceConnectionId: event.requestContext.connectionId,
        clientForHost: conn.clientForHost,
        action: 'CLIENT_DISCONNECT',
      })
    }),
  )

  callback(null, { statusCode: 200, body: 'ok' })
}

const wsHandleMessage = async (event, context, callback) => {
  const sourceConnectionId = event.requestContext.connectionId
  try {
    const { data, action, connectionId } = JSON.parse(event.body)
    console.debug('wsHandleMessage', action, connectionId)
    const wsApiGatewayClient = new AWS.ApiGatewayManagementApi({
      apiVersion: '2018-11-29',
      endpoint:
        event.requestContext.domainName + '/' + event.requestContext.stage,
    })

    if (!connectionId) {
      throw new Error('no connectionId found in body')
    }

    await postToConnection(wsApiGatewayClient, connectionId, {
      sourceConnectionId,
      data,
    })
  } catch (e) {
    console.error('could not parse body', e)
    return false
  }

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
}

module.exports = {
  handleWs,
  wsHandleMessage,
  wsConnect,
  wsDisconnect,
  postToConnection,
}
