const envTableName = (tableName) => `${tableName}-`

const wsConnect = async (event, context, callback) => {
  try {
    const nowUtc = spacetime().format('iso-utc')
    const webSocketConnectionItem = {
      connectionId: event.requestContext.connectionId,
      sourceIp: event.requestContext?.identity?.sourceIp,
      subdomain: event.queryStringParameters?.subdomain,
      expirationUnixTime: Math.floor(
        spacetime.now().add(15, 'minutes').epoch / 1000,
      ),
      createdAt: nowUtc,
      updatedAt: nowUtc,
    }

    console.log('putting item to', envTableName('WebSocketConnection'))
    await documentClient
      .put({
        TableName: envTableName('WebSocketConnection'),
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
  console.log('deleting connection from', envTableName('WebSocketConnection'))
  await documentClient
    .delete({
      TableName: envTableName('WebSocketConnection'),
      Key: {
        connectionId: event.requestContext.connectionId,
      },
    })
    .promise()

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
